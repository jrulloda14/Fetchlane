//! HTTP client setup and response header helpers.

use std::time::Duration;

use reqwest::header::{self, HeaderMap};
use reqwest::redirect::{Attempt, Policy};
use url::Url;

use crate::error::{DownloadError, RedirectRefused};
use crate::model::Validators;
use crate::EngineConfig;

pub(crate) const MAX_REDIRECTS: usize = 10;

pub(crate) fn build_client(cfg: &EngineConfig) -> Result<reqwest::Client, DownloadError> {
    // TLS certificate verification stays at reqwest's secure default
    // (platform verifier). There is intentionally no option to disable it.
    reqwest::Client::builder()
        .user_agent(cfg.user_agent.clone())
        .connect_timeout(cfg.connect_timeout)
        .read_timeout(cfg.read_timeout)
        .redirect(Policy::custom(redirect_policy))
        .build()
        .map_err(|e| DownloadError::internal(format!("Couldn't start the network client: {e}")))
}

fn redirect_policy(attempt: Attempt) -> reqwest::redirect::Action {
    let previous = attempt.previous();
    match check_redirect(previous.len(), previous.last(), attempt.url()) {
        Ok(()) => attempt.follow(),
        Err(refused) => attempt.error(refused),
    }
}

pub(crate) fn check_redirect(
    hops: usize,
    from: Option<&Url>,
    to: &Url,
) -> Result<(), RedirectRefused> {
    if hops >= MAX_REDIRECTS {
        return Err(RedirectRefused("The server redirected too many times."));
    }
    if !matches!(to.scheme(), "http" | "https") {
        return Err(RedirectRefused(
            "The server redirected to an unsupported address.",
        ));
    }
    if from.is_some_and(|f| f.scheme() == "https") && to.scheme() == "http" {
        return Err(RedirectRefused(
            "The server redirected from a secure (HTTPS) address to an insecure one, so the download was stopped.",
        ));
    }
    Ok(())
}

/// Parse and validate a user-provided URL.
pub(crate) fn parse_url(raw: &str) -> Result<Url, DownloadError> {
    let url = Url::parse(raw.trim())
        .map_err(|_| DownloadError::invalid("That doesn't look like a valid link."))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(DownloadError::invalid(
            "Only http:// and https:// links are supported.",
        ));
    }
    if url.host_str().is_none_or(str::is_empty) {
        return Err(DownloadError::invalid("The link is missing a server name."));
    }
    Ok(url)
}

/// A parsed `Content-Range: bytes start-end/total` header (end inclusive).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ContentRange {
    pub start: u64,
    pub end: u64,
    pub total: Option<u64>,
}

pub(crate) fn parse_content_range(value: &str) -> Option<ContentRange> {
    let rest = value.trim().strip_prefix("bytes")?;
    if !rest.starts_with([' ', '\t']) {
        return None;
    }
    let (range, total) = rest.trim_start().split_once('/')?;
    let total = match total.trim() {
        "*" => None,
        t => Some(t.parse::<u64>().ok()?),
    };
    let (start, end) = range.trim().split_once('-')?;
    let start = start.trim().parse::<u64>().ok()?;
    let end = end.trim().parse::<u64>().ok()?;
    if end < start || total.is_some_and(|t| end >= t) {
        return None;
    }
    Some(ContentRange { start, end, total })
}

pub(crate) fn header_str(headers: &HeaderMap, name: header::HeaderName) -> Option<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
}

pub(crate) fn content_length(headers: &HeaderMap) -> Option<u64> {
    header_str(headers, header::CONTENT_LENGTH).and_then(|v| v.parse().ok())
}

pub(crate) fn content_range(headers: &HeaderMap) -> Option<ContentRange> {
    header_str(headers, header::CONTENT_RANGE).and_then(|v| parse_content_range(&v))
}

pub(crate) fn validators(headers: &HeaderMap) -> Validators {
    Validators {
        etag: header_str(headers, header::ETAG).filter(|s| !s.is_empty()),
        last_modified: header_str(headers, header::LAST_MODIFIED).filter(|s| !s.is_empty()),
    }
}

pub(crate) fn accepts_byte_ranges(headers: &HeaderMap) -> bool {
    header_str(headers, header::ACCEPT_RANGES)
        .is_some_and(|v| v.split(',').any(|t| t.trim().eq_ignore_ascii_case("bytes")))
}

pub(crate) fn retry_after(headers: &HeaderMap) -> Option<Duration> {
    header_str(headers, header::RETRY_AFTER)
        .and_then(|v| v.parse::<u64>().ok())
        .map(Duration::from_secs)
}

/// True when a ranged response belongs to a different version of the
/// resource than the one we already have data for.
pub(crate) fn validators_changed(known: &Validators, got: &Validators) -> bool {
    match (known.strong_etag(), got.etag.as_deref()) {
        (Some(a), Some(b)) => return a != b,
        (Some(_), None) => {}
        (None, _) => {}
    }
    matches!((&known.last_modified, &got.last_modified), (Some(a), Some(b)) if a != b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_range_parsing() {
        assert_eq!(
            parse_content_range("bytes 0-99/100"),
            Some(ContentRange {
                start: 0,
                end: 99,
                total: Some(100)
            })
        );
        assert_eq!(
            parse_content_range("bytes 5-9/*"),
            Some(ContentRange {
                start: 5,
                end: 9,
                total: None
            })
        );
        assert_eq!(parse_content_range("bytes */100"), None);
        assert_eq!(parse_content_range("bytes 9-5/100"), None);
        assert_eq!(parse_content_range("bytes 0-100/100"), None);
        assert_eq!(parse_content_range("items 0-1/2"), None);
        assert_eq!(parse_content_range("bytes0-1/2"), None);
    }

    #[test]
    fn redirect_rules() {
        let https = Url::parse("https://a.example/x").unwrap();
        let http = Url::parse("http://b.example/x").unwrap();
        let ftp = Url::parse("ftp://c.example/x").unwrap();
        assert!(check_redirect(1, Some(&https), &https).is_ok());
        assert!(check_redirect(1, Some(&http), &https).is_ok());
        assert!(check_redirect(1, Some(&http), &http).is_ok());
        assert!(check_redirect(1, Some(&https), &http).is_err());
        assert!(check_redirect(1, Some(&http), &ftp).is_err());
        assert!(check_redirect(MAX_REDIRECTS, Some(&http), &http).is_err());
    }

    #[test]
    fn url_validation() {
        assert!(parse_url("https://example.com/a.zip").is_ok());
        assert!(parse_url("  http://example.com  ").is_ok());
        assert!(parse_url("ftp://example.com/a").is_err());
        assert!(parse_url("file:///C:/x").is_err());
        assert!(parse_url("not a url").is_err());
    }

    #[test]
    fn change_detection() {
        let known = Validators {
            etag: Some("\"a\"".into()),
            last_modified: None,
        };
        assert!(!validators_changed(
            &known,
            &Validators {
                etag: Some("\"a\"".into()),
                last_modified: None
            }
        ));
        assert!(validators_changed(
            &known,
            &Validators {
                etag: Some("\"b\"".into()),
                last_modified: None
            }
        ));
        let lm = Validators {
            etag: None,
            last_modified: Some("Mon".into()),
        };
        assert!(validators_changed(
            &lm,
            &Validators {
                etag: None,
                last_modified: Some("Tue".into())
            }
        ));
        assert!(!validators_changed(&lm, &Validators::default()));
    }
}
