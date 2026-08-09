//! Watches the Windows clipboard and applies incoming content to it.

use crate::crypto::hash_hex;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

const POLL_INTERVAL: Duration = Duration::from_millis(500);
const SUPPRESSION_TTL: Duration = Duration::from_secs(5);

/// Remembers content we just wrote ourselves, so the watcher can tell "the user
/// copied something" apart from "we applied what the phone sent" and not bounce
/// it straight back. Without this the two devices ping-pong forever.
#[derive(Clone, Default)]
pub struct EchoSuppressor {
    seen: Arc<Mutex<HashMap<String, Instant>>>,
}

impl EchoSuppressor {
    pub fn suppress(&self, hash: &str) {
        if let Ok(mut seen) = self.seen.lock() {
            seen.retain(|_, expiry| *expiry > Instant::now());
            seen.insert(hash.to_string(), Instant::now() + SUPPRESSION_TTL);
        }
    }

    /// True if this change was ours. Consumes the entry either way.
    pub fn should_ignore(&self, hash: &str) -> bool {
        let Ok(mut seen) = self.seen.lock() else {
            return false;
        };
        match seen.remove(hash) {
            Some(expiry) => expiry > Instant::now(),
            None => false,
        }
    }
}

pub fn read_text() -> Option<String> {
    arboard::Clipboard::new()
        .ok()?
        .get_text()
        .ok()
        .filter(|t| !t.is_empty())
}

/// Writes `text` to the clipboard and marks it so our own watcher ignores it.
pub fn apply_text(text: &str, suppressor: &EchoSuppressor) -> Result<(), String> {
    suppressor.suppress(&hash_hex(text.as_bytes()));

    arboard::Clipboard::new()
        .and_then(|mut c| c.set_text(text.to_string()))
        .map_err(|e| format!("Could not write to the clipboard: {e}"))
}

/// Writes text to the clipboard then simulates Ctrl+V so it pastes immediately
/// into whatever window had focus before the overlay appeared.
///
/// The small sleep gives the OS time to re-focus the previous window after the
/// overlay is hidden — without it the paste lands in no-man's-land.
pub fn apply_and_paste(text: &str, suppressor: &EchoSuppressor) -> Result<(), String> {
    apply_text(text, suppressor)?;

    std::thread::spawn(|| {
        // 80 ms — enough for the overlay hide animation and window re-focus
        std::thread::sleep(std::time::Duration::from_millis(80));

        use enigo::{Direction::Click, Enigo, Key, Keyboard, Settings};
        if let Ok(mut enigo) = Enigo::new(&Settings::default()) {
            let _ = enigo.key(Key::Control, enigo::Direction::Press);
            let _ = enigo.key(Key::Unicode('v'), Click);
            let _ = enigo.key(Key::Control, enigo::Direction::Release);
        }
    });

    Ok(())
}

/// Polls for local copies and hands each new one to `on_copy`.
///
/// A dedicated OS thread rather than a tokio task: `arboard` is blocking, and
/// the Windows clipboard wants to be touched from a consistent thread.
pub fn watch<F>(suppressor: EchoSuppressor, on_copy: F)
where
    F: Fn(String) + Send + 'static,
{
    std::thread::spawn(move || {
        let mut last = read_text().unwrap_or_default();

        loop {
            std::thread::sleep(POLL_INTERVAL);

            let Some(current) = read_text() else { continue };
            if current == last {
                continue;
            }
            last = current.clone();

            if !suppressor.should_ignore(&hash_hex(current.as_bytes())) {
                on_copy(current);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suppressed_content_is_ignored_exactly_once() {
        let suppressor = EchoSuppressor::default();
        suppressor.suppress("abc");

        assert!(
            suppressor.should_ignore("abc"),
            "the write we just made should be ignored"
        );
        assert!(
            !suppressor.should_ignore("abc"),
            "a second copy of the same text is a real user action and must sync"
        );
    }

    #[test]
    fn unrelated_content_is_never_ignored() {
        let suppressor = EchoSuppressor::default();
        suppressor.suppress("abc");
        assert!(!suppressor.should_ignore("xyz"));
    }
}
