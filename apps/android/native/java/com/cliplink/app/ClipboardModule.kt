package com.cliplink.app

import android.content.Intent
import android.provider.Settings
import android.text.TextUtils
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Native module that exposes two things to JS:
 *
 * 1. isAccessibilityServiceEnabled() — returns true if our
 *    ClipboardAccessibilityService is currently active so the JS layer
 *    can decide whether to show the "enable" prompt.
 *
 * 2. openAccessibilitySettings() — opens the system Accessibility settings
 *    screen so the user can enable the service with a single tap.
 *
 * We also wire the React context into the service singleton here so it can
 * emit events back to JS.
 */
class ClipboardModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    init {
        // Give the service a reference to the React context so it can emit
        // "onClipboardChanged" events even when the activity is gone.
        ClipboardAccessibilityService.reactContext = reactContext
    }

    override fun getName(): String = "ClipboardModule"

    @ReactMethod
    fun isAccessibilityServiceEnabled(promise: com.facebook.react.bridge.Promise) {
        try {
            promise.resolve(checkEnabled())
        } catch (e: Exception) {
            promise.reject("CHECK_FAILED", e)
        }
    }

    @ReactMethod
    fun openAccessibilitySettings() {
        val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        reactContext.startActivity(intent)
    }

    private fun checkEnabled(): Boolean {
        // Fast path — if the service object is alive it is definitely enabled.
        if (ClipboardAccessibilityService.instance != null) return true

        // Slow path — parse the enabled-services setting string. Format:
        // "pkg/ServiceClass:pkg2/ServiceClass2:…"
        val enabledServices = try {
            Settings.Secure.getString(
                reactContext.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: ""
        } catch (_: Exception) {
            return false
        }

        val target = "${reactContext.packageName}/${ClipboardAccessibilityService::class.java.name}"
        val splitter = TextUtils.SimpleStringSplitter(':')
        splitter.setString(enabledServices)
        for (component in splitter) {
            if (component.equals(target, ignoreCase = true)) return true
        }
        return false
    }
}
