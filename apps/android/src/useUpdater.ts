/**
 * One source of truth for update state, shared by the header badge and the
 * Settings screen.
 *
 * The important property is that `ready` survives restarts. On every launch we
 * re-check the releases feed, and if the APK for the newest version is already
 * sitting on disk complete, we go straight to `ready` — so "Install" installs,
 * however long ago the download happened, instead of starting over.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  checkForUpdate,
  currentVersion,
  downloadUpdate,
  installUpdate,
  isUpdateDownloaded,
  notifyUpdateAvailable,
  type AvailableUpdate,
} from './updater';

export type UpdatePhase =
  /** Nothing known yet — no check has completed this session. */
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'upToDate' }
  /** Newer release found, not downloaded yet. */
  | { kind: 'available'; update: AvailableUpdate }
  | { kind: 'downloading'; update: AvailableUpdate; progress: number }
  /** Downloaded and verified complete — installing is instant from here. */
  | { kind: 'ready'; update: AvailableUpdate }
  | { kind: 'failed'; update: AvailableUpdate | null; message: string };

export type Updater = {
  phase: UpdatePhase;
  /** Version of the running app, e.g. "0.1.18". */
  installed: string;
  /** When the last successful check finished, or null if none yet. */
  checkedAt: number | null;
  /** Runs a check; downloads automatically unless `manual` is true. */
  check: (opts?: { manual?: boolean }) => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
};

export function useUpdater(): Updater {
  const [phase, setPhase] = useState<UpdatePhase>({ kind: 'idle' });
  const [checkedAt, setCheckedAt] = useState<number | null>(null);

  // Phase is read inside async flows that outlive the render they started in,
  // so the callbacks below work off a ref rather than a captured value.
  const phaseRef = useRef<UpdatePhase>(phase);
  const alive = useRef(true);

  const apply = useCallback((next: UpdatePhase) => {
    phaseRef.current = next;
    if (alive.current) setPhase(next);
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const startDownload = useCallback(async (update: AvailableUpdate) => {
    apply({ kind: 'downloading', update, progress: 0 });
    try {
      await downloadUpdate(update, fraction => {
        // Only report forward progress; a resumed download can report a jump
        // back to 0 for the first chunk.
        const current = phaseRef.current;
        if (current.kind !== 'downloading') return;
        if (fraction > current.progress) {
          apply({ kind: 'downloading', update, progress: fraction });
        }
      });
      apply({ kind: 'ready', update });
    } catch (e) {
      apply({
        kind: 'failed',
        update,
        message: e instanceof Error ? e.message : 'The download failed.',
      });
    }
  }, [apply]);

  const check = useCallback(async (opts?: { manual?: boolean }) => {
    apply({ kind: 'checking' });
    const update = await checkForUpdate();
    if (!alive.current) return;

    setCheckedAt(Date.now());

    if (!update) {
      apply({ kind: 'upToDate' });
      return;
    }

    // Nothing to do but install if a previous session already fetched it.
    if (await isUpdateDownloaded(update)) {
      apply({ kind: 'ready', update });
      return;
    }

    // Notify first: this is the only part guaranteed to survive the app being
    // swiped away before the download below finishes.
    notifyUpdateAvailable(update);

    if (opts?.manual) {
      apply({ kind: 'available', update });
      return;
    }
    await startDownload(update);
  }, [apply, startDownload]);

  const download = useCallback(async () => {
    const current = phaseRef.current;
    const update =
      current.kind === 'available' || current.kind === 'failed' ? current.update : null;
    if (!update) return;
    await startDownload(update);
  }, [startDownload]);

  const install = useCallback(async () => {
    const current = phaseRef.current;
    if (current.kind !== 'ready') return;
    try {
      await installUpdate(current.update);
    } catch (e) {
      apply({
        kind: 'failed',
        update: current.update,
        message: e instanceof Error ? e.message : 'The install could not be started.',
      });
    }
  }, [apply]);

  // Check on launch. Skipped in dev, where the running version is whatever
  // Metro is serving and a release APK would only get in the way.
  useEffect(() => {
    if (__DEV__) return;
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { phase, installed: currentVersion(), checkedAt, check, download, install };
}
