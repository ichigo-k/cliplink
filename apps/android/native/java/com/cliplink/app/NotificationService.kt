package com.cliplink.app

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableNativeMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Listens for all status-bar notifications and forwards them to JS so
 * ClipLink can relay them to the paired PC.
 *
 * Also receives "dismiss" and "action" commands from JS (via NotificationModule)
 * so the PC can remotely dismiss a notification or trigger a reply action.
 *
 * Permission required: android.permission.BIND_NOTIFICATION_LISTENER_SERVICE
 * The user must enable this in Settings → Apps → Special app access →
 * Notification access. NotificationModule.openNotificationSettings() goes there.
 */
class NotificationService : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val ctx = reactContext ?: return
        val n = sbn.notification ?: return

        // Skip our own notifications (foreground service, file progress, etc.)
        if (sbn.packageName == packageName) return

        // Skip group summary notifications — they're just containers
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return

        val extras = n.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: return
        val text  = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""

        val map = WritableNativeMap().apply {
            putString("key",         sbn.key)
            putString("packageName", sbn.packageName)
            putString("title",       title)
            putString("text",        text)
            putDouble("postedAt",    sbn.postTime.toDouble())
            putString("appName",     appLabel(sbn.packageName))
        }

        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit("onNotificationPosted", map)
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification) {
        val ctx = reactContext ?: return
        val map = WritableNativeMap().apply {
            putString("key", sbn.key)
        }
        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit("onNotificationRemoved", map)
    }

    /** Cancel (dismiss) a notification by its key. Called from NotificationModule. */
    fun dismissNotification(key: String) {
        try { cancelNotification(key) } catch (_: Exception) {}
    }

    private fun appLabel(packageName: String): String {
        return try {
            val pm = applicationContext.packageManager
            val info = pm.getApplicationInfo(packageName, 0)
            pm.getApplicationLabel(info).toString()
        } catch (_: Exception) {
            packageName
        }
    }

    override fun onListenerConnected() {
        instance = this
    }

    override fun onListenerDisconnected() {
        instance = null
    }

    companion object {
        @Volatile var instance: NotificationService? = null
        @Volatile var reactContext: ReactApplicationContext? = null
    }
}
