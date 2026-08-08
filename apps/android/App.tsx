// Must be first: noble's randomBytes needs crypto.getRandomValues, which React
// Native does not provide on its own.
import 'react-native-get-random-values';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import * as Updates from 'expo-updates';
import { identityFromB64, secretToB64, type Identity } from '@cliplink/crypto';
import { parsePairingOffer, type PairingOffer } from '@cliplink/protocol';
import { newIdentity, SyncClient, type Status } from './src/client';

const IDENTITY_KEY = 'cliplink.identity';
const OFFER_KEY = 'cliplink.offer';

const C = {
  void: '#070a09',
  raise: '#101614',
  edge: '#1f2724',
  edgeBright: '#2c3733',
  text: '#e9efeb',
  muted: '#8b958f',
  faint: '#5d665f',
  mint: '#3ddc97',
  danger: '#ff9b85',
};

export default function App() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [offer, setOffer] = useState<PairingOffer | null>(null);
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const [scanning, setScanning] = useState(false);
  const [lastReceived, setLastReceived] = useState('');
  const [notice, setNotice] = useState('');
  const [sent, setSent] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const client = useRef<SyncClient | null>(null);
  // Guards against the camera firing the same QR code dozens of times a second.
  const handledScan = useRef(false);

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
        try {
          setOffer(JSON.parse(storedOffer));
        } catch {
          await SecureStore.deleteItemAsync(OFFER_KEY);
        }
      }
    })();
  }, []);

  useEffect(() => {
    if (__DEV__) return;
    Updates.checkForUpdateAsync()
      .then(async result => {
        if (!result.isAvailable) return;
        Alert.alert('ClipLink update available', 'A new version is ready. Download it now?', [
          { text: 'Later', style: 'cancel' },
          { text: 'Update', onPress: async () => { await Updates.fetchUpdateAsync(); await Updates.reloadAsync(); } },
        ]);
      })
      .catch(() => undefined);
  }, []);

  // Owns the socket's lifetime: one client per (offer, identity) pair.
  useEffect(() => {
    if (!offer || !identity) return;

    const sync = new SyncClient(offer, identity, 'Android phone', {
      onStatus: setStatus,
      onClip: async text => {
        await Clipboard.setStringAsync(text);
        setLastReceived(text);
      },
    });

    client.current = sync;
    sync.connect();

    return () => {
      sync.close();
      client.current = null;
    };
  }, [offer, identity]);

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

  /**
   * Android only lets an app read the clipboard while it has focus, so this is
   * a button rather than a background watcher. See docs/architecture.md.
   */
  const sendClipboard = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    if (!text) return setNotice('Your clipboard is empty.');

    if (client.current?.send(text)) {
      setSent(true);
      setNotice('');
      setTimeout(() => setSent(false), 1600);
    } else {
      setNotice('Not connected to your PC yet.');
    }
  }, []);

  const unpair = useCallback(async () => {
    await SecureStore.deleteItemAsync(OFFER_KEY);
    setOffer(null);
    setStatus({ state: 'idle' });
    setLastReceived('');
  }, []);

  if (scanning) {
    return (
      <View style={styles.scanRoot}>
        <StatusBar style="light" />
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onScan}
        />
        <View style={styles.reticle} pointerEvents="none" />
        <SafeAreaView style={styles.scanOverlay}>
          <Text style={styles.scanHint}>Point at the code on your PC</Text>
          {!!notice && <Text style={styles.error}>{notice}</Text>}
          <Pressable style={styles.ghost} onPress={() => setScanning(false)}>
            <Text style={styles.ghostText}>Cancel</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    );
  }

  const dotColor =
    status.state === 'connected' ? C.mint : status.state === 'error' ? C.danger : C.faint;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.brandRow}>
          <View style={styles.mark} />
          <Text style={styles.brand}>ClipLink</Text>
        </View>
        <Text style={styles.tagline}>Your clipboard, on both devices.</Text>

        <View style={styles.card}>
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: dotColor }]} />
            <Text style={styles.statusText}>{offer ? statusTitle(status) : 'Not paired'}</Text>
            {status.state === 'connecting' && <ActivityIndicator size="small" color={C.mint} />}
          </View>

          <Text style={styles.body}>
            {offer
              ? statusDetail(status, offer)
              : 'Open ClipLink on your Windows PC, go to Devices, and scan the code it shows.'}
          </Text>

          {status.state === 'error' && !!status.detail && (
            <View style={styles.hintBox}>
              <Text style={styles.hintText}>{status.detail}</Text>
            </View>
          )}

          {!!notice && <Text style={styles.error}>{notice}</Text>}

          {!offer ? (
            <Pressable style={styles.primary} onPress={startScanning}>
              <Text style={styles.primaryText}>Scan pairing code</Text>
            </Pressable>
          ) : (
            <>
              <Pressable
                style={[styles.primary, sent && styles.primaryDone]}
                onPress={sendClipboard}
              >
                <Text style={styles.primaryText}>{sent ? 'Sent to your PC' : 'Send my clipboard'}</Text>
              </Pressable>
              <Pressable style={styles.ghost} onPress={unpair}>
                <Text style={styles.ghostText}>Unpair</Text>
              </Pressable>
            </>
          )}
        </View>

        {!!lastReceived && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Latest from your PC</Text>
            <Text style={styles.mono} numberOfLines={8}>
              {lastReceived}
            </Text>
            <Text style={styles.footnote}>Already on your clipboard — just paste.</Text>
          </View>
        )}

        {!!offer && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Why the button?</Text>
            <Text style={styles.body}>
              Android blocks apps from reading the clipboard in the background, so copies made here need one
              tap to send. Anything copied on your PC arrives automatically.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function statusTitle(status: Status): string {
  switch (status.state) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting';
    case 'error':
      return 'Cannot reach your PC';
    default:
      return 'Paired';
  }
}

