/**
 * Expo config plugin: copies ClipLink's hand-written native Android sources
 * into the project that `expo prebuild` generates.
 *
 * WHY THIS EXISTS:
 * `apps/android/android/` is gitignored — prebuild regenerates it from Expo's
 * templates on every clean checkout, including in CI. Anything written there
 * by hand exists only on the machine that wrote it. Our clipboard and
 * notification modules are real Kotlin, so they need a home outside that
 * directory: `apps/android/native/`, which is tracked, is the source of truth
 * and this plugin stamps it into place during prebuild.
 *
 * Without it CI builds an APK whose manifest declares services whose classes
 * were never compiled, and `NativeModules.ClipboardModule` is undefined at
 * runtime — the features silently do nothing.
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

/** Mirror a directory into the generated project, creating parents as needed. */
function copyDir(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const src = path.join(from, entry.name);
        const dest = path.join(to, entry.name);
        if (entry.isDirectory()) {
            copyDir(src, dest);
        } else {
            fs.copyFileSync(src, dest);
        }
    }
}

module.exports = function withNativeSources(config) {
    return withDangerousMod(config, [
        'android',
        (config) => {
            // `platformProjectRoot` is <app>/android; our sources sit a level up.
            const projectRoot = config.modRequest.platformProjectRoot;
            const nativeRoot = path.join(config.modRequest.projectRoot, 'native');

            if (!fs.existsSync(nativeRoot)) {
                throw new Error(
                    `[withNativeSources] Expected hand-written sources at ${nativeRoot}, but the directory is missing. ` +
                    `The clipboard and notification modules cannot be compiled without it.`
                );
            }

            const javaFrom = path.join(nativeRoot, 'java');
            const javaTo = path.join(projectRoot, 'app', 'src', 'main', 'java');
            copyDir(javaFrom, javaTo);

            const resFrom = path.join(nativeRoot, 'res');
            const resTo = path.join(projectRoot, 'app', 'src', 'main', 'res');
            copyDir(resFrom, resTo);

            return config;
        },
    ]);
};
