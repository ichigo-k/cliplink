/**
 * Expo config plugin: makes ClipLink a target for everything the Android share
 * sheet can send — text, images, video, documents, several files at once.
 *
 * WHY AN ALIAS INSTEAD OF AN INTENT-FILTER ON MAINACTIVITY:
 * MainActivity uses android:launchMode="singleTask". On Android 6–13 (and some
 * OEM launchers on later versions), the OS silently hides apps from the share
 * sheet when their only SEND filter lives on a singleTask activity. An
 * activity-alias is a lightweight indirection — it gets its own share-sheet
 * entry but routes the intent to MainActivity.
 *
 * WHY A FULL WILDCARD AND NOT A LIST OF TYPES:
 * The share sheet matches on the sender's declared MIME type, and senders are
 * inconsistent — a gallery may offer "image/jpeg", a wildcard image type, or
 * "application/octet-stream" for the same photo. A full wildcard is the only
 * way to appear for everything. "text/plain" is additionally declared because
 * some senders match exact types before wildcards.
 *
 * Using a plugin (rather than editing AndroidManifest.xml by hand) means all of
 * this survives every `expo prebuild` / `expo run:android` rebuild.
 */
const { withAndroidManifest, withMainActivity } = require('@expo/config-plugins');

const ALIAS_NAME = '.ShareActivity';

/** Marker keeping the Kotlin injection idempotent across prebuilds. */
const INTAKE_MARKER = 'ShareModule.handleIntent';

const INTAKE_IMPORT = 'import android.content.Intent';

/**
 * Both entry points hand the intent to ShareModule, which owns all the parsing.
 * onCreate covers a cold launch; onNewIntent covers the singleTask case where
 * Android reuses the running activity instead of creating one.
 */
const INTAKE_KOTLIN = `
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    ShareModule.handleIntent(this, intent)
  }
`;

function withShareIntake(config) {
    return withMainActivity(config, (config) => {
        let contents = config.modResults.contents;

        if (contents.includes(INTAKE_MARKER)) {
            return config;
        }

        if (!contents.includes(INTAKE_IMPORT)) {
            contents = contents.replace(/^(package .+\n)/m, `$1\n${INTAKE_IMPORT}\n`);
        }

        // Cold start: the intent is already on the activity by the time
        // onCreate runs, so read it straight off `intent`.
        const onCreateAnchor = /(super\.onCreate\(null\))/;
        if (!onCreateAnchor.test(contents)) {
            throw new Error(
                '[withShareActivity] Could not find `super.onCreate(null)` in MainActivity.kt. ' +
                'Update this plugin — without the cold-start hook, sharing to a closed ' +
                'ClipLink silently drops whatever was shared.'
            );
        }
        contents = contents.replace(
            onCreateAnchor,
            '$1\n    ShareModule.handleIntent(this, intent)'
        );

        // Warm start: append onNewIntent before the class's closing brace.
        const lastBrace = contents.lastIndexOf('}');
        if (lastBrace === -1) {
            throw new Error(
                '[withShareActivity] MainActivity.kt has no closing brace to append to.'
            );
        }
        contents = contents.slice(0, lastBrace) + INTAKE_KOTLIN + contents.slice(lastBrace);

        config.modResults.contents = contents;
        return config;
    });
}

function withShareManifest(config) {
    return withAndroidManifest(config, (config) => {
        const manifest = config.modResults;
        const app = manifest.manifest.application[0];

        // Strip any SEND filter Expo may have put on MainActivity itself.
        // Leaving one alongside the alias causes duplicate share-sheet entries
        // and re-triggers the singleTask hiding bug.
        for (const activity of app.activity ?? []) {
            if (
                activity.$?.['android:name'] === '.MainActivity' &&
                activity['intent-filter']
            ) {
                activity['intent-filter'] = activity['intent-filter'].filter((filter) => {
                    const actions = (filter.action ?? []).map((a) => a.$?.['android:name']);
                    return (
                        !actions.includes('android.intent.action.SEND') &&
                        !actions.includes('android.intent.action.SEND_MULTIPLE')
                    );
                });
            }
        }

        if (!app['activity-alias']) {
            app['activity-alias'] = [];
        }

        // Rebuild rather than skip-if-present, so widening the type list in a
        // later version actually reaches projects that already have the alias.
        app['activity-alias'] = app['activity-alias'].filter(
            (a) => a.$?.['android:name'] !== ALIAS_NAME
        );

        const category = [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }];

        app['activity-alias'].push({
            $: {
                'android:name': ALIAS_NAME,
                'android:targetActivity': '.MainActivity',
                'android:label': 'ClipLink',
                'android:exported': 'true',
            },
            'intent-filter': [
                {
                    action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
                    category,
                    data: [
                        { $: { 'android:mimeType': 'text/plain' } },
                        { $: { 'android:mimeType': '*/*' } },
                    ],
                },
                {
                    action: [{ $: { 'android:name': 'android.intent.action.SEND_MULTIPLE' } }],
                    category,
                    data: [{ $: { 'android:mimeType': '*/*' } }],
                },
            ],
        });

        return config;
    });
}

module.exports = function withShareActivity(config) {
    return withShareIntake(withShareManifest(config));
};
