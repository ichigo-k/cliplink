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
 */
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withShareActivity(config) {
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
};
