// Must be first: noble's randomBytes needs crypto.getRandomValues
import 'react-native-get-random-values';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  type AppStateStatus,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { identityFromB64, secretToB64, type Identity } from '@cliplink/crypto';
import { parsePairingOffer, type PairingOffer } from '@cliplink/protocol';
import { newIdentity, SyncClient, type Status } from './src/client';
import {
  startBackgroundSync,
  stopBackgroundSync,
  updateBackgroundStatus,
} from './src/backgroundSync';
import {
  isAccessibilityServiceEnabled,
  openAccessibilitySettings,
  onClipboardChanged,
} from './src/clipboardService';
import {
  isNotificationListenerEnabled,
  openNotificationListenerSettings,
  dismissNotification,
  onNotificationPosted,
  onNotificationRemoved,
} from './src/notificationService';
import {
  drainPendingShare,
  onShareReceived,
  MAX_SHARE_BYTES,
  type SharedItem,
} from './src/shareService';
import { SettingsScreen } from './src/SettingsScreen';
import { useUpdater, type Updater } from './src/useUpdater';
import { C } from './src/theme';

/**
 * How many offline clips to hold before the oldest start falling off.
 *
 * Bounded because the queue survives an arbitrarily long disconnection and a
 * clip can be a full document's worth of text.
 */
const MAX_PENDING_CLIPS = 20;

const IDENTITY_KEY = 'cliplink.identity';
const OFFER_KEY = 'cliplink.offer';
const LAST_HOST_KEY = 'cliplink.lastHost';

type Toast = { message: string; type: 'success' | 'error' | 'info' };

type ReceivedClip = { text: string; imageB64?: string; fileName?: string; filePath?: string; at: number };

