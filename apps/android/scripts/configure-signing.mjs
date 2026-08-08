/**
 * Points the generated Android project's release build at ClipLink's release
 * keystore.
 *
 * `expo prebuild` regenerates `android/` from scratch every CI run, and the
 * template signs release builds with a throwaway debug key. Android refuses to
 * install an update signed with a different key than the installed copy, so
 * without this every release would force users to uninstall first.
 *
 * Run from apps/android after prebuild. No-op if the keystore is absent, so
 * local builds and forks without secrets still work.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const gradleFile = resolve('android/app/build.gradle');
const keystore = resolve('android/app/release.keystore');

if (!existsSync(keystore)) {
  console.log('No release.keystore found — leaving the debug signing config in place.');
  process.exit(0);
}

if (!existsSync(gradleFile)) {
  console.error('android/app/build.gradle is missing. Run `expo prebuild` first.');
  process.exit(1);
}

const original = readFileSync(gradleFile, 'utf8');

if (original.includes('CLIPLINK_UPLOAD_STORE_FILE')) {
  console.log('Signing config already applied.');
  process.exit(0);
}

const releaseConfig = `    signingConfigs {
        release {
            storeFile file(CLIPLINK_UPLOAD_STORE_FILE)
            storePassword CLIPLINK_UPLOAD_STORE_PASSWORD
            keyAlias CLIPLINK_UPLOAD_KEY_ALIAS
            keyPassword CLIPLINK_UPLOAD_KEY_PASSWORD
        }
`;

if (!original.includes('    signingConfigs {')) {
  console.error('Could not find a signingConfigs block — the Expo template changed shape.');
  process.exit(1);
}

let patched = original.replace('    signingConfigs {', releaseConfig);

// Anchored to the `release {` block on purpose: the template's *debug* build
// type also says `signingConfig signingConfigs.debug`, and it comes first. A
// plain string replace would repoint the wrong one and leave release unsigned.
const releaseSigning = /(release\s*\{[^}]*?)signingConfig signingConfigs\.debug/;

if (!releaseSigning.test(patched)) {
  console.error("Could not find the release build type's debug signingConfig.");
  process.exit(1);
}

patched = patched.replace(releaseSigning, '$1signingConfig signingConfigs.release');

writeFileSync(gradleFile, patched);
console.log('Release builds will now be signed with release.keystore.');
