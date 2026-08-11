import React from 'react';
import { createRoot } from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import App from './App';
import Overlay from './Overlay';
import Toasts from './Toasts';
import './styles.css';

// One bundle serves both windows; the label decides which UI mounts. Outside
// Tauri (plain `vite dev` in a browser) there is no window, so fall back to the
// full app rather than crashing on a white screen.
// ?window=overlay lets `vite dev` render the flyout in a plain browser, which
// is the only way to iterate on it without a full Tauri rebuild.
const forced = new URLSearchParams(location.search).get('window');

const label =
  forced ??
  (() => {
    try {
      return getCurrentWindow().label;
    } catch {
      return 'main';
    }
  })();

document.documentElement.dataset.window = label;

const Root = label === 'overlay' ? Overlay : label === 'toast' ? Toasts : App;

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
