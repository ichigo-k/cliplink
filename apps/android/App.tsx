import React, { useEffect, useState } from 'react';
import { Alert, Button, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Clipboard from '@react-native-clipboard/clipboard';
import * as Updates from 'expo-updates';

type PairingPayload = { app: string; version: number; deviceId: string; host: string; port: number; nonce: string };

export default function App() {
  const [paired, setPaired] = useState(false);
  const [payload, setPayload] = useState('');
  const [message, setMessage] = useState('Scan the QR code shown by ClipLink on your Windows PC.');

  useEffect(() => {
    if (__DEV__) return;
    Updates.checkForUpdateAsync().then(async result => {
      if (!result.isAvailable) return;
      Alert.alert('ClipLink update available', 'A new version is ready. Download it now?', [
        { text: 'Later', style: 'cancel' },
        { text: 'Update', onPress: async () => { await Updates.fetchUpdateAsync(); await Updates.reloadAsync(); } }
      ]);
    }).catch(() => undefined);
  }, []);

  const pair = () => {
    try {
      const data = JSON.parse(payload) as PairingPayload;
      if (data.app !== 'ClipLink' || !data.host || !data.port) throw new Error('Invalid pairing data');
      setPaired(true);
      setMessage(`Paired with ${data.deviceId} at ${data.host}:${data.port}`);
    } catch {
      setMessage('Paste a valid ClipLink pairing payload to continue. QR scanning will be connected next.');
    }
  };

  const copyDemo = async () => {
    await Clipboard.setString('ClipLink is connected');
    setMessage('Text copied to the Android clipboard.');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.container}>
        <Text style={styles.logo}>ClipLink</Text>
        <Text style={styles.tagline}>Your clipboard. Your devices. One private bridge.</Text>
        <View style={styles.card}>
          <Text style={styles.heading}>{paired ? 'Connected' : 'Pair your PC'}</Text>
          <Text style={styles.message}>{message}</Text>
          {!paired && <>
            <TextInput value={payload} onChangeText={setPayload} multiline placeholder="Pairing payload" placeholderTextColor="#718096" style={styles.input} />
            <Button title="Pair with PC" onPress={pair} />
          </>}
          {paired && <Button title="Copy test text" onPress={copyDemo} />}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#101827' },
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  logo: { color: '#7dd3fc', fontSize: 38, fontWeight: '800' },
  tagline: { color: '#cbd5e1', marginTop: 8, marginBottom: 28, fontSize: 15 },
  card: { backgroundColor: '#1e293b', borderRadius: 18, padding: 22, gap: 16 },
  heading: { color: '#f8fafc', fontSize: 24, fontWeight: '700' },
  message: { color: '#cbd5e1', lineHeight: 21 },
  input: { minHeight: 100, borderColor: '#475569', borderWidth: 1, borderRadius: 10, padding: 12, color: '#f8fafc', textAlignVertical: 'top' }
});
