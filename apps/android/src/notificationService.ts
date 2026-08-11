/**
 * JS bridge to the native NotificationModule / NotificationListenerService.
 *
 * The service emits two events:
 *   "onNotificationPosted" — a new notification arrived on the phone
 *   "onNotificationRemoved" — a notification was dismissed on the phone
 *
 * ClipLink subscribes to these and forwards them to the PC over the
 * existing WebSocket, so notifications mirror on the PC's system tray.
 * The PC can send a dismiss command back which calls dismissNotification().
 */
import { NativeModules, NativeEventEmitter } from 'react-native';

const { NotificationModule } = NativeModules;

export type PhoneNotification = {
    key: string;
    packageName: string;
    appName: string;
    title: string;
    text: string;
    postedAt: number;
};

export async function isNotificationListenerEnabled(): Promise<boolean> {
    if (!NotificationModule?.isNotificationListenerEnabled) return false;
    try { return await NotificationModule.isNotificationListenerEnabled(); }
    catch { return false; }
}

export function openNotificationListenerSettings(): void {
    NotificationModule?.openNotificationListenerSettings?.();
}

export function dismissNotification(key: string): void {
    NotificationModule?.dismissNotification?.(key);
}

export function onNotificationPosted(cb: (n: PhoneNotification) => void): () => void {
    if (!NotificationModule) return () => { };
    const emitter = new NativeEventEmitter(NotificationModule);
    const sub = emitter.addListener('onNotificationPosted', cb);
    return () => sub.remove();
}

export function onNotificationRemoved(cb: (key: string) => void): () => void {
    if (!NotificationModule) return () => { };
    const emitter = new NativeEventEmitter(NotificationModule);
    const sub = emitter.addListener('onNotificationRemoved', ({ key }) => cb(key));
    return () => sub.remove();
}
