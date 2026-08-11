//! Watches the Windows clipboard and applies incoming content to it.
//! Supports both text and images (PNG/JPEG screenshots, snips, etc.).

use crate::crypto::hash_hex;
use arboard::ImageData;
// Brings `write_image` into scope for PngEncoder in rgba_to_png.
use image::ImageEncoder;
use std::{
    borrow::Cow,
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

const POLL_INTERVAL: Duration = Duration::from_millis(500);
const SUPPRESSION_TTL: Duration = Duration::from_secs(5);

// ─── Echo suppressor ─────────────────────────────────────────────────────────

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

// ─── Clipboard content type ───────────────────────────────────────────────────

/// Whatever was on the clipboard at a given moment.
#[derive(Clone, Debug)]
pub enum ClipboardContent {
    Text(String),
    /// HTML source string (for rich text copies from browsers/Office).
    Html {
        html: String,
        plain: String,
    },
    /// Raw PNG bytes ready to send over the wire.
    Image(Vec<u8>),
}

impl ClipboardContent {
    pub fn hash(&self) -> String {
        match self {
            ClipboardContent::Text(t) => hash_hex(t.as_bytes()),
            ClipboardContent::Html { html, .. } => hash_hex(html.as_bytes()),
            ClipboardContent::Image(b) => hash_hex(b),
        }
    }

    pub fn content_type(&self) -> &'static str {
        match self {
            ClipboardContent::Text(_) => "text/plain",
            ClipboardContent::Html { .. } => "text/html",
            ClipboardContent::Image(_) => "image/png",
        }
    }
}

// ─── Read ─────────────────────────────────────────────────────────────────────

pub fn read_text() -> Option<String> {
    arboard::Clipboard::new()
        .ok()?
        .get_text()
        .ok()
        .filter(|t| !t.is_empty())
}

/// Reads the clipboard and returns whatever is there.
/// Priority: HTML > plain text > image.
pub fn read_any() -> Option<ClipboardContent> {
    let mut cb = arboard::Clipboard::new().ok()?;

    // Try HTML first — richer than plain text, same clipboard slot.
    // arboard exposes get_html() on Windows/macOS.
    #[cfg(target_os = "windows")]
    if let Ok(html) = cb.get_html() {
        if !html.is_empty() {
            let plain = cb.get_text().unwrap_or_default();
            return Some(ClipboardContent::Html { html, plain });
        }
    }

    // Plain text fallback.
    if let Ok(t) = cb.get_text() {
        if !t.is_empty() {
            return Some(ClipboardContent::Text(t));
        }
    }

    // Image fallback.
    if let Ok(img) = cb.get_image() {
        if let Some(png) = rgba_to_png(&img) {
            return Some(ClipboardContent::Image(png));
        }
    }

    None
}

// ─── Write ────────────────────────────────────────────────────────────────────

/// Writes `text` to the clipboard and marks it so our own watcher ignores it.
pub fn apply_text(text: &str, suppressor: &EchoSuppressor) -> Result<(), String> {
    suppressor.suppress(&hash_hex(text.as_bytes()));
    arboard::Clipboard::new()
        .and_then(|mut c| c.set_text(text.to_string()))
        .map_err(|e| format!("Could not write text to the clipboard: {e}"))
}

/// Writes HTML + plain fallback to the clipboard (Windows CF_HTML format).
pub fn apply_html(html: &str, plain: &str, suppressor: &EchoSuppressor) -> Result<(), String> {
    suppressor.suppress(&hash_hex(html.as_bytes()));
    #[cfg(target_os = "windows")]
    {
        arboard::Clipboard::new()
            .map_err(|e| e.to_string())?
            .set_html(html, Some(plain))
            .map_err(|e| format!("Could not write HTML to the clipboard: {e}"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        apply_text(plain, suppressor)
    }
}

/// Decodes `png_bytes` and writes the image to the clipboard, suppressing
/// the resulting watcher event so we don't echo it back.
pub fn apply_image(png_bytes: &[u8], suppressor: &EchoSuppressor) -> Result<(), String> {
    let hash = hash_hex(png_bytes);
    suppressor.suppress(&hash);

    let img = image::load_from_memory(png_bytes)
        .map_err(|e| format!("Could not decode image: {e}"))?
        .to_rgba8();

    let (width, height) = img.dimensions();
    let pixels = img.into_raw();

    let image_data = ImageData {
        width: width as usize,
        height: height as usize,
        bytes: Cow::Owned(pixels),
    };

    arboard::Clipboard::new()
        .map_err(|e| e.to_string())?
        .set_image(image_data)
        .map_err(|e| format!("Could not write image to the clipboard: {e}"))
}

// ─── Watch ────────────────────────────────────────────────────────────────────

/// Polls for clipboard changes and calls `on_copy` with each new item.
///
/// Detects both text and image changes. A dedicated OS thread rather than a
/// tokio task: `arboard` is blocking, and the Windows clipboard wants to be
/// touched from a consistent thread.
pub fn watch<F>(suppressor: EchoSuppressor, on_copy: F)
where
    F: Fn(ClipboardContent) + Send + 'static,
{
    std::thread::spawn(move || {
        let mut last_hash = read_any()
            .as_ref()
            .map(ClipboardContent::hash)
            .unwrap_or_default();

        loop {
            std::thread::sleep(POLL_INTERVAL);

            let Some(current) = read_any() else { continue };
            let hash = current.hash();

            if hash == last_hash {
                continue;
            }
            last_hash = hash.clone();

            if !suppressor.should_ignore(&hash) {
                on_copy(current);
            }
        }
    });
}

// ─── PNG helpers ─────────────────────────────────────────────────────────────

/// Encodes an arboard RGBA8 image as PNG bytes. Returns None on failure.
fn rgba_to_png(img: &ImageData<'_>) -> Option<Vec<u8>> {
    let mut buf = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut buf);
    encoder
        .write_image(
            img.bytes.as_ref(),
            img.width as u32,
            img.height as u32,
            image::ExtendedColorType::Rgba8,
        )
        .ok()?;
    Some(buf)
}

/// Encode PNG bytes as a `data:image/png;base64,…` string for the UI.
pub fn png_to_data_url(png_bytes: &[u8]) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine};
    format!("data:image/png;base64,{}", STANDARD.encode(png_bytes))
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suppressed_content_is_ignored_exactly_once() {
        let suppressor = EchoSuppressor::default();
        suppressor.suppress("abc");
        assert!(
            suppressor.should_ignore("abc"),
            "write we just made should be ignored"
        );
        assert!(
            !suppressor.should_ignore("abc"),
            "second copy is a real user action"
        );
    }

    #[test]
    fn unrelated_content_is_never_ignored() {
        let suppressor = EchoSuppressor::default();
        suppressor.suppress("abc");
        assert!(!suppressor.should_ignore("xyz"));
    }
}
