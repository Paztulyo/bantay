// Install as an app. The manifest (/manifest.webmanifest) and the service worker (/sw.js) make the site installable
// without changing how it works: the worker keeps the page, its code and the dated editorial files for offline use and
// never stores live readings (see sw.js). Simple view shows "Install Bantay El Niño" (js/simple.js) only where
// installing can happen: the browser's own prompt where it offers one (Chrome, Edge, Samsung Internet), three short
// steps on iPhone and iPad, and a hint to open a real browser from inside apps like Facebook and Messenger, whose
// built-in browsers can't install. Hidden once the site runs as an installed app.
import { TEST, PARAMS } from './util.js';

const UA = navigator.userAgent || '';
export const IOS = /iPhone|iPad|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
export const INAPP = /FBAN|FBAV|FB_IAB|Instagram|Messenger|MicroMessenger|Line\/|; wv\)/.test(UA);
const standalone = () => ['standalone', 'minimal-ui', 'fullscreen', 'window-controls-overlay'].some(m => matchMedia(`(display-mode: ${m})`).matches) || navigator.standalone === true;

let deferred = null, installed = false;
const changed = () => document.dispatchEvent(new CustomEvent('bantay:install', { detail: { state: installState() } }));
// Chrome and Edge offer installing through this event: keep it for the button instead of the browser's own banner
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; changed(); });
addEventListener('appinstalled', () => { deferred = null; installed = true; changed(); });

// 'installed', 'prompt' (the browser's prompt is ready), 'ios' (steps to show), 'inapp' (open a browser first) or 'none'
export function installState() {
  if (installed || standalone()) return 'installed';
  if (deferred) return 'prompt';
  if (INAPP) return 'inapp';
  if (IOS) return 'ios';
  return 'none';
}
// the browser's install prompt; resolves 'accepted', 'dismissed' or 'unavailable' (then the button shows the menu hint)
export async function install() {
  const e = deferred;
  if (!e) return 'unavailable';
  deferred = null;
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome === 'accepted') installed = true;
    return outcome;
  } catch { return 'unavailable'; } finally { changed(); }
}

// The service worker. Test runs (?test=1) go without it unless they ask with ?sw=1, so their stand-ins for the live
// feeds aren't kept for later runs.
if ('serviceWorker' in navigator && (!TEST || PARAMS.has('sw'))) {
  const go = () => navigator.serviceWorker.register('/sw.js').catch(err => console.warn('[pwa] service worker not registered:', err && err.message));
  if (document.readyState === 'complete') go(); else addEventListener('load', go, { once: true });
}
if (TEST) window.__pwa = { installState, install, standalone };
