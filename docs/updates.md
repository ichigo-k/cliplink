# ClipLink updates

## Windows desktop

The Tauri updater creates signed update artifacts and checks a release manifest. Before the first public release, replace the placeholder GitHub owner and public key in `apps/desktop/src-tauri/tauri.conf.json`, then keep the private signing key only in CI secrets.

## Android

`expo-updates` handles JavaScript, styling, and asset updates. Users receive an in-app update message and can download and reload. Native-code changes still require a new Play Store or APK release. Run `eas update:configure` after creating the Expo project so it inserts the real project ID and update URL.
