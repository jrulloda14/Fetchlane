//! Links and .torrent files handed to Fetchlane from outside the window: the
//! command line (`fetchlane.exe --add <link>`, a magnet link or a .torrent
//! path from Windows), a second launch while Fetchlane is running, and the
//! browser extension (through the native messaging host, which launches
//! `fetchlane.exe --add <link>`).
//!
//! Nothing starts on its own: each item opens Add download, prefilled, and the
//! person confirms it there.

use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

/// Longest link accepted from outside (browsers allow about 2 MB, but no real
/// download link comes close to this).
pub const MAX_LINK_LEN: usize = 16 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
pub enum ExternalAdd {
    /// An http(s) or magnet link.
    Link(String),
    /// A local .torrent file.
    TorrentFile(String),
}

/// Items waiting for the window to pick them up.
#[derive(Default)]
pub struct Pending(Mutex<Vec<ExternalAdd>>);

/// Whether a link is one Fetchlane can add.
pub fn is_supported_link(s: &str) -> bool {
    let lower = s.get(..8).unwrap_or(s).to_ascii_lowercase();
    s.len() <= MAX_LINK_LEN
        && !s.chars().any(char::is_control)
        && (lower.starts_with("http://")
            || lower.starts_with("https://")
            || lower.starts_with("magnet:?"))
}

fn classify(arg: &str) -> Option<ExternalAdd> {
    let arg = arg.trim();
    if is_supported_link(arg) {
        return Some(ExternalAdd::Link(arg.to_string()));
    }
    let p = Path::new(arg);
    let is_torrent = p
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("torrent"));
    (is_torrent && p.is_absolute()).then(|| ExternalAdd::TorrentFile(arg.to_string()))
}

/// Read links and .torrent files from command-line arguments (without the
/// program name). `--add <x>` and bare values are both accepted; anything
/// else is ignored.
pub fn parse_args<S: AsRef<str>>(args: &[S]) -> Vec<ExternalAdd> {
    let mut out = Vec::new();
    let mut it = args.iter().map(AsRef::as_ref);
    while let Some(a) = it.next() {
        let value = if a == "--add" { it.next() } else { Some(a) };
        if let Some(item) = value.and_then(classify) {
            if !out.contains(&item) {
                out.push(item);
            }
        }
    }
    out
}

/// Queue items for the window and tell it to look.
pub fn push(app: &AppHandle, items: Vec<ExternalAdd>) {
    if items.is_empty() {
        return;
    }
    if let Some(p) = app.try_state::<Pending>() {
        let mut q = p.0.lock().unwrap_or_else(|e| e.into_inner());
        for i in items {
            if !q.contains(&i) {
                q.push(i);
            }
        }
    }
    let _ = app.emit("external-add", ());
}

/// The window takes the queued items (once at startup, then on each
/// `external-add` event).
#[tauri::command]
pub fn take_external_adds(pending: State<'_, Pending>) -> Vec<ExternalAdd> {
    std::mem::take(&mut *pending.0.lock().unwrap_or_else(|e| e.into_inner()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_links_and_torrent_files() {
        let got = parse_args(&[
            "--add",
            "https://example.com/a.zip",
            "magnet:?xt=urn:btih:abc",
            r"C:\Users\me\Downloads\pack.torrent",
            "--add",
            "https://example.com/a.zip",
            "--unknown",
            "relative.torrent",
            "ftp://x/y",
            "javascript:alert(1)",
        ]);
        assert_eq!(
            got,
            vec![
                ExternalAdd::Link("https://example.com/a.zip".into()),
                ExternalAdd::Link("magnet:?xt=urn:btih:abc".into()),
                ExternalAdd::TorrentFile(r"C:\Users\me\Downloads\pack.torrent".into()),
            ]
        );
    }

    #[test]
    fn rejects_odd_links() {
        assert!(is_supported_link("HTTPS://EXAMPLE.COM/A"));
        assert!(!is_supported_link("https://example.com/a\nb"));
        assert!(!is_supported_link(&format!(
            "https://e.com/{}",
            "a".repeat(MAX_LINK_LEN)
        )));
        assert!(!is_supported_link("magnet:xt"));
        assert!(!is_supported_link("file:///C:/x"));
    }
}
