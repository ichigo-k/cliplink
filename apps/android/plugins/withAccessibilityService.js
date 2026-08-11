/**
 * Expo config plugin: injects the ClipboardAccessibilityService declaration
 * into AndroidManifest.xml so it survives expo prebuild / expo run:android.
 *
 * The declaration points at two resources that prebuild would not otherwise
 * produce: `@xml/accessibility_service_config` (copied in by
 * withNativeSources) and `@string/accessibility_service_description`, which is
 * written here. Android shows that description on the system settings screen
 * where the user enables the service, so it is user-facing text, not a label.
 */
const { withAndroidManifest, withStringsXml, AndroidConfig } = require('@expo/config-plugins');

const DESCRIPTION_KEY = 'accessibility_service_description';
const DESCRIPTION =
    'ClipLink uses this service to detect when you copy text, so it can automatically ' +
    'sync your clipboard to your paired PC over your local Wi-Fi network. ClipLink never ' +
    'reads passwords, never uploads data to the internet, and never accesses any ' +
    'on-screen content — only clipboard text.';

/** Writes the description string the manifest entry references. */
function withAccessibilityStrings(config) {
    return withStringsXml(config, (config) => {
        config.modResults = AndroidConfig.Strings.setStringItem(
            [{ _: DESCRIPTION, $: { name: DESCRIPTION_KEY, translatable: 'false' } }],
            config.modResults
        );
        return config;
    });
}

function withAccessibilityManifest(config) {
    return withAndroidManifest(config, (config) => {
        const app = config.modResults.manifest.application[0];

        if (!app.service) app.service = [];

        const serviceName = 'com.cliplink.app.ClipboardAccessibilityService';
        const exists = app.service.some(
            (s) => s.$?.['android:name'] === serviceName
        );

        if (!exists) {
            app.service.push({
                $: {
                    'android:name': serviceName,
                    'android:exported': 'false',
                    'android:permission': 'android.permission.BIND_ACCESSIBILITY_SERVICE',
                    'android:label': '@string/app_name',
                },
                'intent-filter': [
                    {
                        action: [
                            {
                                $: {
                                    'android:name':
                                        'android.accessibilityservice.AccessibilityService',
                                },
                            },
                        ],
                    },
                ],
                'meta-data': [
                    {
                        $: {
                            'android:name': 'android.accessibilityservice',
                            'android:resource': '@xml/accessibility_service_config',
                        },
                    },
                ],
            });
        }

        return config;
    });
}

module.exports = function withAccessibilityService(config) {
    return withAccessibilityStrings(withAccessibilityManifest(config));
};
