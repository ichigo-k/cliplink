// Must be first: noble's randomBytes needs crypto.getRandomValues
import 'react-native-get-random-values';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  type AppStateStatus,
  Image,
  NativeEventEmitter,
  NativeModules,
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
  checkForUpdate,
  currentVersion,
  downloadAndInstall,
  notifyUpdateAvailable,
  type AvailableUpdate,
} from './src/updater';

const IDENTITY_KEY = 'cliplink.identity';
const OFFER_KEY = 'cliplink.offer';
const LAST_HOST_KEY = 'cliplink.lastHost';

const C = {
  void: '#111111',
  layer: '#1a1a1a',
  card: '#1e1e1e',
  cardAlt: '#242424',
  input: '#161616',
  edge: 'rgba(255,255,255,0.06)',
  edgeBright: 'rgba(255,255,255,0.11)',
  text: '#f2f2f2',
  muted: '#888888',
  faint: '#444444',
  accent: '#22C55E',
  accentLt: '#4ADE80',
  green: '#4ADE80',
  greenBg: 'rgba(74,222,128,0.10)',
  danger: '#FF6B6B',
};

type Toast = { message: string; type: 'success' | 'error' | 'info' };

type ReceivedClip = { text: string; at: number };

export default function App({ sharedText }: { sharedText?: string }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [offer, setOffer] = useState<PairingOffer | null>(null);
  const [lastHost, setLastHost] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const [scanning, setScanning] = useState(false);
  const [received, setReceived] = useState<ReceivedClip[]>([]);
  const [notice, setNotice] = useState('');
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [updateDl, setUpdateDl] = useState(false); // downloading silently
  const [updateReady, setUpdateReady] = useState(false); // ready to install
  const [permission, requestPermission] = useCameraPermissions();
  const [toast, setToast] = useState<Toast | null>(null);
  const [manualSent, setManualSent] = useState(false);

  const client = useRef<SyncClient | null>(null);
  const handledScan = useRef(false);
  const lastSentRef = useRef('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateRef = useRef<AvailableUpdate | null>(null);

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

  /* ── Update: check then auto-download silently in background ── */
  useEffect(() => {
    if (__DEV__) return;
    checkForUpdate().then(async (u) => {
      if (!u) return;
      updateRef.current = u;
      setUpdate(u);
      // Notify first: this is the only part guaranteed to survive the app
      // being swiped away before the silent download below finishes.
      notifyUpdateAvailable(u);
      // Start downloading silently right away
      setUpdateDl(true);
      try {
        await downloadAndInstall(u, () => { });
        // downloadAndInstall launches the system installer prompt, so if we
        // get here the user dismissed it. Mark ready so they can retry.
        setUpdateReady(true);
      } catch {
        // Download failed silently — user can retry via the badge
      } finally {
        setUpdateDl(false);
      }
    });
  }, []);

  /* ── Socket lifecycle ── */
  useEffect(() => {
    if (!offer || !identity) return;
    const sync = new SyncClient(offer, identity, 'Android phone', {
      onStatus: (s) => {
        setStatus(s);
        if (s.state === 'connected') {
          const h = (sync as any).host as string | undefined;
          if (h) {
            setLastHost(h);
            SecureStore.setItemAsync(LAST_HOST_KEY, h).catch(() => { });
          }
          // Keep the JS runtime alive while the socket is up so PC → phone
          // clips still land when the app is backgrounded.
          startBackgroundSync().then(() => updateBackgroundStatus(s.deviceName));
        } else if (s.state === 'idle' || s.state === 'error') {
          stopBackgroundSync();
        }
      },
      onClip: async (text) => {
        // Write directly to Android clipboard — this works from background
        // because setStringAsync (write) is not restricted, only read is.
        try { await Clipboard.setStringAsync(text); } catch { /* best effort */ }
        // Also keep a visible history so user can see what arrived
        setReceived(prev => [{ text, at: Date.now() }, ...prev].slice(0, 20));
        showToast('Clipboard synced from PC ✓', 'info');
      },
    }, lastHost);
    client.current = sync;
    sync.connect();
    return () => {
      sync.close();
      client.current = null;
      stopBackgroundSync();
    };
  }, [offer, identity, showToast]);

  /* ── Auto-send on foreground ── */
  const tryAutoSend = useCallback(async () => {
    const c = client.current;
    if (!c || status.state !== 'connected') return;
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

  /* ── Share sheet intent (fresh launch) ── */
  useEffect(() => {
    if (!sharedText) return;
    const waitAndSend = () => {
      if (client.current?.send(sharedText)) {
        lastSentRef.current = sharedText;
        showToast('Shared text sent to your PC ✓');
      } else {
        setTimeout(waitAndSend, 600);
      }
    };
    const t = setTimeout(waitAndSend, 800);
    return () => clearTimeout(t);
  }, [sharedText, showToast]);

  /* ── Share sheet intent (app already open) ── */
  useEffect(() => {
    const emitter = new NativeEventEmitter(
      NativeModules.RCTDeviceEventEmitter ?? NativeModules.DeviceEventEmitter,
    );
    const sub = emitter.addListener('onSharedText', (text: string) => {
      if (!text) return;
      const trySend = () => {
        if (client.current?.send(text)) {
          lastSentRef.current = text;
          showToast('Shared text sent to your PC ✓');
        } else {
          setTimeout(trySend, 600);
        }
      };
      trySend();
    });
    return () => sub.remove();
  }, [showToast]);

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

  const retryInstall = useCallback(async () => {
    const u = updateRef.current ?? update;
    if (!u) return;
    try {
      await downloadAndInstall(u, () => { });
    } catch (e) {
      Alert.alert('Install failed', String(e));
    }
  }, [update]);

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
          {/* Update badge — appears once update is available */}
          {!!update && (
            <Pressable
              style={[S.updateBadge, updateDl && S.updateBadgeDl]}
              onPress={retryInstall}
              disabled={updateDl}
            >
              {updateDl
                ? <ActivityIndicator size={12} color="#fff" />
                : <Text style={S.updateBadgeText}>
                  {updateReady ? 'Install' : `v${update.version}`}
                </Text>
              }
            </Pressable>
          )}
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
            <View style={S.heroActions}>
              {isConnected && (
                <Pressable
                  style={[S.actionBtn, manualSent && S.actionBtnDone]}
                  onPress={sendClipboard}
                >
                  <Text style={S.actionBtnText}>
                    {manualSent ? '✓ Sent' : 'Send clipboard'}
                  </Text>
                </Pressable>
              )}
              <Pressable style={S.actionBtnGhost} onPress={unpair}>
                <Text style={S.actionBtnGhostText}>Unpair</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* ── Received clips from PC ── */}
        {received.length > 0 && (
          <View style={S.section}>
            <Text style={S.sectionLabel}>From your PC</Text>
            {received.map((clip, i) => (
              <Pressable
                key={i}
                style={S.clipRow}
                onPress={() => copyReceived(clip.text)}
              >
                <Text style={S.clipText} numberOfLines={2}>{clip.text}</Text>
                <View style={S.copyTag}>
                  <Text style={S.copyTagText}>Re-copy</Text>
                </View>
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

  /* Hero action row */
  heroActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: C.accent,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  actionBtnDone: {
    backgroundColor: '#153824',
    borderWidth: 1,
    borderColor: C.green,
  },
  actionBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  actionBtnGhost: {
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.edgeBright,
    alignItems: 'center',
  },
  actionBtnGhostText: { color: C.muted, fontWeight: '600', fontSize: 14 },

  /* Primary button (pairing) */
  primary: {
    backgroundColor: C.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 2,
  },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },

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
  copyTag: {
    backgroundColor: 'rgba(34,197,94,0.15)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.28)',
  },
  copyTagText: { color: C.accentLt, fontSize: 12, fontWeight: '600' },

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
