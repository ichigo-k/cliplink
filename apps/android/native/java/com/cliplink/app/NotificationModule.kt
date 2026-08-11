package com.cliplink.app

import android.content.Intent
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Exposes three methods to JS:
 *
 *  isNotificationListenerEnabled() → Promise<boolean>
 *    Returns true if our NotificationListenerService is active.
 *
 *  openNotificationListenerSettings()
 *    Opens Settings → Apps → Special app access → Notification access.
 *
 *  dismissNotification(key: string)
 *    Dismisses the notification with the given key on the phone.
 *    Called when the user dismisses a mirrored notification on the PC.
 */
class NotificationModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    init {
        NotificationService.reactContext = reactContext
    }

    override fun getName(): String = "NotificationModule"

    @ReactMethod
    fun isNotificationListenerEnabled(promise: Promise) {
        try {
            promise.resolve(checkEnabled())
        } catch (e: Exception) {
            promise.reject("CHECK_FAILED", e)
        }
    }

    @ReactMethod
    fun openNotificationListenerSettings() {
        val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        reactContext.startActivity(intent)
    }

    @ReactMethod
    fun dismissNotification(key: String) {
        NotificationService.instance?.dismissNotification(key)
    }

    private fun checkEnabled(): Boolean {
        if (NotificationService.instance != null) return true
        val flat = Settings.Secure.getString(
            reactContext.contentResolver,
            "enabled_notification_listeners"
        ) ?: return false
        val target = "${reactContext.packageName}/${NotificationService::class.java.name}"
        return flat.split(":").any { it.equals(target, ignoreCase = true) }
    }
}
