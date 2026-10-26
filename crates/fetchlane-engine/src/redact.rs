//! Helpers that keep credentials and query secrets out of logs and the UI.

use url::Url;

/// URL without user info, query values or fragment. A removed query is
/// marked with `?…` so it is clear something was there.
pub fn redact_url(raw: &str) -> String {
    match Url::parse(raw) {
        Ok(mut u) => {
            let _ = u.set_username("");
            let _ = u.set_password(None);
            let had_query = u.query().is_some_and(|q| !q.is_empty());
            u.set_query(None);
            u.set_fragment(None);
            let mut s = u.to_string();
            if had_query {
                s.push_str("?…");
            }
            s
        }
        Err(_) => "<invalid url>".to_string(),
    }
}

/// Scheme, host and path for display. Query and fragment are dropped; see
/// [`query_param_count`] for how many parameters were hidden.
pub fn display_url(raw: &str) -> String {
    let s = redact_url(raw);
    s.strip_suffix("?…").map(str::to_string).unwrap_or(s)
}

pub fn query_param_count(raw: &str) -> u32 {
    Url::parse(raw).map_or(0, |u| u.query_pairs().count() as u32)
}

pub fn host_of(raw: &str) -> String {
    Url::parse(raw)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_credentials_and_query() {
        assert_eq!(
            redact_url("https://user:secret@example.com/a/b.zip?token=abc#frag"),
            "https://example.com/a/b.zip?…"
        );
        assert_eq!(
            redact_url("http://example.com/file"),
            "http://example.com/file"
        );
        assert!(!redact_url("https://u:p@x.org/?sig=1").contains("sig"));
        assert_eq!(
            display_url("https://u:p@x.org/f.zip?a=1&b=2#x"),
            "https://x.org/f.zip"
        );
        assert_eq!(query_param_count("https://x.org/f.zip?a=1&b=2"), 2);
        assert_eq!(query_param_count("https://x.org/f.zip"), 0);
    }
}
