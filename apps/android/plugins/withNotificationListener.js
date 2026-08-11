/**
 * Expo config plugin: injects the NotificationListenerService declaration
 * into AndroidManifest.xml so it survives expo prebuild.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withNotificationListener(config) {
    return withAndroidManifest(config, (config) => {
        const app = config.modResults.manifest.application[0];
        if (!app.service) app.service = [];

        const serviceName = 'com.cliplink.app.NotificationService';
        const exists = app.service.some(s => s.$?.['android:name'] === serviceName);

        if (!exists) {
            app.service.push({
                $: {
                    'android:name': serviceName,
                    'android:exported': 'false',
                    'android:label': '@string/app_name',
                    'android:permission': 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE',
                },
                'intent-filter': [{
                    action: [{ $: { 'android:name': 'android.service.notification.NotificationListenerService' } }],
                }],
            });
        }

        return config;
    });
};
