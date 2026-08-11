/**
 * Expo config plugin: registers ClipboardPackage with React Native inside the
 * generated MainApplication.kt.
 *
 * ClipboardPackage is what exposes ClipboardModule and NotificationModule to
 * JS. Prebuild writes MainApplication.kt from a template that only knows about
 * autolinked packages, so without this the classes compile but never reach the
 * bridge and `NativeModules.ClipboardModule` is undefined.
 */
const { withMainApplication } = require('@expo/config-plugins');

const REGISTRATION = 'add(ClipboardPackage())';

module.exports = function withClipboardPackage(config) {
    return withMainApplication(config, (config) => {
        let contents = config.modResults.contents;

        if (contents.includes(REGISTRATION)) {
            return config;
        }

        // The template builds the package list as:
        //   PackageList(this).packages.apply {
        //     // add(MyReactNativePackage())
        //   }
        // Appending inside that `apply` block is the documented extension point.
        const anchor = /(PackageList\(this\)\.packages\.apply\s*\{)/;

        if (!anchor.test(contents)) {
            throw new Error(
                '[withClipboardPackage] Could not find `PackageList(this).packages.apply {` in ' +
                'MainApplication.kt. The Expo template changed shape — update this plugin, ' +
                'because a silent skip here ships an APK with dead native modules.'
            );
        }

        contents = contents.replace(anchor, `$1\n              ${REGISTRATION}`);

        config.modResults.contents = contents;
        return config;
    });
};
