package com.cliplink.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.ClipboardManager
import android.content.Context
import android.view.accessibility.AccessibilityEvent
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Accessibility service that monitors clipboard changes and forwards new text
 * to the JS bundle so ClipLink can sync it to the PC automatically.
 *
 * WHY THIS WORKS:
 * Android 10+ blocks clipboard reads from background apps. However an
 * AccessibilityService runs in a privileged context that is exempt from this
 * restriction. We listen for TYPE_CLIPBOARD_CHANGED (API 31+) and fall back to
 * a ClipboardManager.OnPrimaryClipChangedListener on older versions.
 *
 * The service emits a "onClipboardChanged" event to JS. App.tsx picks it up
 * and calls client.send() — exactly the same path as the manual "Send" button.
 *
 * NOTE: We never store or log clipboard content. We read it once, emit it to
 * the local JS bundle (which encrypts and sends it over LAN), then discard it.
 */
class ClipboardAccessibilityService : AccessibilityService() {

    private var clipboardManager: ClipboardManager? = null
    private var clipListener: ClipboardManager.OnPrimaryClipChangedListener? = null

    override fun onServiceConnected() {
        // Minimal footprint — we only need clipboard-changed events.
        // We do NOT request any window/touch/gesture capabilities.
        serviceInfo = serviceInfo?.also { info ->
            info.eventTypes = AccessibilityEvent.TYPE_CLIPBOARD_CHANGED
            info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            info.flags = AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS.inv() and
                    info.flags // ensure we don't accidentally request window content
            info.notificationTimeout = 100
        }

        // Fallback for Android < 11 where TYPE_CLIPBOARD_CHANGED isn't fired:
        // listen via ClipboardManager directly.
        clipboardManager =
            getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        clipListener = ClipboardManager.OnPrimaryClipChangedListener {
            emitClipboardChange()
        }
        clipboardManager?.addPrimaryClipChangedListener(clipListener!!)

        instance = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        // TYPE_CLIPBOARD_CHANGED fires on Android 11+ — handle it here.
        if (event.eventType == AccessibilityEvent.TYPE_CLIPBOARD_CHANGED) {
            emitClipboardChange()
        }
    }

    override fun onInterrupt() {
        // Required override — nothing to do.
    }

    override fun onDestroy() {
        clipListener?.let { clipboardManager?.removePrimaryClipChangedListener(it) }
        clipboardManager = null
        clipListener = null
        instance = null
        super.onDestroy()
    }

    private fun emitClipboardChange() {
        val text = try {
            clipboardManager
                ?.primaryClip
                ?.getItemAt(0)
                ?.text
                ?.toString()
                ?.takeIf { it.isNotBlank() }
        } catch (_: Exception) {
            null
        } ?: return

        // Forward to JS via the React bridge if it is available.
        val ctx = reactContext ?: return
        ctx
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit("onClipboardChanged", text)
    }

    companion object {
        /** Held so the native module can check service state without a Context lookup. */
        @Volatile
        var instance: ClipboardAccessibilityService? = null

        /** Set by ClipboardModule once the React context is ready. */
        @Volatile
        var reactContext: ReactApplicationContext? = null
    }
}
