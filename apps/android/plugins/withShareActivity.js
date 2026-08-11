/**
 * Expo config plugin: injects a share-target activity-alias into the
 * AndroidManifest so ClipLink appears in the Android share sheet.
 *
 * WHY AN ALIAS INSTEAD OF AN INTENT-FILTER ON MAINACTIVITY:
 * MainActivity uses android:launchMode="singleTask". On Android 6–13 (and
 * some OEM launchers on later versions), the OS silently hides apps from the
 * share sheet when their only SEND filter lives on a singleTask activity.
 * An activity-alias is a lightweight indirection — it has its own entry in
 * the share sheet but routes the intent to MainActivity via onNewIntent(),
 * which already handles ACTION_SEND correctly in our Kotlin code.
 *
 * Using a plugin (rather than editing AndroidManifest.xml by hand) means the
 * fix survives every `expo prebuild` / `expo run:android` rebuild.
 *
 * The alias is only half the feature: MainActivity has to actually read the
 * incoming SEND intent. Prebuild rewrites MainActivity.kt from a template, so
 * that half is injected here too (see withShareIntentHandling below).
 */
const { withAndroidManifest, withMainActivity } = require('@expo/config-plugins');

/** Marker used to keep the Kotlin injection idempotent across prebuilds. */
const HANDLER_MARKER = 'private fun extractSharedText';

const HANDLER_KOTLIN = `
  /**
   * Pass incoming SEND intent text to the JS bundle as an initial prop
   * ("sharedText"). Covers a fresh launch from the share sheet.
   */
  override fun getLaunchOptions(): Bundle? {
    val text = extractSharedText(intent) ?: return null
    return Bundle().apply { putString("sharedText", text) }
  }

  /**
   * When ClipLink is already running (singleTask), Android routes new intents
   * here instead of onCreate, so emit a JS event the running app can pick up.
   */
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    val text = extractSharedText(intent) ?: return
    reactInstanceManager
      ?.currentReactContext
      ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      ?.emit("onSharedText", text)
  }

  private fun extractSharedText(intent: Intent?): String? =
    intent
      ?.takeIf { it.action == Intent.ACTION_SEND && it.type == "text/plain" }
      ?.getStringExtra(Intent.EXTRA_TEXT)
      ?.takeIf { it.isNotBlank() }
`;

const REQUIRED_IMPORTS = [
    'import android.content.Intent',
    'import com.facebook.react.modules.core.DeviceEventManagerModule',
];

/** Injects the SEND-intent plumbing into the generated MainActivity.kt. */
function withShareIntentHandling(config) {
    return withMainActivity(config, (config) => {
        let contents = config.modResults.contents;

        if (contents.includes(HANDLER_MARKER)) {
            return config;
        }

        for (const line of REQUIRED_IMPORTS) {
            if (!contents.includes(line)) {
                // Anchor on the package declaration so imports land in a valid spot
                // regardless of what the template's import block looks like.
                contents = contents.replace(
                    /^(package .+\n)/m,
                    `$1\n${line}\n`
                );
            }
        }

        // Append the methods just before the class's closing brace.
        const lastBrace = contents.lastIndexOf('}');
        if (lastBrace === -1) {
            throw new Error(
                '[withShareActivity] MainActivity.kt has no closing brace to append to. ' +
                'Refusing to continue — the share sheet would appear but do nothing.'
            );
        }

        contents =
            contents.slice(0, lastBrace) + HANDLER_KOTLIN + contents.slice(lastBrace);

        config.modResults.contents = contents;
        return config;
    });
}

function withShareManifest(config) {
    return withAndroidManifest(config, (config) => {
        const manifest = config.modResults;
        const app = manifest.manifest.application[0];

        // Remove any SEND intent-filter that Expo may have placed on MainActivity
        // (from the now-empty intentFilters array in app.json, or leftovers from
        // a previous config). Leaving it there alongside the alias causes duplicate
        // entries and the singleTask hiding bug.
        if (app.activity) {
            for (const activity of app.activity) {
                if (
                    activity.$?.['android:name'] === '.MainActivity' &&
                    activity['intent-filter']
                ) {
                    activity['intent-filter'] = activity['intent-filter'].filter(
                        (filter) => {
                            const actions = (filter.action ?? []).map(
                                (a) => a.$?.['android:name']
                            );
                            return !actions.includes('android.intent.action.SEND');
                        }
                    );
                }
            }
        }

        // Ensure activity-alias array exists
        if (!app['activity-alias']) {
            app['activity-alias'] = [];
        }

        const aliasName = '.ShareActivity';
        const alreadyExists = app['activity-alias'].some(
            (a) => a.$?.['android:name'] === aliasName
        );

        if (!alreadyExists) {
            app['activity-alias'].push({
                $: {
                    'android:name': aliasName,
                    'android:targetActivity': '.MainActivity',
                    'android:label': 'ClipLink',
                    'android:exported': 'true',
                },
                'intent-filter': [
                    {
                        action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
                        category: [
                            { $: { 'android:name': 'android.intent.category.DEFAULT' } },
                        ],
                        data: [{ $: { 'android:mimeType': 'text/plain' } }],
                    },
                ],
            });
        }

        return config;
    });
}

module.exports = function withShareActivity(config) {
    return withShareIntentHandling(withShareManifest(config));
};
