/**
 * Wraps app.json to derive `android.versionCode` from the version string.
 *
 * Android decides whether an APK is an update by comparing versionCode, and
 * ignores the human-readable version entirely. app.json never set one, so Expo
 * defaulted it to 1 and *every* release shipped as versionCode 1 — from the
 * OS's point of view no release was ever newer than the installed build.
 *
 * Computing it here rather than hard-coding a number keeps it impossible to
 * forget on a release: 0.1.19 -> 1019, 0.2.3 -> 2003, 1.0.0 -> 1000000.
 * (Assumes minor and patch stay under 1000, which is a safe bet.)
 */
module.exports = ({ config }) => {
  const [major, minor, patch] = (config.version ?? '0.0.0')
    .split('.')
    .map(part => parseInt(part, 10) || 0);

  return {
    ...config,
    android: {
      ...config.android,
      versionCode: major * 1_000_000 + minor * 1_000 + patch,
    },
  };
};
