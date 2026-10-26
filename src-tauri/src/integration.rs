//! Windows integration, all per user (HKCU) and refreshed at every start so
//! moving or updating Fetchlane keeps it working:
//!
//! - the native messaging host the browser extension talks to (Chrome, Edge,
//!   Brave and other Chromium browsers);
//! - Fetchlane in the "Open with" list for .torrent files (it never takes over
//!   the default app);
//! - on request only, the handler for magnet links.
//!
//! The installer's uninstall step removes these keys.

use serde::Serialize;

/// The native messaging host name the extension connects to.
pub const HOST_NAME: &str = "dev.fetchlane.host";

/// The ID of the Fetchlane extension, fixed by the public key in
/// `browser-extension/manifest.json`.
pub const EXTENSION_ID: &str = "loeipedomkbakhnhoannlanfnfnimdni";

/// Registry keys (under HKCU) where Chromium browsers look for native hosts.
#[cfg_attr(not(windows), allow(dead_code))]
const HOST_KEYS: [&str; 4] = [
    r"Software\Google\Chrome\NativeMessagingHosts",
    r"Software\Microsoft\Edge\NativeMessagingHosts",
    r"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts",
    r"Software\Chromium\NativeMessagingHosts",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationStatus {
    /// Native host registered, so the extension can reach Fetchlane.
    pub browser_host: bool,
    /// Magnet links open Fetchlane.
    pub magnet_handler: bool,
    /// Another app was chosen for magnet links in Windows settings; it wins
    /// over Fetchlane's registration.
    pub magnet_user_choice: Option<String>,
    /// Folder with the browser extension, for "Load unpacked".
    pub extension_dir: Option<String>,
}

#[cfg(windows)]
mod imp {
    use std::io;
    use std::path::{Path, PathBuf};

    use serde_json::json;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
    use winreg::RegKey;

    use super::{EXTENSION_ID, HOST_KEYS, HOST_NAME};

    fn hkcu() -> RegKey {
        RegKey::predef(HKEY_CURRENT_USER)
    }

    fn exe() -> io::Result<PathBuf> {
        std::env::current_exe()
    }

    fn command_line(exe: &Path) -> String {
        format!("\"{}\" \"%1\"", exe.display())
    }

    /// Write the host manifest and point every Chromium browser at it.
    pub fn register_browser_host(data_dir: &Path) -> io::Result<()> {
        let exe = exe()?;
        let dir = data_dir.join("native-host");
        std::fs::create_dir_all(&dir)?;
        let manifest = dir.join(format!("{HOST_NAME}.json"));
        let body = json!({
            "name": HOST_NAME,
            "description": "Fetchlane download manager",
            "path": exe,
            "type": "stdio",
            "allowed_origins": [format!("chrome-extension://{EXTENSION_ID}/")],
        });
        let bytes = serde_json::to_vec_pretty(&body)?;
        if std::fs::read(&manifest).ok() != Some(bytes.clone()) {
            std::fs::write(&manifest, bytes)?;
        }
        let path = manifest.to_string_lossy().into_owned();
        for key in HOST_KEYS {
            let (k, _) = hkcu().create_subkey(format!(r"{key}\{HOST_NAME}"))?;
            k.set_value("", &path)?;
        }
        Ok(())
    }

    pub fn browser_host_registered() -> bool {
        hkcu()
            .open_subkey_with_flags(format!(r"{}\{HOST_NAME}", HOST_KEYS[0]), KEY_READ)
            .and_then(|k| k.get_value::<String, _>(""))
            .is_ok_and(|p| Path::new(&p).is_file())
    }

    /// Add Fetchlane to "Open with" for .torrent files.
    pub fn register_open_with() -> io::Result<()> {
        let exe = exe()?;
        let (prog, _) = hkcu().create_subkey(r"Software\Classes\Fetchlane.Torrent")?;
        prog.set_value("", &"Torrent file")?;
        let (icon, _) = prog.create_subkey("DefaultIcon")?;
        icon.set_value("", &format!("\"{}\",0", exe.display()))?;
        let (cmd, _) = prog.create_subkey(r"shell\open\command")?;
        cmd.set_value("", &command_line(&exe))?;
        let (ow, _) = hkcu().create_subkey(r"Software\Classes\.torrent\OpenWithProgids")?;
        ow.set_value("Fetchlane.Torrent", &"")?;
        Ok(())
    }

    const MAGNET: &str = r"Software\Classes\magnet";

    pub fn magnet_handler() -> bool {
        let Ok(exe) = exe() else { return false };
        hkcu()
            .open_subkey_with_flags(format!(r"{MAGNET}\shell\open\command"), KEY_READ)
            .and_then(|k| k.get_value::<String, _>(""))
            .is_ok_and(|c| c == command_line(&exe))
    }

    /// The app picked for magnet links in Windows settings, if any.
    pub fn magnet_user_choice() -> Option<String> {
        let prog: String = hkcu()
            .open_subkey_with_flags(
                r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\magnet\UserChoice",
                KEY_READ,
            )
            .and_then(|k| k.get_value("ProgId"))
            .ok()?;
        (prog != "magnet").then_some(prog)
    }

    pub fn set_magnet_handler(on: bool) -> io::Result<()> {
        if on {
            let exe = exe()?;
            let (k, _) = hkcu().create_subkey(MAGNET)?;
            k.set_value("", &"URL:Magnet link")?;
            k.set_value("URL Protocol", &"")?;
            let (icon, _) = k.create_subkey("DefaultIcon")?;
            icon.set_value("", &format!("\"{}\",0", exe.display()))?;
            let (cmd, _) = k.create_subkey(r"shell\open\command")?;
            cmd.set_value("", &command_line(&exe))?;
        } else if magnet_handler() {
            // Only remove the handler if it is Fetchlane's.
            hkcu().delete_subkey_all(MAGNET)?;
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod imp {
    use std::io;
    use std::path::Path;

    pub fn register_browser_host(_: &Path) -> io::Result<()> {
        Ok(())
    }
    pub fn browser_host_registered() -> bool {
        false
    }
    pub fn register_open_with() -> io::Result<()> {
        Ok(())
    }
    pub fn magnet_handler() -> bool {
        false
    }
    pub fn magnet_user_choice() -> Option<String> {
        None
    }
    pub fn set_magnet_handler(_: bool) -> io::Result<()> {
        Err(io::Error::other("Only supported on Windows."))
    }
}

pub use imp::set_magnet_handler;

/// Refresh the registrations. Failures are logged, never fatal.
pub fn register_all(data_dir: &std::path::Path) {
    if let Err(e) = imp::register_browser_host(data_dir) {
        tracing::warn!("couldn't register the browser extension host: {e}");
    }
    if let Err(e) = imp::register_open_with() {
        tracing::warn!("couldn't add Fetchlane to Open with for .torrent files: {e}");
    }
}

pub fn status(extension_dir: Option<std::path::PathBuf>) -> IntegrationStatus {
    IntegrationStatus {
        browser_host: imp::browser_host_registered(),
        magnet_handler: imp::magnet_handler(),
        magnet_user_choice: imp::magnet_user_choice(),
        extension_dir: extension_dir
            .filter(|d| d.join("manifest.json").is_file())
            .map(|d| d.to_string_lossy().into_owned()),
    }
}
