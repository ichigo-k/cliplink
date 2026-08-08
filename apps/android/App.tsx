// Must be first: noble's randomBytes needs crypto.getRandomValues, which React
// Native does not provide on its own.
import 'react-native-get-random-values';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
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

export default function App() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [offer, setOffer] = useState<PairingOffer | null>(null);
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const [scanning, setScanning] = useState(false);
  const [lastReceived, setLastReceived] = useState('');
  const [notice, setNotice] = useState('');
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

    return () => { sync.close(); client.current = null; };
  }, [offer, identity]);

  const onScan = useCallback(async ({ data }: { data: string }) => {
    if (handledScan.current) return;
    handledScan.current = true;

    const result = parsePairingOffer(data);
    if (!result.ok) {
      setNotice(result.reason);
      // Let the user try again with a different code after a beat.
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
   * Android only lets an app read the clipboard while it has focus, so this is a
   * button rather than a background watcher. See docs/architecture.md.
   */
  const sendClipboard = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    if (!text) return setNotice('Your clipboard is empty.');

    setNotice(client.current?.send(text) ? 'Sent to your PC.' : 'Not connected yet.');
  }, []);

  const unpair = useCallback(async () => {
    await SecureStore.deleteItemAsync(OFFER_KEY);
    setOffer(null);
    setStatus({ state: 'idle' });
    setLastReceived('');
  }, []);

  if (scanning) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan} />
        <View style={styles.scanOverlay}>
          <Text style={styles.scanHint}>Point at the QR code on your PC</Text>
          {!!notice && <Text style={styles.error}>{notice}</Text>}
          <Pressable style={styles.secondary} onPress={() => setScanning(false)}>
            <Text style={styles.secondaryText}>Cancel</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.logo}>ClipLink</Text>
        <Text style={styles.tagline}>Your clipboard. Your devices. One private bridge.</Text>

        <View style={styles.card}>
          <Text style={styles.heading}>{offer ? statusTitle(status) : 'Pair your PC'}</Text>
          <Text style={styles.message}>{offer ? statusDetail(status, offer) : 'Open ClipLink on your Windows PC and scan the QR code it shows.'}</Text>

          {status.state === 'connecting' && <ActivityIndicator color="#7dd3fc" />}
          {!!notice && <Text style={styles.error}>{notice}</Text>}

          {!offer && (
            <Pressable style={styles.primary} onPress={startScanning}>
              <Text style={styles.primaryText}>Scan QR code</Text>
            </Pressable>
          )}

          {offer && (
            <>
              <Pressable style={styles.primary} onPress={sendClipboard}>
                <Text style={styles.primaryText}>Send my clipboard to PC</Text>
              </Pressable>
              <Pressable style={styles.secondary} onPress={unpair}>
                <Text style={styles.secondaryText}>Unpair</Text>
              </Pressable>
            </>
          )}
        </View>

        {!!lastReceived && (
          <View style={styles.card}>
            <Text style={styles.heading}>From your PC</Text>
            <Text style={styles.message} numberOfLines={6}>{lastReceived}</Text>
            <Text style={styles.hint}>Already copied to your clipboard.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function statusTitle(status: Status): string {
  switch (status.state) {
    case 'connected': return 'Connected';
    case 'connecting': return 'Connecting…';
    case 'error': return 'Disconnected';
    default: return 'Paired';
  }
}

function statusDetail(status: Status, offer: PairingOffer): string {
  switch (status.state) {
    case 'connected': return `Linked to ${status.deviceName}. Anything you copy on the PC lands here automatically.`;
    case 'connecting': return `Reaching ${offer.host}…`;
    case 'error': return status.message;
    default: return `Paired with ${offer.deviceName}.`;
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#101827' },
  container: { padding: 24, paddingTop: 60, gap: 16 },
  logo: { color: '#7dd3fc', fontSize: 38, fontWeight: '800' },
  tagline: { color: '#cbd5e1', marginTop: 8, marginBottom: 12, fontSize: 15 },
  card: { backgroundColor: '#1e293b', borderRadius: 18, padding: 22, gap: 14 },
  heading: { color: '#f8fafc', fontSize: 24, fontWeight: '700' },
  message: { color: '#cbd5e1', lineHeight: 21 },
  hint: { color: '#64748b', fontSize: 12 },
  error: { color: '#fca5a5', lineHeight: 20 },
  primary: { backgroundColor: '#0284c7', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  primaryText: { color: '#f8fafc', fontWeight: '700', fontSize: 15 },
  secondary: { borderColor: '#475569', borderWidth: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  secondaryText: { color: '#cbd5e1', fontWeight: '600' },
  scanOverlay: { position: 'absolute', left: 0, right: 0, bottom: 48, padding: 24, gap: 14 },
  scanHint: { color: '#f8fafc', fontSize: 17, fontWeight: '700', textAlign: 'center' },
});
