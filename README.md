# The Guestbook — Video Guestbook Kiosk

A single-page, offline-capable video guestbook for weddings/events. Pure HTML/CSS/vanilla JS — no build step, no frameworks, no backend.

Files:
- `index.html` — markup for all 6 screens (Home, Admin, Call, Recording, Finish, Playback)
- `style.css` — luxury black/white/gold theme, glassmorphism, animations
- `script.js` — all app logic, organized into modules (Utils, Sound, Settings, DB, Camera, Recorder, Screens, Admin, App)
- `sw.js` — optional service worker that caches the app shell for offline reliability

## 1. Running locally on an Android phone (Chrome)

Camera/microphone access and Service Workers require a **secure context** — either HTTPS or `localhost`. Opening the file directly as `file://` will *not* be granted camera access, so you need a tiny local server.

**Easiest option — serve from a laptop on the same Wi‑Fi:**
1. On your laptop, inside the `guestbook` folder, run a static server, e.g. `python3 -m http.server 8080` (Python) or `npx serve .` (Node).
2. Find your laptop's local IP (e.g. `192.168.1.20`).
3. On the Android phone, open Chrome and go to `http://192.168.1.20:8080`.
4. Chrome will prompt for camera/microphone permission — tap **Allow**.

**Fully offline option — serve *from* the phone itself:**
1. Install a simple local-server app from the Play Store (e.g. "Simple HTTP Server", or use Termux with `python3 -m http.server`).
2. Put the `guestbook` folder on the phone's storage and serve it from there.
3. Open `http://localhost:PORT` in Chrome on the same phone.

Once the page has loaded once, the service worker caches the app shell, so subsequent launches work even with Wi‑Fi off — the venue doesn't need internet on the day of the event.

## 2. Installing it on Android for offline use (no APK needed)

The app is now a proper installable **Progressive Web App (PWA)** — it ships with `manifest.json` and app icons, so Chrome will offer to install it like a native app, with its own home-screen icon and no browser address bar. This is the standard alternative to building an APK for something this simple.

1. Load the app's URL in Chrome once while online (so the service worker can cache the app shell and icons).
2. Tap Chrome's **⋮ menu → "Install app"** (or "Add to Home screen" on older Chrome versions). Chrome may also show this as a banner/prompt automatically.
3. Confirm the install. An icon named "Guestbook" appears on the home screen, launching full-screen with no browser UI (`display: "fullscreen"` in the manifest).
4. From then on, opening it from that home-screen icon works even with Wi‑Fi/mobile data off — the service worker serves `index.html`, `style.css`, `script.js`, `manifest.json`, and the icons straight from cache. Recordings themselves already live in IndexedDB on-device, so they were never dependent on a network connection anyway.

Two caveats worth knowing:
- This installed app is still "just" cached web content running in Chrome's engine — it isn't a compiled APK, isn't distributed via Play Store, and updates only when the phone opens it while online again (the service worker uses a network-first-with-cache-fallback strategy, and revs its cache name with each release — bump `CACHE_NAME` in `sw.js` if you ever change the files, so old caches get cleared automatically).
- If you do eventually want a true installable `.apk`/`.aab` (for Play Store distribution or deeper OS integration like background services), the standard path is wrapping this same code as a **Trusted Web Activity** using Google's Bubblewrap CLI or PWABuilder — that produces a real Android app package pointing at this same web app, no rewrite required.

## 3. Setting up Kiosk Mode

1. Open the app URL in Chrome and let it load fully once (so the service worker can cache it).
2. Tap the screen anywhere — this first tap is what triggers the fullscreen request, screen wake lock, and audio unlock (browsers require a user gesture for all three).
3. For a true locked-down kiosk:
   - Use Chrome's **"Add to Home screen"** (menu → Add to Home screen) so it launches as a standalone app without browser chrome.
   - Enable Android's built-in **Screen Pinning** (Settings → Security → More security settings → Screen pinning) and pin the app so guests can't back out to the home screen or notification shade.
   - Alternatively, use a dedicated kiosk-launcher app (e.g. "Fully Kiosk Browser") pointed at the same URL — this gives you auto-start-on-boot, crash recovery, and a real kiosk lockdown that plain Chrome can't offer on its own.
4. The app locks portrait orientation and requests a wake lock automatically on first tap, so the screen won't sleep or rotate mid-recording.

