/**
 * Settings — version, update controls, and what the app is doing on your behalf.
 *
 * Updates used to be reachable only through a badge that appeared in the header
 * when a check happened to find something. That left no way to ask "am I on the
 * latest?", and no way to retry when the silent download had failed. Everything
 * about updating is visible and manually driveable from here.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { C } from './theme';
import { notificationsAllowed, requestNotificationPermission } from './updater';
import type { Updater } from './useUpdater';

const REPO_URL = 'https://github.com/ichigo-k/cliplink';

export function SettingsScreen({
  updater,
  onClose,
}: {
  updater: Updater;
  onClose: () => void;
}) {
  const { phase, installed, checkedAt, check, download, install } = updater;
  const [notifyOk, setNotifyOk] = useState<boolean | null>(null);

  useEffect(() => {
    notificationsAllowed().then(setNotifyOk);
  }, []);

  const askNotifications = useCallback(async () => {
    const granted = await requestNotificationPermission();
    setNotifyOk(granted);
    // Denied twice and Android stops showing the dialog at all; the only route
    // left is the OS settings page for the app.
    if (!granted) Linking.openSettings().catch(() => { });
  }, []);

  const busy = phase.kind === 'checking' || phase.kind === 'downloading';
  const latest =
    phase.kind === 'available' || phase.kind === 'downloading' || phase.kind === 'ready'
      ? phase.update.version
      : phase.kind === 'upToDate'
        ? installed
        : null;

  return (
    <SafeAreaView style={S.safe}>
      <StatusBar style="light" />

      <View style={S.topBar}>
        <Pressable style={S.backBtn} onPress={onClose} hitSlop={10}>
          <Text style={S.backText}>‹</Text>
        </Pressable>
        <Text style={S.topTitle}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={S.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Updates ── */}
        <Text style={S.sectionLabel}>Updates</Text>
        <View style={S.card}>
          <View style={S.rows}>
            <View style={S.row}>
              <Text style={S.key}>Installed version</Text>
              <Text style={S.val}>v{installed}</Text>
            </View>
            <View style={S.row}>
              <Text style={S.key}>Latest version</Text>
              <Text style={S.val}>{latest ? `v${latest}` : '—'}</Text>
            </View>
            <View style={[S.row, S.rowLast]}>
              <Text style={S.key}>Last checked</Text>
              <Text style={S.val}>{checkedAt ? relativeTime(checkedAt) : 'Never'}</Text>
            </View>
          </View>

          <Text style={[S.status, phase.kind === 'failed' && S.statusBad]}>
            {statusLine(phase, installed)}
          </Text>

          {phase.kind === 'downloading' && (
            <View style={S.barTrack}>
              <View style={[S.barFill, { width: `${Math.round(phase.progress * 100)}%` }]} />
            </View>
          )}

          {/* The install path never re-downloads: the APK is already verified
              complete on disk, so this is just the system installer prompt. */}
          {phase.kind === 'ready' && (
            <Pressable style={S.primary} onPress={install}>
              <Text style={S.primaryText}>Install v{phase.update.version} now</Text>
            </Pressable>
          )}

          {(phase.kind === 'available' || phase.kind === 'failed') && !!phase.update && (
            <Pressable style={S.primary} onPress={download}>
              <Text style={S.primaryText}>
                {phase.kind === 'failed' ? 'Try again' : `Download v${phase.update.version}`}
              </Text>
            </Pressable>
          )}

          <Pressable
            style={[S.ghost, busy && S.ghostDisabled]}
            onPress={() => check({ manual: true })}
            disabled={busy}
          >
            {busy
              ? <ActivityIndicator size="small" color={C.muted} />
              : <Text style={S.ghostText}>Check for updates</Text>}
          </Pressable>
        </View>

        {/* ── Release notes ── */}
        {'update' in phase && !!phase.update?.notes && (
          <>
            <Text style={S.sectionLabel}>What&apos;s new in v{phase.update.version}</Text>
            <View style={S.card}>
              <Text style={S.notes}>{phase.update.notes.trim()}</Text>
            </View>
          </>
        )}

        {/* ── Notifications ── */}
        <Text style={S.sectionLabel}>Notifications</Text>
        <View style={S.card}>
          <Text style={S.body}>
            {notifyOk === false
              ? 'Notifications are turned off, so ClipLink cannot tell you when a new '
              + 'version is available. You can still check on this screen any time.'
              : 'ClipLink notifies you once per version when an update is available, '
              + 'and keeps a notification up while it is syncing in the background.'}
          </Text>
          {notifyOk === false && (
            <Pressable style={S.ghost} onPress={askNotifications}>
              <Text style={S.ghostText}>Turn on notifications</Text>
            </Pressable>
          )}
        </View>

        {/* ── About ── */}
        <Text style={S.sectionLabel}>About</Text>
        <View style={S.card}>
          <View style={S.rows}>
            <View style={S.row}>
              <Text style={S.key}>Encryption</Text>
              <Text style={S.val}>XChaCha20-Poly1305</Text>
            </View>
            <View style={[S.row, S.rowLast]}>
              <Text style={S.key}>Updates from</Text>
              <Text style={S.val}>GitHub releases</Text>
            </View>
          </View>
          <Pressable style={S.ghost} onPress={() => Linking.openURL(REPO_URL).catch(() => { })}>
            <Text style={S.ghostText}>View source on GitHub</Text>
          </Pressable>
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/* ── Helpers ── */

function statusLine(phase: Updater['phase'], installed: string): string {
  switch (phase.kind) {
    case 'checking':
      return 'Checking for updates…';
    case 'upToDate':
      return `ClipLink v${installed} is the latest version.`;
    case 'available':
      return `Version ${phase.update.version} is available to download.`;
    case 'downloading':
      return `Downloading v${phase.update.version} — ${Math.round(phase.progress * 100)}%`;
    case 'ready':
      return `Version ${phase.update.version} is downloaded and ready to install.`;
    case 'failed':
      return phase.message;
    default:
      return 'Tap below to check for a new version.';
  }
}

function relativeTime(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/* ── Styles ── */

const S = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: C.void,
    paddingTop: RNStatusBar.currentHeight ?? 0,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { color: C.text, fontSize: 30, lineHeight: 32, fontWeight: '400' },
  topTitle: { color: C.text, fontSize: 19, fontWeight: '700', letterSpacing: -0.2 },

  scroll: { padding: 18, paddingTop: 8, gap: 8 },

  sectionLabel: {
    color: C.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 14,
    marginBottom: 2,
  },

  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.edge,
    padding: 16,
    gap: 12,
  },

  rows: {
    backgroundColor: C.input,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.edge,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.edge,
  },
  rowLast: { borderBottomWidth: 0 },
  key: { color: C.muted, fontSize: 12.5 },
  val: { color: C.text, fontSize: 12.5, fontWeight: '600', flexShrink: 1 },

  status: { color: C.muted, fontSize: 12.5, lineHeight: 18 },
  statusBad: { color: '#ffb3a0' },
  body: { color: C.muted, fontSize: 12.5, lineHeight: 19 },
  notes: { color: C.text, fontSize: 12.5, lineHeight: 19 },

  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: C.input,
    overflow: 'hidden',
  },
  barFill: { height: 6, borderRadius: 3, backgroundColor: C.accent },

  primary: {
    backgroundColor: C.accent,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 14.5 },

  ghost: {
    borderColor: C.edgeBright,
    borderWidth: 1,
    borderRadius: 11,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  ghostDisabled: { opacity: 0.6 },
  ghostText: { color: C.text, fontWeight: '600', fontSize: 13.5 },
});
