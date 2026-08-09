const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withBackgroundService(config) {
  return withAndroidManifest(config, (config) => {
    const androidManifest = config.modResults;
    const mainApplication = androidManifest.manifest.application[0];

    if (!mainApplication.service) {
      mainApplication.service = [];
    }

    const serviceName = 'com.asterinet.react.bgactions.RNBackgroundActionsTask';
    const existingService = mainApplication.service.find(
      (s) => s.$ && s.$['android:name'] === serviceName
    );

    if (existingService) {
      existingService.$['android:foregroundServiceType'] = 'dataSync';
    } else {
      mainApplication.service.push({
        $: {
          'android:name': serviceName,
          'android:foregroundServiceType': 'dataSync',
        },
      });
    }

    return config;
  });
};