function statusDetail(status: Status, offer: PairingOffer): string {
  switch (status.state) {
    case 'connected':
      return `Linked to ${status.deviceName}. Anything copied there lands here automatically.`;
    case 'connecting':
      return `Trying ${status.host}:${offer.port}…`;
    case 'error':
      return status.message;
    default:
      return `Paired with ${offer.deviceName}.`;
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.void, paddingTop: RNStatusBar.currentHeight ?? 0 },
  scroll: { padding: 20, paddingTop: 36, gap: 14 },

  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { width: 26, height: 26, borderRadius: 8, backgroundColor: C.mint },
  brand: { color: C.text, fontSize: 26, fontWeight: '700', letterSpacing: -0.5 },
  tagline: { color: C.muted, fontSize: 14, marginBottom: 8 },

  card: {
    backgroundColor: C.raise,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.edge,
    padding: 18,
    gap: 12,
  },
  cardTitle: { color: C.text, fontSize: 15, fontWeight: '700' },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: C.text, fontSize: 17, fontWeight: '700', flex: 1 },

  body: { color: C.muted, fontSize: 14, lineHeight: 21 },
  footnote: { color: C.faint, fontSize: 12 },
  mono: { color: C.text, fontSize: 13, fontFamily: 'monospace', lineHeight: 19 },

  hintBox: {
    backgroundColor: '#1a1410',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3a2a20',
    padding: 12,
  },
  hintText: { color: '#e8b79a', fontSize: 13, lineHeight: 19 },
  error: { color: C.danger, fontSize: 13, lineHeight: 19 },

  primary: {
    backgroundColor: C.mint,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  primaryDone: { backgroundColor: C.edgeBright },
  primaryText: { color: C.void, fontWeight: '700', fontSize: 15 },

  ghost: {
    borderColor: C.edgeBright,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  ghostText: { color: C.muted, fontWeight: '600', fontSize: 14 },

  scanRoot: { flex: 1, backgroundColor: '#000' },
  reticle: {
    position: 'absolute',
    top: '26%',
    left: '12%',
    width: '76%',
    aspectRatio: 1,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: C.mint,
  },
  scanOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 22, gap: 12 },
  scanHint: { color: '#fff', fontSize: 17, fontWeight: '700', textAlign: 'center' },
});