export default function App() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [offer, setOffer] = useState<PairingOffer | null>(null);
  const [lastHost, setLastHost] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const [scanning, setScanning] = useState(false);
  const [received, setReceived] = useState<ReceivedClip[]>([]);
  const [notice, setNotice] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [toast, setToast] = useState<Toast | null>(null);
  const [manualSent, setManualSent] = useState(false);
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const [accessibilityEnabled, setAccessibilityEnabled] = useState(true); // optimistic
  const [notifListenerEnabled, setNotifListenerEnabled] = useState(true); // optimistic

  const updater = useUpdater();

  const client = useRef<SyncClient | null>(null);
  const handledScan = useRef(false);
  const lastSentRef = useRef('');
  /**
   * Clips copied while the socket was down, oldest first.
   *
   * send() reports failure by returning false, and we used to drop the clip on
   * the floor when it did. On a phone that is the common case rather than the
   * rare one: dozing, a Wi-Fi handover, or the screen going off all break the
   * socket for a few seconds while the user carries on copying, and every copy
   * made inside that window was gone for good. Holding them here and flushing
   * on reconnect is what makes "copy on the phone, paste on the PC" dependable
   * rather than dependent on the radio.
   *
   * Ordered and replayed in full rather than collapsed to the newest, because
   * the PC keeps clipboard history: the end state of its clipboard is the same
   * either way, but replaying everything is what keeps the history honest.
   */
  const pendingClips = useRef<string[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // In-progress file transfers from PC: transferId → { chunks, total, fileName, mimeType }
  const fileBuffers = useRef<Map<string, {
    chunks: Map<number, Uint8Array>;
    total: number;
    fileName: string;
    mimeType: string;
  }>>(new Map());

  /* ── Toast ── */
  const showToast = useCallback((message: string, type: Toast['type'] = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  /* ── Bootstrap ── */
  useEffect(() => {
    (async () => {
      const storedSecret = await SecureStore.getItemAsync(IDENTITY_KEY);
      if (storedSecret) {
        setIdentity(identityFromB64(storedSecret));
      } else {
        const fresh = newIdentity();
        await SecureStore.setItemAsync(IDENTITY_KEY, secretToB64(fresh));
        setIdentity(fresh);
      }
      const storedOffer = await SecureStore.getItemAsync(OFFER_KEY);
      if (storedOffer) {
        try { setOffer(JSON.parse(storedOffer)); }
        catch { await SecureStore.deleteItemAsync(OFFER_KEY); }
      }
      const storedLastHost = await SecureStore.getItemAsync(LAST_HOST_KEY);
      if (storedLastHost) setLastHost(storedLastHost);
    })();
  }, []);

  /* ── Accessibility service — check on mount and when app foregrounds ── */
  useEffect(() => {
    const check = async () => {
      const [acc, notif] = await Promise.all([
        isAccessibilityServiceEnabled(),
        isNotificationListenerEnabled(),
      ]);
      setAccessibilityEnabled(acc);
      setNotifListenerEnabled(notif);
    };
    check();
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') check();
    });
    return () => sub.remove();
  }, []);

  /* ── Forward phone notifications to the PC via WebSocket ── */
  useEffect(() => {
    const unsubPosted = onNotificationPosted((n) => {
      client.current?.sendNotification(n);
    });
    const unsubRemoved = onNotificationRemoved((key) => {
      client.current?.sendNotificationRemoved(key);
    });
    return () => { unsubPosted(); unsubRemoved(); };
  }, []);

  /**
   * Pushes the backlog, keeping anything the socket still will not take.
   *
   * Called on every transition to connected, which the client emits directly
   * after deriving the session key, so send() has everything it needs by then.
   */
  const flushPendingClips = useCallback(() => {
    const c = client.current;
    if (!c || pendingClips.current.length === 0) return;

    const queued = pendingClips.current;
    pendingClips.current = [];
    for (let i = 0; i < queued.length; i++) {
      if (!c.send(queued[i])) {
        // The socket went away again mid-flush. Keep the remainder, including
        // the one that just failed, for the next time we come up.
        pendingClips.current = queued.slice(i);
        return;
      }
      lastSentRef.current = queued[i];
    }
  }, []);

  /* ── Auto-sync from accessibility service clipboard events ── */
  useEffect(() => {
    const unsub = onClipboardChanged((text) => {
      if (!text || text === lastSentRef.current) return;

      // Silent on success, so it does not interrupt whatever the user is doing.
      if (client.current?.send(text)) {
        lastSentRef.current = text;
        return;
      }

      // Not connected. Hold it rather than lose it.
      const queue = pendingClips.current;
      if (queue[queue.length - 1] === text) return; // same clip, fired twice
      queue.push(text);
      if (queue.length > MAX_PENDING_CLIPS) {
        queue.splice(0, queue.length - MAX_PENDING_CLIPS);
      }
    });
    return unsub;
  }, []);

  /* ── Hardware back closes a sub-screen rather than quitting the app ── */
  useEffect(() => {
    if (!showSettings && !scanning) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setShowSettings(false);
      setScanning(false);
      return true; // handled — don't let Android pop the activity
    });
    return () => sub.remove();
  }, [showSettings, scanning]);

  /* ── Socket lifecycle ── */
  useEffect(() => {
    if (!offer || !identity) return;

    // Start the foreground service immediately — before the connection
    // attempt. This is the key fix: the service must be alive *before*
    // we go to the background, not only once connected. If we only start
    // it on 'connected' and then the socket drops while backgrounded,
    // the service gets stopped on the 'error' state, Android suspends the
    // JS bridge, and the scheduled reconnect never fires. By keeping the
    // service alive for the entire paired session (start here, stop only
    // on unmount/unpair), the JS thread stays warm through all reconnects.
    startBackgroundSync().then(() => updateBackgroundStatus('connecting'));

    const sync = new SyncClient(offer, identity, 'Android phone', {
      onStatus: (s) => {
        setStatus(s);
        if (s.state === 'connected') {
          const h = (sync as any).host as string | undefined;
          if (h) {
            setLastHost(h);
            SecureStore.setItemAsync(LAST_HOST_KEY, h).catch(() => { });
          }
          updateBackgroundStatus('connected', s.deviceName);
          // Anything copied while we were down goes out now.
          flushPendingClips();
        } else if (s.state === 'connecting') {
          updateBackgroundStatus('connecting');
        } else if (s.state === 'error') {
          updateBackgroundStatus('reconnecting');
        }
      },
      onClip: async (text) => {
        try { await Clipboard.setStringAsync(text); } catch { /* best effort */ }
        // Auto-open URLs that come from the PC
        const trimmed = text.trim();
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          try {
            const { Linking } = await import('react-native');
            const canOpen = await Linking.canOpenURL(trimmed);
            if (canOpen) Linking.openURL(trimmed);
          } catch { /* best effort */ }
        }
        setReceived(prev => [{ text, at: Date.now() }, ...prev].slice(0, 20));
        showToast('Clipboard synced from PC ✓', 'info');
      },
      onImageClip: async (pngBase64) => {
        try {
          const path = `${FileSystem.cacheDirectory}cliplink_incoming.png`;
          await FileSystem.writeAsStringAsync(path, pngBase64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          await Clipboard.setImageAsync(path);
        } catch { /* best effort */ }
        setReceived(prev => [{ imageB64: pngBase64, text: '', at: Date.now() }, ...prev].slice(0, 20));
        showToast('Image synced from PC ✓', 'info');
      },
      onFileStart: (transferId, fileName, totalChunks, mimeType) => {
        fileBuffers.current.set(transferId, {
          chunks: new Map(),
          total: totalChunks,
          fileName,
          mimeType,
        });
        showToast(`Receiving ${fileName}…`, 'info');
      },
      onFileChunk: async (transferId, chunkIndex, totalChunks, data) => {
        const buf = fileBuffers.current.get(transferId);
        if (!buf) return;
        buf.chunks.set(chunkIndex, data);

        // All chunks received — reassemble and save
        if (buf.chunks.size === totalChunks) {
          const assembled = new Uint8Array(
            Array.from({ length: totalChunks }, (_, i) => buf.chunks.get(i)!)
              .flatMap(chunk => Array.from(chunk))
          );
          fileBuffers.current.delete(transferId);

          // Convert to base64 and save to Downloads via expo-file-system
          try {
            const b64 = btoa(String.fromCharCode(...assembled));
            const dest = `${FileSystem.documentDirectory}${buf.fileName}`;
            await FileSystem.writeAsStringAsync(dest, b64, {
              encoding: FileSystem.EncodingType.Base64,
            });
            // Send ack
            client.current?.sendFileAck(transferId, true);
            setReceived(prev => [{
              text: '',
              fileName: buf.fileName,
              filePath: dest,
              at: Date.now(),
            }, ...prev].slice(0, 20));
            showToast(`${buf.fileName} saved ✓`, 'success');
          } catch (e) {
            client.current?.sendFileAck(transferId, false, String(e));
            showToast(`Failed to save ${buf.fileName}`, 'error');
          }
        }
      },
      onFileComplete: (transferId) => {
        fileBuffers.current.delete(transferId);
      },
      onNotificationDismiss: (key) => {
        // PC dismissed the mirrored notification — dismiss it on the phone too
        dismissNotification(key);
      },
    }, lastHost);
    client.current = sync;
    sync.connect();
    return () => {
      sync.close();
      client.current = null;
      // Stop the service only here — when the component unmounts (app fully
      // closed) or the user unpairs. Not on disconnect/error.
      stopBackgroundSync();
    };
  }, [offer, identity, showToast, flushPendingClips]);

  /* ── Auto-send on foreground ── */
  const tryAutoSend = useCallback(async () => {
    const c = client.current;
    if (!c || status.state !== 'connected') return;

    // Try image first — if the user took a screenshot it lands as an image
    // on the clipboard, not text.
    try {
      const hasImage = await Clipboard.hasImageAsync();
      if (hasImage) {
        const img = await Clipboard.getImageAsync({ format: 'png' });
        const b64 = img?.data ?? null;
        if (b64 && b64 !== lastSentRef.current) {
          const binary = atob(b64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          if (c.sendImage(bytes)) {
            lastSentRef.current = b64;
            showToast('Image sent to your PC ✓');
            return;
          }
        }
      }
    } catch { /* image clipboard read may not be available */ }

    // Fallback to text
    const text = await Clipboard.getStringAsync();
    if (!text || text === lastSentRef.current) return;
    if (c.send(text)) {
      lastSentRef.current = text;
      showToast('Sent to your PC ✓');
    }
  }, [status, showToast]);

  useEffect(() => {
    tryAutoSend();
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') tryAutoSend();
    });
    return () => sub.remove();
  }, [tryAutoSend]);

  /* ── Share sheet: text, images, documents, multi-select ── */

  /**
   * Sends one shared item. Files are read off the cache copy the native side
   * made for us, so the sender's content:// grant no longer matters.
   */
  const sendSharedItem = useCallback(async (item: SharedItem): Promise<boolean> => {
    const c = client.current;
    if (!c) return false;

    if (item.kind === 'text') {
      if (!c.send(item.text)) return false;
      lastSentRef.current = item.text;
      return true;
    }

    if (item.size > MAX_SHARE_BYTES) {
      showToast(`${item.name} is too large to send`, 'error');
      // Consumed deliberately — retrying will not make it smaller.
      return true;
    }

    try {
      const b64 = await FileSystem.readAsStringAsync(item.path, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      // An image goes over the clipboard channel so it lands on the PC
      // clipboard ready to paste; everything else is a file transfer.
      const ok = item.mime.startsWith('image/')
        ? c.sendImage(bytes)
        : c.sendFile(bytes, item.name, item.mime) !== null;

      if (ok) FileSystem.deleteAsync(item.path, { idempotent: true }).catch(() => { });
      return ok;
    } catch {
      showToast(`Could not read ${item.name}`, 'error');
      return true; // Unreadable is permanent — do not retry forever.
    }
  }, [showToast]);

  /**
   * Sends a batch, waiting for the socket if the app was launched by the share
   * itself and the connection has not come up yet.
   */
  const handleShared = useCallback(async (items: SharedItem[]) => {
    if (!items.length) return;

    let attempts = 0;
    const queue = [...items];
    while (queue.length && attempts < 20) {
      const item = queue[0];
      if (await sendSharedItem(item)) {
        queue.shift();
        attempts = 0;
      } else {
        attempts++;
        await new Promise(r => setTimeout(r, 600));
      }
    }

    const sent = items.length - queue.length;
    if (sent > 0) {
      showToast(sent === 1 ? 'Shared to your PC ✓' : `${sent} items sent to your PC ✓`);
    }
    if (queue.length) {
      showToast('Could not reach your PC — is it running?', 'error');
    }
  }, [sendSharedItem, showToast]);

  // Cold launch: whatever the share sheet queued before React was ready.
  useEffect(() => {
    drainPendingShare().then(handleShared);
  }, [handleShared]);

  // Already running: Android reuses the activity and the module emits.
  useEffect(() => onShareReceived(handleShared), [handleShared]);

  /* ── QR scan ── */
  const onScan = useCallback(async ({ data }: { data: string }) => {
    if (handledScan.current) return;
    handledScan.current = true;
    const result = parsePairingOffer(data);
    if (!result.ok) {
      setNotice(result.reason);
      setTimeout(() => { handledScan.current = false; }, 1500);
      return;
    }
    setScanning(false);
    setNotice('');
    await SecureStore.setItemAsync(OFFER_KEY, JSON.stringify(result.offer));
    setOffer(result.offer);
    handledScan.current = false;
  }, []);

  const startScanning = useCallback(async () => {
    if (!permission?.granted) {
      const granted = await requestPermission();
      if (!granted.granted) {
        setNotice('ClipLink needs the camera to scan the pairing code.');
        return;
      }
    }
    handledScan.current = false;
    setNotice('');
    setScanning(true);
  }, [permission, requestPermission]);

  const sendClipboard = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    if (!text) return showToast('Clipboard is empty', 'error');
    if (client.current?.send(text)) {
      lastSentRef.current = text;
      setManualSent(true);
      showToast('Sent to your PC ✓');
      setTimeout(() => setManualSent(false), 1600);
    } else {
      showToast('Not connected yet', 'error');
    }
  }, [showToast]);

  const unpair = useCallback(async () => {
    await SecureStore.deleteItemAsync(OFFER_KEY);
    await SecureStore.deleteItemAsync(LAST_HOST_KEY);
    setOffer(null);
    setLastHost(undefined);
    setStatus({ state: 'idle' });
    setReceived([]);
    lastSentRef.current = '';
  }, []);

  const copyReceived = useCallback(async (text: string) => {
    await Clipboard.setStringAsync(text);
    showToast('Copied ✓');
  }, [showToast]);

  const copyReceivedImage = useCallback(async (b64: string) => {
    try {
      const path = `${FileSystem.cacheDirectory}cliplink_recopy.png`;
      await FileSystem.writeAsStringAsync(path, b64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await Clipboard.setImageAsync(path);
      showToast('Image copied ✓');
    } catch {
      showToast('Could not copy image', 'error');
    }
  }, [showToast]);

  const openFile = useCallback(async (filePath: string, fileName: string) => {
    try {
      const { Linking } = await import('react-native');
      await Linking.openURL(filePath);
    } catch {
      showToast(`Could not open ${fileName}`, 'error');
    }
  }, [showToast]);

  /* ── Settings screen ── */
  if (showSettings) {
    return <SettingsScreen updater={updater} onClose={() => setShowSettings(false)} />;
  }

  /* ── Scanner screen ── */
  if (scanning) {
    return (
      <View style={S.scanRoot}>
        <StatusBar style="light" />
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onScan}
        />
        <View style={S.scanDim} pointerEvents="none" />
        <View style={S.reticle} pointerEvents="none" />
        <SafeAreaView style={S.scanOverlay}>
          <Text style={S.scanHint}>Point at the QR code on your PC</Text>
          {!!notice && <Text style={S.errorText}>{notice}</Text>}
          <Pressable style={S.ghost} onPress={() => setScanning(false)}>
            <Text style={S.ghostText}>Cancel</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    );
  }

  const dotColor =
    status.state === 'connected' ? C.green :
      status.state === 'error' ? C.danger : C.faint;
  const isConnected = status.state === 'connected';
  const updateBadge = badgeFor(updater.phase);

  return (
    <SafeAreaView style={S.safe}>
      <StatusBar style="light" />

      {/* ── Toast ── */}
      {toast && (
        <View style={[S.toast,
        toast.type === 'error' && S.toastError,
        toast.type === 'info' && S.toastInfo,
        ]}>
          <Text style={S.toastText}>{toast.message}</Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={S.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={S.header}>
          <View style={S.logoWrap}>
            <Image source={require('./assets/adaptive-icon.png')} style={S.logo} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={S.brand}>ClipLink</Text>
            <Text style={S.tagline}>Clipboard, everywhere.</Text>
          </View>
          {/* Update pill — only while there is something newer to act on.
              Tapping goes to Settings rather than installing straight away, so
              the version and release notes are visible before committing. */}
          {!!updateBadge && (
            <Pressable
              style={[S.updateBadge, updateBadge.busy && S.updateBadgeDl]}
              onPress={() => setShowSettings(true)}
            >
              {updateBadge.busy
                ? <ActivityIndicator size={12} color="#fff" />
                : <Text style={S.updateBadgeText}>{updateBadge.label}</Text>}
            </Pressable>
          )}

          <Pressable style={S.gear} onPress={() => setShowSettings(true)} hitSlop={8}>
            <Text style={S.gearText}>⚙</Text>
          </Pressable>
        </View>

        {/* ── Status hero card ── */}
        <View style={[S.heroCard, isConnected && S.heroCardConnected]}>
          {/* Big status indicator */}
          <View style={S.heroTop}>
            <View style={[S.heroDot, {
              backgroundColor: dotColor,
              shadowColor: dotColor, shadowOpacity: isConnected ? 0.6 : 0,
              shadowRadius: 8, elevation: isConnected ? 4 : 0
            }]} />
            <Text style={S.heroStatus}>
              {offer ? statusTitle(status) : 'Not paired'}
            </Text>
            {status.state === 'connecting' && (
              <ActivityIndicator size="small" color={C.accentLt} style={{ marginLeft: 4 }} />
            )}
          </View>

          {/* Sub-text */}
          <Text style={S.heroSub}>
            {offer
              ? statusDetail(status, offer)
              : 'Open ClipLink on your Windows PC and scan the QR code shown there.'}
          </Text>

          {/* Error detail */}
          {status.state === 'error' && !!status.detail && (
            <View style={S.hintBox}>
              <Text style={S.hintText}>{status.detail}</Text>
            </View>
          )}
          {!!notice && <Text style={S.errorText}>{notice}</Text>}

          {/* CTA */}
          {!offer ? (
            <Pressable style={S.primary} onPress={startScanning}>
              <Text style={S.primaryText}>Scan pairing code</Text>
            </Pressable>
          ) : (
            isConnected && (
              <Pressable
                style={[S.primary, manualSent && S.primaryDone]}
                onPress={sendClipboard}
              >
                <Text style={S.primaryText}>
                  {manualSent ? '✓ Sent to PC' : 'Send clipboard now'}
                </Text>
              </Pressable>
            )
          )}
        </View>

        {/* ── Accessibility service nudge ── */}
        {!!offer && !accessibilityEnabled && (
          <View style={S.accessBanner}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={S.accessTitle}>Enable auto-sync</Text>
              <Text style={S.accessSub}>
                Allow ClipLink to detect copies so text syncs to your PC instantly — no tapping needed.
              </Text>
            </View>
            <Pressable style={S.accessBtn} onPress={openAccessibilitySettings}>
              <Text style={S.accessBtnText}>Enable</Text>
            </Pressable>
          </View>
        )}

        {/* ── Notification listener nudge ── */}
        {!!offer && !notifListenerEnabled && (
          <View style={[S.accessBanner, S.notifBanner]}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={S.accessTitle}>Mirror notifications</Text>
              <Text style={S.accessSub}>
                Let ClipLink forward your phone notifications to your PC so you never miss a message.
              </Text>
            </View>
            <Pressable style={[S.accessBtn, S.notifBtn]} onPress={openNotificationListenerSettings}>
              <Text style={S.accessBtnText}>Enable</Text>
            </Pressable>
          </View>
        )}

        {/* ── Paired device — managed here, not hidden behind a menu ── */}
        {!!offer && (
          <View style={S.section}>
            <Text style={S.sectionLabel}>Paired device</Text>

            <View style={S.devCard}>
              <View style={S.devHead}>
                <View style={[S.devDot, { backgroundColor: dotColor }]} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={S.devName} numberOfLines={1}>{offer.deviceName}</Text>
                  <Text style={S.devRole}>Windows host</Text>
                </View>
                <View style={[S.devPill, isConnected && S.devPillOn]}>
                  <Text style={[S.devPillText, isConnected && S.devPillTextOn]}>
                    {statusTitle(status)}
                  </Text>
                </View>
              </View>

              <View style={S.devRows}>
                <View style={S.devRow}>
                  <Text style={S.devKey}>Address</Text>
                  <Text style={S.devVal} numberOfLines={1}>
                    {lastHost ?? offer.host}:{offer.port}
                  </Text>
                </View>
                <View style={S.devRow}>
                  <Text style={S.devKey}>Clips received</Text>
                  <Text style={S.devVal}>{received.length}</Text>
                </View>
                <View style={[S.devRow, S.devRowLast]}>
                  <Text style={S.devKey}>Encryption</Text>
                  <Text style={S.devVal}>XChaCha20-Poly1305</Text>
                </View>
              </View>

              {confirmUnpair ? (
                <View style={S.devConfirm}>
                  <Text style={S.devConfirmText}>
                    Disconnect from {offer.deviceName}? You&apos;ll need to scan a new code to
                    pair again.
                  </Text>
                  <View style={S.devBtnRow}>
                    <Pressable
                      style={S.devBtnDanger}
                      onPress={() => { setConfirmUnpair(false); unpair(); }}
                    >
                      <Text style={S.devBtnDangerText}>Disconnect</Text>
                    </Pressable>
                    <Pressable style={S.devBtn} onPress={() => setConfirmUnpair(false)}>
                      <Text style={S.devBtnText}>Keep paired</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={S.devBtnRow}>
                  <Pressable style={S.devBtn} onPress={startScanning}>
                    <Text style={S.devBtnText}>Re-pair</Text>
                  </Pressable>
                  <Pressable style={S.devBtn} onPress={() => setConfirmUnpair(true)}>
                    <Text style={[S.devBtnText, { color: C.danger }]}>Disconnect</Text>
                  </Pressable>
                </View>
              )}
            </View>
          </View>
        )}

        {/* ── Received clips from PC ── */}
        {received.length > 0 && (
          <View style={S.section}>
            <Text style={S.sectionLabel}>From your PC</Text>
            {received.map((clip, i) => (
              <Pressable
                key={i}
                style={S.clipRow}
                onPress={() => clip.imageB64
                  ? copyReceivedImage(clip.imageB64)
                  : clip.filePath
                    ? openFile(clip.filePath, clip.fileName ?? 'file')
                    : copyReceived(clip.text)}
              >
                {clip.imageB64 ? (
                  <Image
                    source={{ uri: `data:image/png;base64,${clip.imageB64}` }}
                    style={S.clipImage}
                    resizeMode="contain"
                  />
                ) : clip.fileName ? (
                  <View style={S.fileRow}>
                    <Text style={S.fileIcon}>📄</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={S.clipText} numberOfLines={1}>{clip.fileName}</Text>
                      <Text style={S.fileSub}>Tap to open</Text>
                    </View>
                  </View>
                ) : (
                  <Text style={S.clipText} numberOfLines={2}>{clip.text}</Text>
                )}
                {!clip.fileName && (
                  <View style={S.copyTag}>
                    <Text style={S.copyTagText}>Re-copy</Text>
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/* ── Helpers ── */

/** The header pill, or null when there is no newer version to act on. */
function badgeFor(phase: Updater['phase']): { label: string; busy: boolean } | null {
  switch (phase.kind) {
    case 'available': return { label: `v${phase.update.version}`, busy: false };
    case 'downloading': return { label: '', busy: true };
    case 'ready': return { label: 'Install', busy: false };
    default: return null;
  }
}

function statusTitle(status: Status): string {
  switch (status.state) {
    case 'connected': return 'Connected';
    case 'connecting': return 'Connecting…';
    case 'error': return 'Unreachable';
    default: return 'Paired';
  }
}

function statusDetail(status: Status, offer: PairingOffer): string {
  switch (status.state) {
    case 'connected': return `Syncing with ${status.deviceName}`;
    case 'connecting': return `Trying ${status.host}…`;
    case 'error': return status.message;
    default: return `Paired with ${offer.deviceName}`;
  }
}

/* ── Styles ── */

const S = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: C.void,
    paddingTop: RNStatusBar.currentHeight ?? 0,
  },
  scroll: {
    padding: 18,
    paddingTop: 24,
    gap: 14,
  },

  /* Toast */
  toast: {
    position: 'absolute',
    top: (RNStatusBar.currentHeight ?? 0) + 10,
    left: 16,
    right: 16,
    zIndex: 100,
    backgroundColor: '#132018',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: C.green,
    elevation: 8,
  },
  toastError: { backgroundColor: '#2a1a1a', borderColor: C.danger },
  toastInfo: { backgroundColor: '#0f2e18', borderColor: C.accentLt },
  toastText: { color: C.text, fontSize: 13, fontWeight: '600', textAlign: 'center' },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 2,
  },
  logoWrap: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: '#0d2618',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.22)',
  },
  logo: { width: 32, height: 32 },
  brand: { color: C.text, fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  tagline: { color: C.muted, fontSize: 12, marginTop: 1 },

  /* Update badge in header */
  updateBadge: {
    backgroundColor: C.accent,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minWidth: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  updateBadgeDl: { opacity: 0.7 },
  updateBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  /* Settings entry point */
  gear: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.edgeBright,
  },
  gearText: { color: C.muted, fontSize: 15, lineHeight: 18 },

  /* Hero status card */
  heroCard: {
    backgroundColor: C.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.edge,
    padding: 20,
    gap: 12,
  },
  heroCardConnected: {
    borderColor: 'rgba(74,222,128,0.28)',
    backgroundColor: '#132018',
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  heroDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  heroStatus: {
    color: C.text,
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
    letterSpacing: -0.2,
  },
  heroSub: {
    color: C.muted,
    fontSize: 13,
    lineHeight: 20,
  },

  /* Primary button (pairing / send) */
  primary: {
    backgroundColor: C.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 2,
  },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  primaryDone: {
    backgroundColor: '#153824',
    borderWidth: 1,
    borderColor: C.green,
  },

  /* Paired-device card — rename/disconnect live here, not in a menu */
  devCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.edge,
    padding: 16,
    gap: 14,
  },
  devHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  devDot: { width: 8, height: 8, borderRadius: 4 },
  devName: { color: C.text, fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  devRole: { color: C.faint, fontSize: 11.5, marginTop: 1 },
  devPill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: C.cardAlt,
    borderWidth: 1,
    borderColor: C.edge,
  },
  devPillOn: { backgroundColor: C.greenBg, borderColor: 'rgba(74,222,128,0.3)' },
  devPillText: { color: C.muted, fontSize: 11, fontWeight: '700' },
  devPillTextOn: { color: C.green },

  devRows: {
    backgroundColor: C.input,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.edge,
  },
  devRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.edge,
  },
  devRowLast: { borderBottomWidth: 0 },
  devKey: { color: C.muted, fontSize: 12.5 },
  devVal: { color: C.text, fontSize: 12.5, fontWeight: '600', flexShrink: 1 },

  devBtnRow: { flexDirection: 'row', gap: 8 },
  devBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.edgeBright,
    alignItems: 'center',
  },
  devBtnText: { color: C.text, fontSize: 13.5, fontWeight: '600' },
  devBtnDanger: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: 'rgba(255,107,107,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.35)',
    alignItems: 'center',
  },
  devBtnDangerText: { color: '#ff8f8f', fontSize: 13.5, fontWeight: '700' },
  devConfirm: { gap: 12 },
  devConfirmText: { color: C.muted, fontSize: 12.5, lineHeight: 18 },

  /* Ghost button */
  ghost: {
    borderColor: C.edgeBright,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  ghostText: { color: C.muted, fontWeight: '600', fontSize: 14 },

  /* Hint / error */
  hintBox: {
    backgroundColor: 'rgba(255,107,107,0.07)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.18)',
    padding: 10,
  },
  hintText: { color: '#ffb3a0', fontSize: 12, lineHeight: 18 },
  errorText: { color: C.danger, fontSize: 13 },

  /* Received clips section */
  section: { gap: 8 },
  sectionLabel: {
    color: C.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  clipRow: {
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.edge,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  clipText: {
    flex: 1,
    color: C.text,
    fontSize: 13,
    lineHeight: 19,
  },
  clipImage: {
    flex: 1,
    height: 120,
    borderRadius: 6,
    backgroundColor: '#0d1f16',
  },
  fileRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  fileIcon: {
    fontSize: 28,
  },
  fileSub: {
    color: C.muted,
    fontSize: 11,
    marginTop: 2,
  },
  copyTag: {
    backgroundColor: 'rgba(34,197,94,0.15)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.28)',
  },
  copyTagText: { color: C.accentLt, fontSize: 12, fontWeight: '600' },

  /* Accessibility service nudge banner */
  accessBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#0f2535',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.25)',
    padding: 14,
  },
  accessTitle: {
    color: C.text,
    fontSize: 13.5,
    fontWeight: '700',
  },
  accessSub: {
    color: C.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  accessBtn: {
    backgroundColor: 'rgba(56,189,248,0.15)',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.35)',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  accessBtnText: {
    color: '#7dd3fc',
    fontSize: 13,
    fontWeight: '700',
  },
  notifBanner: {
    backgroundColor: '#1a1030',
    borderColor: 'rgba(167,139,250,0.25)',
  },
  notifBtn: {
    backgroundColor: 'rgba(167,139,250,0.15)',
    borderColor: 'rgba(167,139,250,0.35)',
  },

  /* Scanner */
  scanRoot: { flex: 1, backgroundColor: '#000' },
  scanDim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' },
  reticle: {
    position: 'absolute',
    top: '26%', left: '12%', width: '76%', aspectRatio: 1,
    borderRadius: 24, borderWidth: 2.5, borderColor: C.accentLt,
    shadowColor: C.accentLt, shadowOpacity: 0.5, shadowRadius: 12,
  },
  scanOverlay: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: 28, gap: 12,
  },
  scanHint: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },
});