## 4. How permissions are requested

- **Camera & microphone**: requested via `navigator.mediaDevices.getUserMedia()` only when a guest presses the call button and the countdown starts — not on page load. The code tries the front camera first (`facingMode: 'user'`), then falls back to the rear camera, then to any available camera, so it still works on devices without a front camera.
- **Fullscreen**: requested via `document.documentElement.requestFullscreen()` on the very first tap anywhere on the page (required because browsers won't grant fullscreen without a user gesture).
- **Screen Wake Lock**: requested via the `navigator.wakeLock` API on that same first tap, and re-requested automatically if the tab regains visibility after being backgrounded.
- All permission requests are wrapped in try/catch — if a phone or browser doesn't support one of these APIs (e.g. older Chrome without Wake Lock), the app degrades gracefully instead of breaking.

## 5. How IndexedDB is used

- A database called `guestbook_db` with one object store, `videos`, keyed by a generated `id`.
- Each saved record contains: the recorded video as a `Blob`, a JPEG thumbnail (captured from the first frame via a hidden `<canvas>`), `createdAt` timestamp, `duration`, and `size` in bytes.
- The Home screen queries the 20 most recently created recordings (sorted by `createdAt`, newest first) for the "Recent Messages" strip.
- Admin-configured settings (background, greeting audio, countdown, theme, password) are stored separately in `localStorage` as JSON, since they're simple key/value settings rather than large binary blobs.
- Storage headroom is checked with `navigator.storage.estimate()`; if usage climbs above ~92% of the browser's quota, the single oldest recording is automatically deleted to make room for the next guest (this is the optional "auto-delete oldest" behavior from the brief).

## 6. Notes on landscape recording while the phone stays in portrait

The brief asks for landscape video while the phone is held in portrait. The app requests a 16:9 (`1920×1080` ideal) camera resolution to bias toward a landscape-shaped recording, but the final orientation/aspect ratio of the saved file is ultimately decided by the phone's camera hardware and Chrome's own auto-rotation handling — this isn't something a web page can fully force on every device. If a specific phone model still records portrait-shaped video, mounting the phone itself in a landscape kiosk cradle is the most reliable fix.

## 7. Auto-download on save

When a guest taps **Use This Video**, the app saves the clip into IndexedDB *and* automatically triggers a normal browser download of the same file (named `guestbook-YYYY-MM-DD_HH-MM-SS.webm`). On Chrome for Android this lands in the phone's **Downloads** folder. Whether it also shows up inside the Photos/Gallery app depends on the phone — some gallery apps only index `DCIM`/`Movies`, and some don't generate thumbnails for `.webm` at all. If a given phone's gallery doesn't pick it up automatically, the file is still on the device and can be found via a file manager app or moved into `DCIM` manually.

This auto-download is deliberate, not just a nice-to-have: it's a second, independent copy of every recording outside of IndexedDB, which protects against the in-app copy being lost (see below).

**Suppressing the download notification.** A web page cannot silence Chrome's own "downloading…" notification — that's browser/OS UI, not something JavaScript can control. If you don't want it appearing during the event, disable it once on the kiosk phone itself: **Android Settings → Apps → Chrome → Notifications → turn off the "Downloads" category.** This is a one-time setup step and doesn't affect the files themselves — they still save normally, just without the popup.

**Protecting the in-app copies.** IndexedDB storage can be cleared by things outside the app's control — clearing browser data, uninstalling/reinstalling Chrome, a factory reset, or the OS evicting storage under space pressure. To reduce that last risk, the app requests **persistent storage** (`navigator.storage.persist()`) on load, which asks Chrome not to auto-evict this site's data. It's a mitigation, not a guarantee — the Downloads-folder copy from auto-download remains the more durable backup of the two.

## 8. Customizing per rental (Admin)

Tap the small gear icon in the top-right of the Home screen. First time in, leave the password field blank and tap **Unlock** to set no password, or type one to set it. From there you can change the background image/video and overlay, upload the couple's greeting audio (MP3/WAV/OGG), adjust the countdown style/duration/font/color, pick an accent color/button color/font pairing/corner roundness, and change or clear the admin password. Everything saves instantly to `localStorage` and applies live — no page reload needed. **Reset to Defaults** clears everything except the current password.