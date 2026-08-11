package com.cliplink.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File

/**
 * Receives everything the Android share sheet sends us — text, a single image,
 * a pile of files — and hands it to JS in one shape.
 *
 * WHY THE BYTES ARE COPIED:
 * A share intent grants read permission on its content:// URIs only for the
 * lifetime of the receiving activity. JS reads the data asynchronously, well
 * after that window can close, and the URI may point into another app's private
 * storage that we can never re-open. So each stream is copied into our own
 * cache directory up front and JS is handed a plain file:// path it fully owns.
 *
 * WHY THERE IS A PENDING QUEUE:
 * On a cold start the intent arrives long before React has a bridge to emit on.
 * Items are parked in `pending` and JS drains them with getPendingShare() once
 * it mounts; when the app is already running, the event fires immediately.
 */
class ShareModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    init {
        context = reactContext
        // Anything captured before the bridge existed can now be delivered.
        flushPending()
    }

    override fun getName(): String = "ShareModule"

    /**
     * Returns and clears anything captured before JS was listening. Resolves to
     * an empty array when there is nothing waiting, never null, so the JS side
     * has one shape to handle.
     */
    @ReactMethod
    fun getPendingShare(promise: Promise) {
        synchronized(lock) {
            val out = Arguments.createArray()
            pending.forEach { out.pushMap(it.toWritableMap()) }
            pending.clear()
            promise.resolve(out)
        }
    }

    // NativeEventEmitter calls these two. React Native logs a warning without
    // them; the bodies are genuinely empty because the emitter is global.
    @ReactMethod
    fun addListener(eventName: String) {
    }

    @ReactMethod
    fun removeListeners(count: Int) {
    }

    companion object {
        private val lock = Any()
        private val pending = mutableListOf<SharedItem>()

        @Volatile
        var context: ReactApplicationContext? = null

        /**
         * Entry point from MainActivity. Safe to call with any intent — anything
         * that is not a share is ignored.
         */
        fun handleIntent(ctx: Context, intent: Intent?) {
            val items = extract(ctx, intent ?: return)
            if (items.isEmpty()) return

            synchronized(lock) { pending.addAll(items) }
            flushPending()
        }

        /** Emits everything queued, if and only if JS can receive it. */
        private fun flushPending() {
            val ctx = context ?: return
            if (!ctx.hasActiveReactInstance()) return

            val batch = synchronized(lock) {
                if (pending.isEmpty()) return
                val copy = pending.toList()
                pending.clear()
                copy
            }

            val payload = Arguments.createArray()
            batch.forEach { payload.pushMap(it.toWritableMap()) }

            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit("onShareReceived", payload)
        }

        private fun extract(ctx: Context, intent: Intent): List<SharedItem> {
            val uris: List<Uri> = when (intent.action) {
                Intent.ACTION_SEND ->
                    listOfNotNull(intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))

                Intent.ACTION_SEND_MULTIPLE ->
                    intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM) ?: emptyList()

                else -> return emptyList()
            }

            // A text share carries no stream. Note that some apps send both a
            // stream and a text label, and there the stream is the real payload.
            if (uris.isEmpty()) {
                val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.takeIf { it.isNotBlank() }
                    ?: return emptyList()
                return listOf(SharedItem.Text(text))
            }

            return uris.mapNotNull { copyToCache(ctx, it, intent.type) }
        }

        /** Copies one shared stream into our cache and describes it for JS. */
        private fun copyToCache(ctx: Context, uri: Uri, intentType: String?): SharedItem? {
            val resolver = ctx.contentResolver
            val mime = resolver.getType(uri) ?: intentType ?: "application/octet-stream"
            val name = displayName(ctx, uri) ?: "shared-${System.currentTimeMillis()}"

            val dir = File(ctx.cacheDir, "shared").apply { mkdirs() }
            // Prefix with a timestamp so two shares of "IMG_0001.jpg" don't collide.
            val dest = File(dir, "${System.currentTimeMillis()}-$name")

            return try {
                resolver.openInputStream(uri)?.use { input ->
                    dest.outputStream().use { output -> input.copyTo(output) }
                } ?: return null

                SharedItem.Payload(
                    path = "file://${dest.absolutePath}",
                    name = name,
                    mime = mime,
                    size = dest.length()
                )
            } catch (_: Exception) {
                // An unreadable stream should drop that one item, not the batch.
                dest.delete()
                null
            }
        }

        private fun displayName(ctx: Context, uri: Uri): String? = try {
            ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
                val i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (i >= 0 && c.moveToFirst()) c.getString(i) else null
            } ?: uri.lastPathSegment
        } catch (_: Exception) {
            uri.lastPathSegment
        }
    }

    /** One shared thing: either literal text, or a file we now own a copy of. */
    sealed class SharedItem {
        data class Text(val text: String) : SharedItem()
        data class Payload(
            val path: String,
            val name: String,
            val mime: String,
            val size: Long
        ) : SharedItem()

        fun toWritableMap(): WritableMap = Arguments.createMap().apply {
            when (val item = this@SharedItem) {
                is Text -> {
                    putString("kind", "text")
                    putString("text", item.text)
                }

                is Payload -> {
                    putString("kind", "file")
                    putString("path", item.path)
                    putString("name", item.name)
                    putString("mime", item.mime)
                    putDouble("size", item.size.toDouble())
                }
            }
        }
    }
}
