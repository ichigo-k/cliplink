// Must be first: noble's randomBytes needs crypto.getRandomValues, which React
// Native does not provide on its own.
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
  checkForUpdate,
  currentVersion,
  downloadAndInstall,
  type AvailableUpdate,
} from './src/updater';

const IDENTITY_KEY = 'cliplink.identity';
const OFFER_KEY = 'cliplink.offer';

/* ── Colour tokens ── */
const C = {
  void: '#141414',
  layer: '#1c1c1c',
  card: '#222222',
  input: '#1a1a1a',
  edge: 'rgba(255,255,255,0.07)',
  edgeBright: 'rgba(255,255,255,0.12)',
  text: '#f3f3f3',
  muted: '#9d9d9d',
  faint: '#5a5a5a',
  accent: '#0078D4',
  accentLt: '#60CDFF',
  green: '#6CCB5F',
  greenSoft: 'rgba(108,203,95,0.12)',
  danger: '#FF6B6B',
};

/* ── Toast state ── */
type Toast = { message: string; type: 'success' | 'error' | 'info' };

export default function App({ sharedText }: { sharedText?: string }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [offer, setOffer] = useState<PairingOffer | null>(null);
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const [scanning, setScanning] = useState(false);
  const [lastReceived, setLastReceived] = useState('');
  const [notice, setNotice] = useState('');
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [toast, setToast] = useState<Toast | null>(null);

  const client = useRef<SyncClient | null>(null);
  const handledScan = useRef(false);
  // Tracks the last text we auto-sent so we don't double-send on repeated focus
  const lastSentRef = useRef('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Toast helper ── */
  const showToast = useCallback((message: string, type: Toast['type'] = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  /* ── Identity / offer bootstrap ── */
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
    })();
  }, []);

  /* ── Update check ── */
  useEffect(() => {
    if (__DEV__) return;
    checkForUpdate().then(setUpdate);
  }, []);

  const installUpdate = useCallback(async () => {
    if (!update) return;
    setProgress(0);
    try {
      await downloadAndInstall(update, setProgress);
    } catch (e) {
      Alert.alert('Update failed', String(e));
    } finally {
      setProgress(null);
    }
  }, [update]);

  /* ── Socket lifecycle ── */
  useEffect(() => {
    if (!offer || !identity) return;

    const sync = new SyncClient(offer, identity, 'Android phone', {
      onStatus: setStatus,
      onClip: async text => {
        await Clipboard.setStringAsync(text);
        setLastReceived(text);
        lastSentRef.current = text; // don't echo it back on next focus
        showToast('Clipboard updated from your PC', 'info');
      },
    });

    client.current = sync;
    sync.connect();

    return () => {
      sync.close();
      client.current = null;
    };
  }, [offer, identity, showToast]);

  /* ── Auto-send on app focus (the seamless replacement for the button) ──
   *
   * Android only grants clipboard access while the app is foregrounded.
   * We listen for the foreground transition and immediately read + send.
   * This means: user copies something anywhere, switches to ClipLink, done.
   * No extra tap needed.
   */
  const tryAutoSend = useCallback(async () => {
    const c = client.current;
    if (!c) return;
    if (status.state !== 'connected') return;

    const text = await Clipboard.getStringAsync();
    if (!text) return;
    if (text === lastSentRef.current) return; // same content, skip

    if (c.send(text)) {
      lastSentRef.current = text;
      showToast('Clipboard sent to your PC ✓', 'success');
    }
  }, [status, showToast]);

  useEffect(() => {
    // Also try on mount in case the app was already open
    tryAutoSend();

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') tryAutoSend();
    });
    return () => sub.remove();
  }, [tryAutoSend]);

  /* ── Handle incoming Share intent (text shared FROM another app) ── */
  useEffect(() => {
    if (!sharedText) return;
    // App was launched via Share Sheet — send as soon as socket is connected
    const waitAndSend = () => {
      if (client.current?.send(sharedText)) {
        lastSentRef.current = sharedText;
        showToast('Shared text sent to your PC ✓', 'success');
      } else {
        // Not connected yet, retry after a short delay
        setTimeout(waitAndSend, 600);
      }
    };
    // Small delay to let the socket handshake complete
    const t = setTimeout(waitAndSend, 800);
    return () => clearTimeout(t);
  }, [sharedText, showToast]);

  /* ── Handle share intent when app is already open (onNewIntent) ── */
  useEffect(() => {
    const emitter = new NativeEventEmitter(NativeModules.RCTDeviceEventEmitter ?? NativeModules.DeviceEventEmitter);
    const sub = emitter.addListener('onSharedText', (text: string) => {
      if (!text) return;
      const trySend = () => {
        if (client.current?.send(text)) {
          lastSentRef.current = text;
          showToast('Shared text sent to your PC ✓', 'success');
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

  /* ── Manual send (kept as a fallback, de-emphasised) ── */
  const [manualSent, setManualSent] = useState(false);
  const sendClipboard = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    if (!text) return showToast('Your clipboard is empty.', 'error');

    if (client.current?.send(text)) {
      lastSentRef.current = text;
      setManualSent(true);
      showToast('Sent to your PC ✓', 'success');
      setTimeout(() => setManualSent(false), 1600);
    } else {
      showToast('Not connected to your PC yet.', 'error');
    }
  }, [showToast]);

  const unpair = useCallback(async () => {
    await SecureStore.deleteItemAsync(OFFER_KEY);
    setOffer(null);
    setStatus({ state: 'idle' });
    setLastReceived('');
    lastSentRef.current = '';
  }, []);

  /* ── Camera screen ── */
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
          {!!notice && <Text style={S.error}>{notice}</Text>}
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
        <View style={[S.toast, toast.type === 'error' && S.toastError, toast.type === 'info' && S.toastInfo]}>
          <Text style={S.toastText}>{toast.message}</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={S.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Brand header ── */}
        <View style={S.header}>
          <View style={S.logoWrap}>
            <Image source={require('./assets/adaptive-icon.png')} style={S.logo} />
          </View>
          <View>
            <Text style={S.brand}>ClipLink</Text>
            <Text style={S.tagline}>Clipboard, everywhere.</Text>
          </View>
        </View>

        {/* ── Update banner ── */}
        {!!update && (
          <View style={[S.card, S.updateCard]}>
            <View style={S.updateBadge}>
              <Text style={S.updateBadgeText}>NEW</Text>
            </View>
            <Text style={S.cardTitle}>Version {update.version} available</Text>
            <Text style={S.body}>
              You have {currentVersion()}. Android will ask you to confirm the install.
            </Text>
            <Pressable
              style={[S.primary, progress !== null && S.primaryBusy]}
              disabled={progress !== null}
              onPress={installUpdate}
            >
              <Text style={S.primaryText}>
                {progress === null
                  ? 'Download & install'
                  : `Downloading  ${Math.round(progress * 100)}%`}
              </Text>
            </Pressable>
          </View>
        )}

        {/* ── Connection status card ── */}
        <View style={S.card}>
          <View style={S.statusRow}>
            <View style={[S.dot, { backgroundColor: dotColor }]} />
            <Text style={S.statusTitle}>{offer ? statusTitle(status) : 'Not paired'}</Text>
            {status.state === 'connecting' && (
              <ActivityIndicator size="small" color={C.accentLt} />
            )}
          </View>

          <Text style={S.body}>
            {offer
              ? statusDetail(status, offer)
              : 'Open ClipLink on your Windows PC, go to Devices, and scan the QR code it shows.'}
          </Text>

          {status.state === 'error' && !!status.detail && (
            <View style={S.hintBox}>
              <Text style={S.hintText}>{status.detail}</Text>
            </View>
          )}

          {!!notice && <Text style={S.error}>{notice}</Text>}

          {!offer ? (
            <Pressable style={S.primary} onPress={startScanning}>
              <Text style={S.primaryText}>Scan pairing code</Text>
            </Pressable>
          ) : (
            <Pressable style={S.ghost} onPress={unpair}>
              <Text style={S.ghostText}>Unpair device</Text>
            </Pressable>
          )}
        </View>

        {/* ── Auto-send explanation (only shown when paired) ── */}
        {!!offer && isConnected && (
          <View style={S.infoCard}>
            <View style={S.infoIconRow}>
              <View style={S.infoIcon}>
                <Text style={S.infoIconText}>⚡</Text>
              </View>
              <Text style={S.infoTitle}>Seamless sync active</Text>
            </View>
            <Text style={S.body}>
              Every time you come back to this app, your clipboard is sent to your PC automatically.
              No button needed — just copy, switch here, done.
            </Text>
            {/* Manual send kept as a subtle fallback */}
            <Pressable
              style={[S.manualBtn, manualSent && S.manualBtnDone]}
              onPress={sendClipboard}
            >
              <Text style={S.manualBtnText}>
                {manualSent ? '✓ Sent' : 'Send now manually'}
              </Text>
            </Pressable>
          </View>
        )}

        {/* ── Waiting to connect ── */}
        {!!offer && !isConnected && (
          <View style={S.infoCard}>
            <Text style={S.infoTitle}>Tip</Text>
            <Text style={S.body}>
              Once connected, just copy something and switch back here — it sends automatically.
              You can also share text directly to ClipLink from any app's share menu.
            </Text>
          </View>
        )}

        {/* ── Last received from PC ── */}
        {!!lastReceived && (
          <View style={S.card}>
            <View style={S.cardTitleRow}>
              <Text style={S.cardTitle}>From your PC</Text>
              <View style={[S.dot, { backgroundColor: C.green }]} />
            </View>
            <Text style={S.mono} numberOfLines={8}>{lastReceived}</Text>
            <Text style={S.footnote}>Already in your clipboard — just paste.</Text>
          </View>
        )}

        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/* ── Status helpers ── */

function statusTitle(status: Status): string {
  switch (status.state) {
    case 'connected': return 'Connected';
    case 'connecting': return 'Connecting…';
    case 'error': return 'Cannot reach your PC';
    default: return 'Paired';
  }
}

function statusDetail(status: Status, offer: PairingOffer): string {
  switch (status.state) {
    case 'connected':
      return `Linked to ${status.deviceName}.`;
    case 'connecting':
      return `Trying ${status.host}:${offer.port}…`;
    case 'error':
      return status.message;
    default:
      return `Paired with ${offer.deviceName}.`;
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
    padding: 20,
    paddingTop: 28,
    gap: 12,
  },

  /* Toast */
  toast: {
    position: 'absolute',
    top: (RNStatusBar.currentHeight ?? 0) + 12,
    left: 20,
    right: 20,
    zIndex: 100,
    backgroundColor: '#1a2e1a',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: C.green,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  toastError: {
    backgroundColor: '#2e1a1a',
    borderColor: C.danger,
  },
  toastInfo: {
    backgroundColor: '#0c1f3a',
    borderColor: C.accentLt,
  },
  toastText: {
    color: C.text,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 6,
  },
  logoWrap: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#0c1f3a',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,120,212,0.25)',
  },
  logo: { width: 36, height: 36 },
  brand: {
    color: C.text,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  tagline: {
    color: C.muted,
    fontSize: 13,
    marginTop: 1,
  },

  /* Card */
  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.edge,
    padding: 18,
    gap: 12,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    color: C.text,
    fontSize: 15,
    fontWeight: '700',
  },

  /* Info card (de-emphasised) */
  infoCard: {
    backgroundColor: C.layer,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    padding: 16,
    gap: 10,
  },
  infoIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(0,120,212,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoIconText: { fontSize: 14 },
  infoTitle: {
    color: C.text,
    fontSize: 14,
    fontWeight: '600',
  },

  /* Status */
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusTitle: {
    color: C.text,
    fontSize: 17,
    fontWeight: '700',
    flex: 1,
  },

  /* Typography */
  body: {
    color: C.muted,
    fontSize: 14,
    lineHeight: 22,
  },
  mono: {
    color: C.text,
    fontSize: 13,
    fontFamily: 'monospace',
    lineHeight: 20,
    backgroundColor: C.input,
    borderRadius: 10,
    padding: 12,
    overflow: 'hidden',
  },
  footnote: {
    color: C.faint,
    fontSize: 12,
  },

  /* Hint / error */
  hintBox: {
    backgroundColor: 'rgba(255,107,107,0.08)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.20)',
    padding: 12,
  },
  hintText: {
    color: '#ffb3a0',
    fontSize: 13,
    lineHeight: 19,
  },
  error: {
    color: C.danger,
    fontSize: 13,
    lineHeight: 19,
  },

  /* Primary CTA */
  primary: {
    backgroundColor: C.accent,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  primaryBusy: { opacity: 0.55 },
  primaryText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },

  /* Ghost (secondary) */
  ghost: {
    borderColor: C.edgeBright,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  ghostText: {
    color: C.muted,
    fontWeight: '600',
    fontSize: 14,
  },

  /* Manual send — small, de-emphasised */
  manualBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.edgeBright,
  },
  manualBtnDone: {
    borderColor: C.green,
    backgroundColor: C.greenSoft,
  },
  manualBtnText: {
    color: C.muted,
    fontSize: 13,
    fontWeight: '500',
  },

  /* Update card */
  updateCard: {
    borderColor: 'rgba(0,120,212,0.35)',
    backgroundColor: 'rgba(0,120,212,0.06)',
  },
  updateBadge: {
    alignSelf: 'flex-start',
    backgroundColor: C.accent,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  updateBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },

  /* Scanner */
  scanRoot: { flex: 1, backgroundColor: '#000' },
  scanDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  reticle: {
    position: 'absolute',
    top: '26%',
    left: '12%',
    width: '76%',
    aspectRatio: 1,
    borderRadius: 24,
    borderWidth: 2.5,
    borderColor: C.accentLt,
    shadowColor: C.accentLt,
    shadowOpacity: 0.5,
    shadowRadius: 12,
  },
  scanOverlay: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    padding: 28,
    gap: 12,
  },
  scanHint: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
});
