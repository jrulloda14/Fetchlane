//! Native messaging host for the Fetchlane browser extension.
//!
//! Chrome and Edge start `fetchlane.exe chrome-extension://<id>/` and talk to
//! it over stdin/stdout: each message is a 32-bit little-endian length and
//! then that many bytes of JSON. The host never opens a window. For "add" it
//! launches `fetchlane.exe --add <link>`; a running Fetchlane picks the link up
//! (single instance) and shows Add download, where the person confirms it.
//!
//! Only the extension whose ID is listed in the host manifest may connect;
//! the browser enforces that.

use std::io::{self, Read, Write};

use serde::Deserialize;
use serde_json::json;

use crate::external::is_supported_link;

/// Messages from the extension are small; anything bigger is refused.
const MAX_MESSAGE: u32 = 64 * 1024;

/// Whether this process was started by a browser as the native host.
pub fn is_native_launch<S: AsRef<str>>(args: &[S]) -> bool {
    args.iter()
        .any(|a| a.as_ref().starts_with("chrome-extension://"))
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Request {
    Ping,
    Add { url: String },
}

/// Serve messages until the browser closes the pipe.
pub fn run() {
    let mut stdin = io::stdin().lock();
    let mut stdout = io::stdout().lock();
    while let Some(msg) = read_message(&mut stdin) {
        let reply = match msg {
            Ok(bytes) => handle(&bytes),
            Err(e) => json!({ "ok": false, "error": e }),
        };
        if write_message(&mut stdout, &reply).is_err() {
            break;
        }
    }
}

fn handle(bytes: &[u8]) -> serde_json::Value {
    match serde_json::from_slice::<Request>(bytes) {
        Ok(Request::Ping) => json!({ "ok": true, "version": env!("CARGO_PKG_VERSION") }),
        Ok(Request::Add { url }) => {
            let url = url.trim();
            if !is_supported_link(url) {
                return json!({ "ok": false, "error": "Fetchlane can only add http, https and magnet links." });
            }
            match launch_app(url) {
                Ok(()) => json!({ "ok": true }),
                Err(e) => {
                    json!({ "ok": false, "error": format!("Fetchlane couldn't be started: {e}") })
                }
            }
        }
        Err(_) => json!({ "ok": false, "error": "Unknown request." }),
    }
}

/// `None` when the pipe is closed.
fn read_message(r: &mut impl Read) -> Option<Result<Vec<u8>, &'static str>> {
    let mut len = [0u8; 4];
    r.read_exact(&mut len).ok()?;
    let len = u32::from_le_bytes(len);
    if len > MAX_MESSAGE {
        // Skip it so the stream stays in step.
        let skipped = io::copy(&mut r.take(u64::from(len)), &mut io::sink()).ok()?;
        return (skipped == u64::from(len)).then_some(Err("The message is too large."));
    }
    let mut buf = vec![0u8; len as usize];
    r.read_exact(&mut buf).ok()?;
    Some(Ok(buf))
}

fn write_message(w: &mut impl Write, value: &serde_json::Value) -> io::Result<()> {
    let bytes = serde_json::to_vec(value)?;
    w.write_all(&(bytes.len() as u32).to_le_bytes())?;
    w.write_all(&bytes)?;
    w.flush()
}

/// Start Fetchlane (or hand the link to the running one) without tying it to
/// the browser's pipes or its job object.
fn launch_app(url: &str) -> io::Result<()> {
    use std::process::{Command, Stdio};
    let exe = std::env::current_exe()?;
    let spawn = |extra_flags: u32| {
        let mut cmd = Command::new(&exe);
        cmd.args(["--add", url])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const DETACHED_PROCESS: u32 = 0x0000_0008;
            const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
            cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | extra_flags);
        }
        #[cfg(not(windows))]
        let _ = extra_flags;
        cmd.spawn().map(drop)
    };
    // Browsers may run the host in a job that closes with it; break away
    // when allowed so Fetchlane keeps running.
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
    spawn(CREATE_BREAKAWAY_FROM_JOB).or_else(|_| spawn(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(body: &[u8]) -> Vec<u8> {
        let mut v = (body.len() as u32).to_le_bytes().to_vec();
        v.extend_from_slice(body);
        v
    }

    #[test]
    fn detects_browser_launch() {
        assert!(is_native_launch(&[
            "chrome-extension://abc/",
            "--parent-window=0"
        ]));
        assert!(!is_native_launch(&["--add", "https://x"]));
    }

    #[test]
    fn reads_framed_messages_and_skips_huge_ones() {
        let mut input = frame(br#"{"type":"ping"}"#);
        input.extend((MAX_MESSAGE + 1).to_le_bytes());
        input.extend(vec![b' '; MAX_MESSAGE as usize + 1]);
        input.extend(frame(br#"{"type":"ping"}"#));
        let mut r = &input[..];
        assert_eq!(
            read_message(&mut r).unwrap().unwrap(),
            br#"{"type":"ping"}"#
        );
        assert!(read_message(&mut r).unwrap().is_err());
        assert!(read_message(&mut r).unwrap().is_ok());
        assert!(read_message(&mut r).is_none());
    }

    #[test]
    fn answers_ping_and_refuses_bad_links() {
        assert_eq!(handle(br#"{"type":"ping"}"#)["ok"], true);
        let r = handle(br#"{"type":"add","url":"javascript:alert(1)"}"#);
        assert_eq!(r["ok"], false);
        assert_eq!(handle(b"nonsense")["ok"], false);
    }

    #[test]
    fn writes_framed_replies() {
        let mut out = Vec::new();
        write_message(&mut out, &json!({"ok": true})).unwrap();
        assert_eq!(&out[..4], &11u32.to_le_bytes());
        assert_eq!(&out[4..], br#"{"ok":true}"#);
    }
}
