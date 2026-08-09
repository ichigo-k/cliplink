//! mDNS advertisement so ClipLink phones can find this PC by name on the LAN,
//! without needing a stored IP address that may have changed.
//!
//! Advertises `_cliplink._tcp.local.` with the sync port and the device ID as
//! a TXT property. The Android client resolves this before falling back to the
//! stored host list, giving seamless reconnection even after a DHCP lease
//! changes the PC's IP.

use mdns_sd::{ServiceDaemon, ServiceInfo};
use std::collections::HashMap;

const SERVICE_TYPE: &str = "_cliplink._tcp.local.";

/// Starts advertising this PC on the local network. Returns immediately;
/// the daemon runs in its own thread until dropped.
///
/// Returns the daemon so the caller can keep it alive for the process lifetime.
pub fn advertise(device_id: &str, device_name: &str, port: u16) -> Option<ServiceDaemon> {
    let daemon = ServiceDaemon::new().ok()?;

    // mDNS instance names must be unique and human-readable.
    // Slashes and dots are not allowed; replace with dashes.
    let instance = format!(
        "{}-{}",
        device_name.replace(['.', '/'], "-"),
        &device_id[..8.min(device_id.len())]
    );

    let mut properties = HashMap::new();
    properties.insert("id".to_string(), device_id.to_string());
    properties.insert("port".to_string(), port.to_string());

    let info = ServiceInfo::new(
        SERVICE_TYPE,
        &instance,
        &format!("{}.local.", hostname_or_fallback()),
        // Empty string = use all available interfaces.
        "",
        port,
        properties,
    )
    .ok()?;

    daemon.register(info).ok()?;
    Some(daemon)
}

fn hostname_or_fallback() -> String {
    std::env::var("COMPUTERNAME")
        .unwrap_or_else(|_| "cliplink-pc".to_string())
}
