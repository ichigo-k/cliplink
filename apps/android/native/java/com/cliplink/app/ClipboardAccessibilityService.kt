package com.cliplink.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.view.accessibility.AccessibilityEvent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File

/**
 * Accessibility service that monitors clipboard changes and forwards them to
 * the JS bundle so ClipLink can sync to the PC automatically.
 *
 * WHY THIS WORKS:
 * Android 10+ blocks clipboard reads from background apps. However an
 * AccessibilityService runs in a privileged context that is exempt from this
 * restriction, so a plain ClipboardManager.OnPrimaryClipChangedListener
 * registered here keeps firing while ClipLink is in the background.
 *
 * There is no clipboard accessibility event type in the framework, so we
 * subscribe to no events at all. See onServiceConnected.
 *
 * Two events reach JS:
 *   onClipboardChanged       the clip text
 *   onClipboardImageChanged  { path, mime, size } for a screenshot or copied
 *                            image, the bytes already copied into our cache
 *
 * App.tsx picks either up and sends it, the same path the manual button takes.
 *
 * NOTE: We never store or log clipboard text. Image bytes land in cacheDir
 * only long enough for JS to read and send them, and JS deletes them after.
 */
class ClipboardAccessibilityService : AccessibilityService() {

    private var clipboardManager: ClipboardManager? = null
    private var clipListener: ClipboardManager.OnPrimaryClipChangedListener? = null

    override fun onServiceConnected() {
        // We subscribe to NO accessibility events. There is no clipboard event
        // type in the framework, so listening for any of them would only hand us
        // screen content we have no use for.
        //
        // The service exists purely so ClipboardManager works: since Android 10
        // only the default IME or a running accessibility service may read the
        // clipboard in the background, and being bound is what grants that.
        serviceInfo = serviceInfo?.also { info ->
            info.eventTypes = 0
            info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            info.flags = AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS.inv() and
                    info.flags // ensure we don't accidentally request window content
            info.notificationTimeout = 100
        }

        // This listener is the actual clipboard mechanism.
        clipboardManager =
            getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        clipListener = ClipboardManager.OnPrimaryClipChangedListener {
            emitClipboardChange()
        }
        clipboardManager?.addPrimaryClipChangedListener(clipListener!!)

        instance = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        // Required override. eventTypes is 0, so nothing is delivered here and
        // we deliberately inspect nothing.
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
        val clip = try {
            clipboardManager?.primaryClip
        } catch (_: Exception) {
            null
        } ?: return
        if (clip.itemCount == 0) return

        val item = try {
            clip.getItemAt(0)
        } catch (_: Exception) {
            null
        } ?: return

        // Text wins whenever the clip carries any. This matches the desktop's
        // "plain text > image" ordering in clipboard.rs, so both ends agree on
        // what a clip that has both actually is.
        val text = try {
            item.text?.toString()?.takeIf { it.isNotBlank() }
        } catch (_: Exception) {
            null
        }
        if (text != null) {
            emit("onClipboardChanged", text)
            return
        }

        emitImage(item.uri ?: return)
    }

    /**
     * Copies a clipboard image into our own cache and tells JS where it is.
     *
     * The bytes are copied rather than the URI forwarded for the same reason
     * ShareModule copies: the read grant that comes with a clip is not
     * something JS can rely on still holding by the time it opens the stream,
     * and the URI can point into another app's private storage.
     */
    private fun emitImage(uri: Uri) {
        // Checked before the copy rather than after: with no live bridge nobody
        // will ever read the file, so there is no point writing one.
        val ctx = liveContext() ?: return

        val resolver = applicationContext.contentResolver
        val mime = try {
            resolver.getType(uri)
        } catch (_: Exception) {
            null
        } ?: return
        if (!mime.startsWith("image/")) return

        // Android can fire the listener more than once for a single copy.
        if (uri.toString() == lastImageUri) return

        val name = displayName(uri) ?: "clipboard-${System.currentTimeMillis()}"
        val dir = File(cacheDir, "clipboard").apply { mkdirs() }
        val dest = File(dir, "${System.currentTimeMillis()}-$name")

        val copied = try {
            resolver.openInputStream(uri)?.use { input ->
                dest.outputStream().use { output -> input.copyTo(output) }
            } != null
        } catch (_: Exception) {
            false
        }

        if (!copied || dest.length() == 0L) {
            dest.delete()
            return
        }

        lastImageUri = uri.toString()

        val payload = Arguments.createMap().apply {
            putString("path", "file://${dest.absolutePath}")
            putString("mime", mime)
            putDouble("size", dest.length().toDouble())
        }

        try {
            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit("onClipboardImageChanged", payload)
        } catch (_: Exception) {
            // The bridge died between the check and the call, so JS will never
            // read this copy. Do not leave it sitting in the cache.
            dest.delete()
        }
    }

    private fun emit(event: String, value: String) {
        val ctx = liveContext() ?: return
        try {
            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit(event, value)
        } catch (_: Exception) {
            // Nothing the user can act on, and see liveContext for why throwing
            // out of here is the one thing we must not do.
        }
    }

    /**
     * The React context, but only while JS can actually receive from it.
     *
     * The service outlives the activity, so a clip can arrive long after the
     * context it was handed has been torn down, and getJSModule throws in that
     * state. Everything here runs inside an OnPrimaryClipChangedListener
     * callback, so an escaping exception takes the listener down with it and
     * clipboard sync stays dead until the accessibility service is toggled off
     * and on again in system settings. ShareModule.flushPending guards the same
     * way for the same reason.
     */
    private fun liveContext(): ReactApplicationContext? =
        reactContext?.takeIf { it.hasActiveReactInstance() }

    private fun displayName(uri: Uri): String? = try {
        applicationContext.contentResolver.query(uri, null, null, null, null)?.use { c ->
            val i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (i >= 0 && c.moveToFirst()) c.getString(i) else null
        } ?: uri.lastPathSegment
    } catch (_: Exception) {
        uri.lastPathSegment
    }

    companion object {
        /** Held so the native module can check service state without a Context lookup. */
        @Volatile
        var instance: ClipboardAccessibilityService? = null

        /** Set by ClipboardModule once the React context is ready. */
        @Volatile
        var reactContext: ReactApplicationContext? = null

        /** Guards against the listener firing twice for one copy. */
        @Volatile
        private var lastImageUri: String? = null
    }
}
