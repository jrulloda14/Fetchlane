//! Transfer-rate estimation over a short sliding window.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

const WINDOW: Duration = Duration::from_secs(5);
const MIN_SPAN: Duration = Duration::from_millis(400);

#[derive(Debug, Default)]
pub(crate) struct SpeedMeter {
    samples: VecDeque<(Instant, u64)>,
}

impl SpeedMeter {
    pub fn sample(&mut self, now: Instant, bytes: u64) {
        if self.samples.back().is_some_and(|&(_, b)| bytes < b) {
            // Progress went backwards (restart from scratch); start over.
            self.samples.clear();
        }
        self.samples.push_back((now, bytes));
        while self.samples.len() > 2 && now.duration_since(self.samples[0].0) > WINDOW {
            self.samples.pop_front();
        }
    }

    pub fn reset(&mut self) {
        self.samples.clear();
    }

    /// Bytes per second, once enough time has been observed.
    pub fn rate(&self) -> Option<u64> {
        let (t0, b0) = *self.samples.front()?;
        let (t1, b1) = *self.samples.back()?;
        let span = t1.duration_since(t0);
        (span >= MIN_SPAN).then(|| ((b1 - b0) as f64 / span.as_secs_f64()) as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_rate_and_resets_on_regression() {
        let mut m = SpeedMeter::default();
        let t = Instant::now();
        m.sample(t, 0);
        assert_eq!(m.rate(), None);
        m.sample(t + Duration::from_secs(1), 1000);
        assert_eq!(m.rate(), Some(1000));
        m.sample(t + Duration::from_secs(2), 10);
        assert_eq!(m.rate(), None);
    }
}
