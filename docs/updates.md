# Releases and auto-updates

## How a release happens

`.github/workflows/check.yml` runs on every push to `main`: TypeScript builds,
`cargo fmt`, `clippy -D warnings`, and the Rust tests.

`.github/workflows/release.yml` runs when a `v*` tag is pushed. It re-runs those
same checks, then builds in parallel:

| Artifact | Runner |
| --- | --- |
| macOS `.dmg` (Apple Silicon + Intel) | `macos-latest` |
| Linux `.AppImage` / `.deb` | `ubuntu-22.04` |
| Windows `.msi` / `.exe` | `windows-latest` |
| Android `.apk` | `ubuntu-latest` |

Everything is attached to the GitHub release for the tag.

```bash
git tag v0.1.1 && git push origin v0.1.1
```

Bump the version in `apps/desktop/src-tauri/tauri.conf.json` **and**
`apps/desktop/package.json` before tagging. The updater compares against the
version baked into the installed build, so a tag alone changes nothing.

## Desktop auto-update

The Tauri updater in every installed copy polls
`https://github.com/ichigo-k/cliplink/releases/latest/download/latest.json`.
`tauri-action` generates and signs that manifest during the release build, and
the client verifies the signature against the public key in `tauri.conf.json`
before installing anything.

Two repository secrets make this work:

| Secret | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of the generated `.key` file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password chosen when generating it |

Without them the build still succeeds, but produces updates that every client
rejects — which is the correct failure, just a quiet one. Losing the private key
means no installed copy can ever be updated again; regenerating it strands
everyone on their current version.

## Android

**The APK.** Android refuses to install an update signed with a different key
than the installed copy, so the release keystore must be identical every time
and comes from secrets rather than being generated per build:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Key alias |
| `ANDROID_KEY_PASSWORD` | Key password |

Generate one once and never lose it:

```bash
keytool -genkeypair -v -keystore release.keystore -alias cliplink -keyalg RSA -keysize 2048 -validity 10000
```

If `ANDROID_KEYSTORE_BASE64` is unset the workflow still builds, but emits a
warning and produces a debug-signed APK that cannot upgrade an existing install.

`expo prebuild` regenerates `android/` on every run, so
`apps/android/scripts/configure-signing.mjs` re-applies the signing config
afterwards.

**Over-the-air JS updates.** The `android-ota` job publishes JS, styling, and
asset changes through EAS Update, so phones pick them up without reinstalling.
Native changes still need a new APK. It is disabled until you opt in:

1. Run `eas update:configure` in `apps/android` — it writes the real project ID
   and update URL into `app.json`.
2. Add an `EXPO_TOKEN` secret.
3. Set the repository variable `EAS_ENABLED` to `true`.
