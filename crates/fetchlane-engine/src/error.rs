//! Error classification. Every failure is mapped to a user-facing message and a
//! decision about whether retrying could help.

use std::fmt;
use std::io;
use std::time::Duration;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    /// The request itself is invalid (bad URL, bad file name, ...).
    InvalidInput,
    /// Connection failed or was interrupted.
    Network,
    /// The server stopped responding.
    Timeout,
    /// TLS handshake or certificate verification failed.
    Tls,
    /// Too many redirects, or a redirect we refuse to follow.
    Redirect,
    /// The server answered with an unexpected HTTP status.
    Http,
    NotFound,
    AccessDenied,
    /// 5xx or 429; usually transient.
    Server,
    /// The server's range responses were inconsistent.
    RangeMismatch,
    /// The destination folder is missing or not a folder.
    Destination,
    /// No permission to write to the destination.
    Permission,
    DiskFull,
    /// Any other local file system error.
    FileSystem,
    /// The resource changed repeatedly while downloading.
    ResourceChanged,
    /// Partial data exists but the server can't continue it; needs a restart.
    CannotResume,
    Internal,
}

#[derive(Debug, Clone)]
pub struct DownloadError {
    pub kind: ErrorKind,
    pub message: String,
    pub retryable: bool,
    /// Server-requested delay (`Retry-After`), if any.
    pub retry_after: Option<Duration>,
}

impl DownloadError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            retryable: false,
            retry_after: None,
        }
    }

    pub fn retryable(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            retryable: true,
            ..Self::new(kind, message)
        }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::InvalidInput, message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Internal, message)
    }

    pub fn interrupted() -> Self {
        Self::retryable(ErrorKind::Network, "The connection was interrupted.")
    }

    pub fn timeout() -> Self {
        Self::retryable(ErrorKind::Timeout, "The server stopped responding.")
    }

    pub fn destination_unavailable() -> Self {
        Self::new(
            ErrorKind::Destination,
            "The destination folder isn't available. Reconnect the drive or choose another folder.",
        )
    }

    pub fn cannot_resume() -> Self {
        Self::new(
            ErrorKind::CannotResume,
            "The server can't continue a partial download. Restart to download it again.",
        )
    }

    pub fn disk_full() -> Self {
        Self::new(
            ErrorKind::DiskFull,
            "There isn't enough free disk space. Free up space and retry.",
        )
    }

    pub fn from_status(status: u16, retry_after: Option<Duration>) -> Self {
        let mut err = match status {
            404 | 410 => Self::new(
                ErrorKind::NotFound,
                format!("The file wasn't found on the server (HTTP {status})."),
            ),
            401 | 403 => Self::new(
                ErrorKind::AccessDenied,
                format!("The server denied access to this file (HTTP {status})."),
            ),
            408 => Self::retryable(ErrorKind::Timeout, "The server timed out (HTTP 408)."),
            429 => Self::retryable(ErrorKind::Server, "The server is busy (HTTP 429)."),
            500..=599 => Self::retryable(
                ErrorKind::Server,
                format!("The server reported an error (HTTP {status})."),
            ),
            _ => Self::new(
                ErrorKind::Http,
                format!("The server returned an unexpected response (HTTP {status})."),
            ),
        };
        err.retry_after = retry_after;
        err
    }

    pub fn from_reqwest(e: &reqwest::Error) -> Self {
        if let Some(redirect) = find_source::<RedirectRefused>(e) {
            return Self::new(ErrorKind::Redirect, redirect.0);
        }
        if e.is_redirect() {
            return Self::new(ErrorKind::Redirect, "The server redirected too many times.");
        }
        if e.is_timeout() {
            return Self::timeout();
        }
        if chain_mentions_tls(e) {
            return Self::new(
                ErrorKind::Tls,
                "A secure connection couldn't be established. The server's certificate couldn't be verified.",
            );
        }
        if e.is_connect() {
            return Self::retryable(
                ErrorKind::Network,
                "Couldn't connect to the server. Check your internet connection.",
            );
        }
        if e.is_builder() || e.is_request() && e.url().is_none() {
            return Self::invalid("The link couldn't be used.");
        }
        Self::interrupted()
    }

    /// Map a local I/O failure while working in the destination folder.
    pub fn from_io(e: &io::Error) -> Self {
        if is_disk_full(e) {
            return Self::disk_full();
        }
        match e.kind() {
            io::ErrorKind::PermissionDenied => Self::new(
                ErrorKind::Permission,
                "Fetchlane doesn't have permission to write to the destination folder.",
            ),
            io::ErrorKind::NotFound => Self::destination_unavailable(),
            io::ErrorKind::ReadOnlyFilesystem => {
                Self::new(ErrorKind::Permission, "The destination drive is read-only.")
            }
            _ => Self::new(
                ErrorKind::FileSystem,
                format!("Couldn't write the file: {e}"),
            ),
        }
    }
}

impl fmt::Display for DownloadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for DownloadError {}

/// Returned by the redirect policy when a hop is refused.
#[derive(Debug)]
pub(crate) struct RedirectRefused(pub &'static str);

impl fmt::Display for RedirectRefused {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.0)
    }
}

impl std::error::Error for RedirectRefused {}

fn find_source<'a, T: std::error::Error + 'static>(
    e: &'a (dyn std::error::Error + 'static),
) -> Option<&'a T> {
    let mut cur: Option<&(dyn std::error::Error + 'static)> = Some(e);
    while let Some(err) = cur {
        if let Some(found) = err.downcast_ref::<T>() {
            return Some(found);
        }
        cur = err.source();
    }
    None
}

fn chain_mentions_tls(e: &(dyn std::error::Error + 'static)) -> bool {
    let mut cur: Option<&(dyn std::error::Error + 'static)> = Some(e);
    while let Some(err) = cur {
        let text = err.to_string().to_ascii_lowercase();
        if text.contains("certificate")
            || text.contains("tls handshake")
            || text.contains("invalid peer")
        {
            return true;
        }
        cur = err.source();
    }
    false
}

pub(crate) fn is_disk_full(e: &io::Error) -> bool {
    if e.kind() == io::ErrorKind::StorageFull || e.kind() == io::ErrorKind::QuotaExceeded {
        return true;
    }
    match e.raw_os_error() {
        // ERROR_HANDLE_DISK_FULL, ERROR_DISK_FULL
        #[cfg(windows)]
        Some(39) | Some(112) => true,
        // ENOSPC, EDQUOT
        #[cfg(unix)]
        Some(28) | Some(122) => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_classification() {
        assert_eq!(
            DownloadError::from_status(404, None).kind,
            ErrorKind::NotFound
        );
        assert!(!DownloadError::from_status(404, None).retryable);
        assert!(DownloadError::from_status(503, None).retryable);
        assert!(DownloadError::from_status(429, None).retryable);
        assert!(!DownloadError::from_status(400, None).retryable);
    }

    #[test]
    fn disk_full_is_detected() {
        let e = io::Error::from(io::ErrorKind::StorageFull);
        assert_eq!(DownloadError::from_io(&e).kind, ErrorKind::DiskFull);
        #[cfg(windows)]
        assert_eq!(
            DownloadError::from_io(&io::Error::from_raw_os_error(112)).kind,
            ErrorKind::DiskFull
        );
        #[cfg(unix)]
        assert_eq!(
            DownloadError::from_io(&io::Error::from_raw_os_error(28)).kind,
            ErrorKind::DiskFull
        );
    }
}
