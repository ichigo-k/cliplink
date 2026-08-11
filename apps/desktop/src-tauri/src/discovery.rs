//! mDNS advertisement so ClipLink phones can find this PC by name on the LAN,
//! without needing a stored IP address that may have changed.
//!
//! Advertises `_cliplink._tcp.local.` with the sync port and the device ID as
//! a TXT property. The Android client resolves this before falling back to the
//! stored host list, giving seamless reconnection even after a DHCP lease
//! changes the PC's IP.
//!
//! Re-advertisement on network change:
//! A background thread polls the machine's IPv4 addresses every 10 seconds.
//! When the set of addresses changes (new Wi-Fi, VPN connect/disconnect, etc.)
//! it unregisters the old service and registers a fresh one. Paired phones
//! pick up the new address within one mDNS TTL (~10 s) and reconnect.

use mdns_sd::{ServiceDaemon, ServiceInfo};
use std::{
    collections::HashSet,
    net::IpAddr,
    time::Duration,
};

const SERVICE_TYPE: &str = "_cliplink._tcp.local.";
const POLL_INTERVAL: Duration = Duration::from_secs(10);

/// Starts advertising this PC on the local network and watches for IP changes.
/// Returns the daemon so the caller can keep it alive for the process lifetime.
pub fn advertise(device_id: &str, device_name: &str, port: u16) -> Option<ServiceDaemon> {
    let daemon = ServiceDaemon::new().ok()?;

    let instance_name = make_instance_name(device_name, device_id);
    register(&daemon, &instance_name, device_id, port);

    // Spawn the re-advertisement watcher.
    let daemon_clone = daemon.clone();
    let device_id = device_id.to_string();
    let device_name = device_name.to_string();
    std::thread::spawn(move || {
        let mut last_addrs = current_ipv4_addrs();
        loop {
            std::thread::sleep(POLL_INTERVAL);
            let current = current_ipv4_addrs();
            if current != last_addrs {
                last_addrs = current;
                // Unregister the old record then immediately re-register with
                // the current addresses. mdns-sd will send a goodbye packet for
                // the old record so phones stop caching it.
                let full_name = format!("{}.{}", instance_name, SERVICE_TYPE);
                let _ = daemon_clone.unregister(&full_name);
                // Small pause so the goodbye packet goes out before the new
                // announcement arrives.
                std::thread::sleep(Duration::from_millis(200));
                register(&daemon_clone, &instance_name, &device_id, port);
                eprintln!("ClipLink: network changed — mDNS re-advertised.");
            }
        }
    });

    Some(daemon)
}

fn register(daemon: &ServiceDaemon, instance: &str, device_id: &str, port: u16) {
    let mut properties = std::collections::HashMap::new();
    properties.insert("id".to_string(), device_id.to_string());
    properties.insert("port".to_string(), port.to_string());

    let Ok(info) = ServiceInfo::new(
        SERVICE_TYPE,
        instance,
        &format!("{}.local.", hostname_or_fallback()),
        // Empty = bind to all available interfaces.
        "",
        port,
        properties,
    ) else {
        return;
    };

    if let Err(e) = daemon.register(info) {
        eprintln!("ClipLink: mDNS register failed: {e}");
    }
}

fn make_instance_name(device_name: &str, device_id: &str) -> String {
    format!(
        "{}-{}",
        device_name.replace(['.', '/'], "-"),
        &device_id[..8.min(device_id.len())]
    )
}

/// Returns the set of non-loopback, non-link-local IPv4 addresses.
fn current_ipv4_addrs() -> HashSet<String> {
    local_ip_address::list_afinet_netifas()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(_, ip)| match ip {
            IpAddr::V4(v4) if !v4.is_loopback() && !v4.is_link_local() => {
                Some(v4.to_string())
            }
            _ => None,
        })
        .collect()
}

fn hostname_or_fallback() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "cliplink-pc".to_string())
}
