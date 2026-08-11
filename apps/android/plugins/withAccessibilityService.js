/**
 * Expo config plugin: injects the ClipboardAccessibilityService declaration
 * into AndroidManifest.xml so it survives expo prebuild / expo run:android.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withAccessibilityService(config) {
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
};
