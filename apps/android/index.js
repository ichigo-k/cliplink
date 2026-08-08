// Explicit entry point rather than pointing `main` at
// node_modules/expo/AppEntry.js: npm workspaces hoist `expo` to the repo root,
// so that path does not exist here and Expo's gradle entry resolver returns an
// empty string, failing the Android build with "Cannot convert '' to File".
import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
