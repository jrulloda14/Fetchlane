//! File name handling: extraction from server metadata, sanitization, and
//! collision-free naming. Remote names are never trusted as paths.

use percent_encoding::percent_decode_str;
use url::Url;

use crate::error::DownloadError;

const FALLBACK_NAME: &str = "download";
const MAX_NAME_CHARS: usize = 180;
const INVALID_CHARS: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

/// Turn an untrusted remote name into a safe single path component.
pub fn sanitize(raw: &str) -> String {
    // Keep only the last path component so "../../x" or "C:\\x" can't escape.
    let last = raw.rsplit(['/', '\\']).next().unwrap_or("");
    let mut name: String = last
        .chars()
        .map(|c| {
            if c.is_control() || INVALID_CHARS.contains(&c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    // Windows silently drops trailing dots/spaces; leading dots hide files.
    name = name
        .trim()
        .trim_end_matches(['.', ' '])
        .trim_start_matches(['.', ' '])
        .to_string();
    if name.is_empty() {
        return FALLBACK_NAME.to_string();
    }
    if is_reserved(&name) {
        name.insert(0, '_');
    }
    truncate(&name)
}

/// Validate a name typed by the user. Unlike [`sanitize`], this reports
/// problems instead of silently rewriting the user's choice.
pub fn validate_user_name(raw: &str) -> Result<String, DownloadError> {
    let name = raw.trim().trim_end_matches(['.', ' ']);
    if name.is_empty() {
        return Err(DownloadError::invalid("Enter a file name."));
    }
    if name
        .chars()
        .any(|c| c.is_control() || INVALID_CHARS.contains(&c))
    {
        return Err(DownloadError::invalid(
            "File names can't contain any of these characters: \\ / : * ? \" < > |",
        ));
    }
    if name.starts_with('.') && name.chars().all(|c| c == '.') {
        return Err(DownloadError::invalid("Enter a valid file name."));
    }
    if is_reserved(name) {
        return Err(DownloadError::invalid(
            "That name is reserved by Windows. Choose another name.",
        ));
    }
    if name.chars().count() > 200 {
        return Err(DownloadError::invalid("That file name is too long."));
    }
    Ok(name.to_string())
}

/// Extract a file name from a `Content-Disposition` header value.
/// Prefers RFC 6266/5987 `filename*` over plain `filename`.
pub fn from_content_disposition(value: &str) -> Option<String> {
    let mut plain = None;
    let mut extended = None;
    for param in split_params(value) {
        let Some((key, val)) = param.split_once('=') else {
            continue;
        };
        let key = key.trim().to_ascii_lowercase();
        let val = val.trim();
        if key == "filename*" {
            extended = decode_ext_value(&unquote(val));
        } else if key == "filename" {
            plain = Some(unquote(val));
        }
    }
    extended.or(plain).filter(|n| !n.trim().is_empty())
}

/// Last non-empty path segment of a URL, percent-decoded.
pub fn from_url(url: &Url) -> Option<String> {
    let segment = url.path_segments()?.rev().find(|s| !s.is_empty())?;
    let decoded = percent_decode_str(segment).decode_utf8_lossy().into_owned();
    (!decoded.trim().is_empty()).then_some(decoded)
}

/// `name (n).ext`, keeping compound archive extensions together.
pub fn numbered(name: &str, n: u32) -> String {
    let (stem, ext) = split_ext(name);
    format!("{stem} ({n}){ext}")
}

/// Pick the first name not rejected by `taken`.
pub fn unique(name: &str, taken: impl Fn(&str) -> bool) -> String {
    if !taken(name) {
        return name.to_string();
    }
    (1..)
        .map(|n| numbered(name, n))
        .find(|candidate| !taken(candidate))
        .expect("an unbounded range always yields a free name")
}

fn split_ext(name: &str) -> (&str, &str) {
    let lower = name.to_ascii_lowercase();
    for compound in [".tar.gz", ".tar.bz2", ".tar.xz", ".tar.zst"] {
        if lower.ends_with(compound) && name.len() > compound.len() {
            let at = name.len() - compound.len();
            return (&name[..at], &name[at..]);
        }
    }
    match name.rfind('.') {
        Some(0) | None => (name, ""),
        Some(i) => (&name[..i], &name[i..]),
    }
}

fn is_reserved(name: &str) -> bool {
    let stem = name
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end()
        .to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && stem.as_bytes()[3].is_ascii_digit())
}

fn truncate(name: &str) -> String {
    if name.chars().count() <= MAX_NAME_CHARS {
        return name.to_string();
    }
    let (stem, ext) = split_ext(name);
    let ext = if ext.chars().count() <= 20 { ext } else { "" };
    let keep = MAX_NAME_CHARS - ext.chars().count();
    let stem: String = stem.chars().take(keep).collect();
    format!("{}{ext}", stem.trim_end())
}

fn split_params(value: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut escaped = false;
    for c in value.chars() {
        if escaped {
            cur.push(c);
            escaped = false;
            continue;
        }
        match c {
            '\\' if in_quotes => {
                cur.push(c);
                escaped = true;
            }
            '"' => {
                in_quotes = !in_quotes;
                cur.push(c);
            }
            ';' if !in_quotes => parts.push(std::mem::take(&mut cur)),
            _ => cur.push(c),
        }
    }
    parts.push(cur);
    parts
}

fn unquote(v: &str) -> String {
    let v = v.trim();
    if v.len() >= 2 && v.starts_with('"') && v.ends_with('"') {
        let mut out = String::new();
        let mut chars = v[1..v.len() - 1].chars();
        while let Some(c) = chars.next() {
            if c == '\\' {
                if let Some(next) = chars.next() {
                    out.push(next);
                }
            } else {
                out.push(c);
            }
        }
        out
    } else {
        v.to_string()
    }
}

/// Decode `charset'lang'percent-encoded` (RFC 5987).
fn decode_ext_value(v: &str) -> Option<String> {
    let mut it = v.splitn(3, '\'');
    let charset = it.next()?.to_ascii_lowercase();
    let _lang = it.next()?;
    let encoded = it.next()?;
    let bytes: Vec<u8> = percent_decode_str(encoded).collect();
    match charset.as_str() {
        "utf-8" | "" => Some(String::from_utf8_lossy(&bytes).into_owned()),
        "iso-8859-1" => Some(bytes.iter().map(|&b| b as char).collect()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_blocks_traversal_and_bad_chars() {
        assert_eq!(sanitize("../../etc/passwd"), "passwd");
        assert_eq!(sanitize("..\\..\\Windows\\evil.exe"), "evil.exe");
        assert_eq!(sanitize("C:\\temp\\a.txt"), "a.txt");
        assert_eq!(sanitize("a<b>c:d|e?.txt"), "a_b_c_d_e_.txt");
        assert_eq!(sanitize("name.txt. . "), "name.txt");
        assert_eq!(sanitize(".hidden"), "hidden");
        assert_eq!(sanitize(".."), FALLBACK_NAME);
        assert_eq!(sanitize(""), FALLBACK_NAME);
        assert_eq!(sanitize("tab\there.bin"), "tab_here.bin");
    }

    #[test]
    fn sanitize_reserved_names() {
        assert_eq!(sanitize("CON"), "_CON");
        assert_eq!(sanitize("nul.txt"), "_nul.txt");
        assert_eq!(sanitize("com1.log"), "_com1.log");
        assert_eq!(sanitize("console.txt"), "console.txt");
    }

    #[test]
    fn sanitize_truncates_but_keeps_extension() {
        let long = format!("{}.zip", "a".repeat(400));
        let s = sanitize(&long);
        assert!(s.chars().count() <= MAX_NAME_CHARS);
        assert!(s.ends_with(".zip"));
    }

    #[test]
    fn content_disposition_variants() {
        assert_eq!(
            from_content_disposition("attachment; filename=\"report.pdf\"").unwrap(),
            "report.pdf"
        );
        assert_eq!(
            from_content_disposition("attachment; filename=plain.bin").unwrap(),
            "plain.bin"
        );
        assert_eq!(
            from_content_disposition(
                "attachment; filename=\"fallback.pdf\"; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf"
            )
            .unwrap(),
            "résumé.pdf"
        );
        assert_eq!(
            from_content_disposition("attachment; filename=\"a;b.txt\"").unwrap(),
            "a;b.txt"
        );
        assert_eq!(
            from_content_disposition("attachment; filename=\"q\\\"uote.txt\"").unwrap(),
            "q\"uote.txt"
        );
        assert_eq!(from_content_disposition("inline"), None);
        // Traversal in the header is neutralized by sanitize().
        let raw = from_content_disposition("attachment; filename=\"../../evil.exe\"").unwrap();
        assert_eq!(sanitize(&raw), "evil.exe");
    }

    #[test]
    fn url_names() {
        let u = Url::parse("https://example.com/files/My%20File.zip?x=1").unwrap();
        assert_eq!(from_url(&u).unwrap(), "My File.zip");
        let u = Url::parse("https://example.com/dir/").unwrap();
        assert_eq!(from_url(&u).unwrap(), "dir");
        let u = Url::parse("https://example.com/").unwrap();
        assert_eq!(from_url(&u), None);
    }

    #[test]
    fn numbering() {
        assert_eq!(numbered("a.zip", 1), "a (1).zip");
        assert_eq!(numbered("backup.tar.gz", 2), "backup (2).tar.gz");
        assert_eq!(numbered("README", 3), "README (3)");
        let taken = ["a.zip", "a (1).zip"];
        assert_eq!(unique("a.zip", |n| taken.contains(&n)), "a (2).zip");
    }

    #[test]
    fn user_names() {
        assert!(validate_user_name("ok name.txt").is_ok());
        assert!(validate_user_name("bad/name").is_err());
        assert!(validate_user_name("..").is_err());
        assert!(validate_user_name("  ").is_err());
        assert!(validate_user_name("aux").is_err());
        assert_eq!(validate_user_name(" trailing. ").unwrap(), "trailing");
    }
}
