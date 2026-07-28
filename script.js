/* =================================================================
   THE GUESTBOOK — script.js
   Vanilla JS, organized into small modules:
     Utils      – formatting, ids, toasts, confirm dialog
     Sound      – tiny generated click feedback (no audio files needed)
     Settings   – admin-configurable settings, persisted to localStorage
     DB         – IndexedDB wrapper for saved videos
     Camera     – getUserMedia handling
     Recorder   – MediaRecorder wrapper
     Screens    – screen transition manager
     Admin      – admin panel wiring
     App        – top level flow controller (the state machine described
                  in the brief: Home → Call → Countdown → Recording →
                  Finish → Home)
   ================================================================= */

(() => {
  'use strict';

  /* ================================================================
     UTILS
     ================================================================ */
  const Utils = {
    genId() {
      return 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    },
    pad(n) { return n < 10 ? '0' + n : '' + n; },
    formatTimer(totalSeconds) {
      const m = Math.floor(totalSeconds / 60);
      const s = Math.floor(totalSeconds % 60);
      return `${Utils.pad(m)}:${Utils.pad(s)}`;
    },
    formatDuration(seconds) {
      if (!seconds || seconds < 1) return '0:01';
      const m = Math.floor(seconds / 60);
      const s = Math.round(seconds % 60);
      return `${m}:${Utils.pad(s)}`;
    },
    formatDate(ts) {
      const d = new Date(ts);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    },
    formatTime(ts) {
      const d = new Date(ts);
      return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    },
    formatBytes(bytes) {
      if (!bytes) return '0 MB';
      const mb = bytes / (1024 * 1024);
      if (mb < 1000) return mb.toFixed(0) + ' MB';
      return (mb / 1024).toFixed(1) + ' GB';
    },
    toast(message, duration = 2600) {
      const el = document.getElementById('toast');
      el.textContent = message;
      el.classList.add('show');
      clearTimeout(Utils._toastTimer);
      Utils._toastTimer = setTimeout(() => el.classList.remove('show'), duration);
    },
    /** Returns a Promise<boolean> resolved true if the user confirms. */
    confirm(message) {
      return new Promise((resolve) => {
        const overlay = document.getElementById('confirm-modal');
        const msgEl = document.getElementById('confirm-message');
        const okBtn = document.getElementById('confirm-ok');
        const cancelBtn = document.getElementById('confirm-cancel');
        msgEl.textContent = message;
        overlay.classList.remove('hidden');

        const cleanup = (result) => {
          overlay.classList.add('hidden');
          okBtn.removeEventListener('click', onOk);
          cancelBtn.removeEventListener('click', onCancel);
          resolve(result);
        };
        const onOk = () => cleanup(true);
        const onCancel = () => cleanup(false);
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
      });
    },
    /** Adds the ripple animation class briefly whenever a .btn is tapped. */
    wireRipple(el) {
      el.addEventListener('pointerdown', (e) => {
        const rect = el.getBoundingClientRect();
        el.style.setProperty('--ripple-x', (e.clientX - rect.left) + 'px');
        el.style.setProperty('--ripple-y', (e.clientY - rect.top) + 'px');
        el.classList.remove('rippling');
        // eslint-disable-next-line no-unused-expressions
        el.offsetWidth; // force reflow so the animation can restart
        el.classList.add('rippling');
      });
    }
  };

  /* ================================================================
     SOUND — tiny synthesized click, avoids needing an audio asset
     ================================================================ */
  const Sound = {
    ctx: null,
    ensureCtx() {
      if (!this.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) this.ctx = new Ctx();
      }
      return this.ctx;
    },
    click() {
      const ctx = this.ensureCtx();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 720;
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.09);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    }
  };

  /* ================================================================
     SETTINGS — persisted to localStorage, applied as CSS variables
     ================================================================ */
  const SETTINGS_KEY = 'guestbook_settings_v1';

  const FONT_PAIRS = {
    playfair: { display: "'Playfair Display', Georgia, serif", body: "'Poppins', sans-serif" },
    cormorant: { display: "'Cormorant Garamond', Georgia, serif", body: "'Montserrat', sans-serif" },
    times: { display: "'Times New Roman', Georgia, serif", body: "'Helvetica Neue', Arial, sans-serif" }
  };

  const DEFAULT_SETTINGS = {
    passwordHash: null,          // null = no password set yet
    bgImage: null,               // dataURL
    bgVideo: null,                // dataURL
    overlayOpacity: 55,          // 0-90
    overlayColor: '#08080a',
    greetingAudio: null,         // dataURL
    countdownDuration: 5,
    countdownStyle: 'numeric',   // 'numeric' | 'phrase'
    countdownFontSize: 96,
    countdownColor: '#ecd9ad',
    accentColor: '#c9a15a',
    buttonColor: '#c9a15a',
    fontChoice: 'playfair',
    radius: 18,
    videoAspectRatio: '9:16',   // '9:16' | '16:9' | '1:1' | '4:3'
    eyebrow: 'Forever begins today',
    title: 'The Guestbook',
    subtitle: 'Pick up the phone and leave us a memory to keep'
  };

  const Settings = {
    data: { ...DEFAULT_SETTINGS },

    load() {
      try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        this.data = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
      } catch (err) {
        console.error('Failed to load settings', err);
        this.data = { ...DEFAULT_SETTINGS };
      }
      this.apply();
    },

    save() {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.data));
      } catch (err) {
        console.error('Failed to save settings (storage full?)', err);
        Utils.toast('Could not save settings — storage may be full.');
      }
    },

    set(key, value) {
      this.data[key] = value;
      this.save();
      this.apply();
    },

    resetToDefaults() {
      const keepPassword = this.data.passwordHash;
      this.data = { ...DEFAULT_SETTINGS, passwordHash: keepPassword };
      this.save();
      this.apply();
    },

    /** Pushes current settings into the live DOM / CSS variables. */
    apply() {
      const root = document.documentElement.style;
      root.setProperty('--accent', this.data.accentColor);
      root.setProperty('--btn-color', this.data.buttonColor);
      root.setProperty('--radius', this.data.radius + 'px');
      root.setProperty('--countdown-color', this.data.countdownColor);
      root.setProperty('--countdown-size', this.data.countdownFontSize + 'px');

      const rgb = Utils_hexToRgb(this.data.overlayColor);
      root.setProperty('--overlay-color-rgb', `${rgb.r},${rgb.g},${rgb.b}`);
      root.setProperty('--overlay-opacity', (this.data.overlayOpacity / 100).toString());

      const fonts = FONT_PAIRS[this.data.fontChoice] || FONT_PAIRS.playfair;
      root.setProperty('--font-display', fonts.display);
      root.setProperty('--font-body', fonts.body);

      // Background image / video
      const imgEl = document.getElementById('home-bg-image');
      const vidEl = document.getElementById('home-bg-video');
      if (this.data.bgVideo) {
        vidEl.src = this.data.bgVideo;
        vidEl.classList.remove('hidden');
        imgEl.classList.add('hidden');
        vidEl.play().catch(() => {});
      } else {
        vidEl.classList.add('hidden');
        imgEl.classList.remove('hidden');
        imgEl.src = this.data.bgImage || '';
      }

      document.getElementById('home-eyebrow').textContent = this.data.eyebrow;
      document.getElementById('home-title').textContent = this.data.title;
      document.getElementById('home-subtitle').textContent = this.data.subtitle;
    }
  };

  function Utils_hexToRgb(hex) {
    const clean = (hex || '#000000').replace('#', '');
    const bigint = parseInt(clean.length === 3
      ? clean.split('').map((c) => c + c).join('')
      : clean, 16);
    return {
      r: (bigint >> 16) & 255,
      g: (bigint >> 8) & 255,
      b: bigint & 255
    };
  }

  /** Very small non-cryptographic hash, sufficient for a kiosk PIN gate. */
  function simpleHash(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash |= 0;
    }
    return 'h' + hash;
  }

  /* ================================================================
     DB — IndexedDB wrapper for saved recordings
     ================================================================ */
  const DB = {
    name: 'guestbook_db',
    storeName: 'videos',
    version: 1,
    _db: null,

    open() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(this.name, this.version);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
            store.createIndex('createdAt', 'createdAt', { unique: false });
          }
        };
        req.onsuccess = () => { this._db = req.result; resolve(this._db); };
        req.onerror = () => reject(req.error);
      });
    },

    async ensure() {
      if (!this._db) await this.open();
      return this._db;
    },

    async addVideo(record) {
      const db = await this.ensure();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        tx.objectStore(this.storeName).add(record);
        tx.oncomplete = () => resolve(record);
        tx.onerror = () => reject(tx.error);
      });
    },

    async getAll() {
      const db = await this.ensure();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readonly');
        const req = tx.objectStore(this.storeName).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    },

    async getRecent(limit = 20) {
      const all = await this.getAll();
      return all.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
    },

    async deleteVideo(id) {
      const db = await this.ensure();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        tx.objectStore(this.storeName).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },

    async oldestId() {
      const all = await this.getAll();
      if (!all.length) return null;
      return all.sort((a, b) => a.createdAt - b.createdAt)[0].id;
    },

    /** Best-effort browser storage estimate for the home screen pill. */
    async estimate() {
      if (navigator.storage && navigator.storage.estimate) {
        try {
          const { usage, quota } = await navigator.storage.estimate();
          return { usage, quota };
        } catch (err) { /* ignore */ }
      }
      return null;
    }
  };

  /* ================================================================
     CAMERA — getUserMedia handling with front->rear fallback
     ================================================================ */

  // Target capture resolution for each admin-selectable aspect ratio.
  // These are requested as *ideal*, not exact, so the browser still falls
  // back gracefully on hardware that can't hit them.
  const ASPECT_RESOLUTIONS = {
    '9:16': { width: 1080, height: 1920, ratio: 9 / 16 },
    '16:9': { width: 1920, height: 1080, ratio: 16 / 9 },
    '1:1': { width: 1080, height: 1080, ratio: 1 },
    '4:3': { width: 1440, height: 1080, ratio: 4 / 3 }
  };

  const Camera = {
    stream: null,

    async start() {
      // Raw audio, no processing — a bare mic feed just like a native
      // camera app records, rather than the browser's voice-call-style
      // cleanup (which can sound processed/artificial on playback).
      const audioConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2,
        sampleRate: 48000
      };

      const aspectKey = (Settings.data && Settings.data.videoAspectRatio) || '9:16';
      const res = ASPECT_RESOLUTIONS[aspectKey] || ASPECT_RESOLUTIONS['9:16'];
      const videoBase = {
        width: { ideal: res.width },
        height: { ideal: res.height },
        aspectRatio: { ideal: res.ratio }
      };

      const constraintSets = [
        { video: { ...videoBase, facingMode: { exact: 'user' } }, audio: audioConstraints },
        { video: { ...videoBase, facingMode: 'user' }, audio: audioConstraints },
        { video: { ...videoBase, facingMode: { exact: 'environment' } }, audio: audioConstraints },
        { video: true, audio: true }
      ];
      let lastErr = null;
      for (const constraints of constraintSets) {
        try {
          this.stream = await navigator.mediaDevices.getUserMedia(constraints);
          return this.stream;
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr || new Error('Camera unavailable');
    },

    stop() {
      if (this.stream) {
        this.stream.getTracks().forEach((t) => t.stop());
        this.stream = null;
      }
    }
  };

  /* ================================================================
     RECORDER — MediaRecorder wrapper
     ================================================================ */
  const Recorder = {
    mediaRecorder: null,
    chunks: [],
    startedAt: 0,
    timerInterval: null,

    pickMimeType() {
      const candidates = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm'
      ];
      return candidates.find((type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || '';
    },

    start(stream, onTick) {
      this.chunks = [];
      const mimeType = this.pickMimeType();
      // Bitrates pushed close to what a native camera app records at
      // (roughly what a phone shoots 1080p video at, and well above the
      // "safe" web-call defaults browsers otherwise apply). Actual
      // encoded bitrate is still capped by whatever the device's hardware
      // encoder can sustain, so this is a ceiling/request, not a guarantee.
      const options = {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 256000,
        videoBitsPerSecond: 16000000
      };
      this.mediaRecorder = new MediaRecorder(stream, options);
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this.chunks.push(e.data);
      };
      this.mediaRecorder.start(250); // gather data every 250ms
      this.startedAt = Date.now();
      if (onTick) {
        this.timerInterval = setInterval(() => onTick((Date.now() - this.startedAt) / 1000), 250);
      }
    },

    stop() {
      return new Promise((resolve) => {
        if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
        if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
          resolve({ blob: new Blob(this.chunks, { type: 'video/webm' }), duration: 0 });
          return;
        }
        const duration = (Date.now() - this.startedAt) / 1000;
        this.mediaRecorder.onstop = () => {
          const blob = new Blob(this.chunks, { type: this.mediaRecorder.mimeType || 'video/webm' });
          resolve({ blob, duration });
        };
        this.mediaRecorder.stop();
      });
    }
  };

  /* ================================================================
     SCREENS — simple fade/slide screen manager
     ================================================================ */
  const Screens = {
    current: 'home',
    show(name) {
      document.querySelectorAll('.screen').forEach((el) => {
        el.classList.toggle('active', el.dataset.screen === name);
      });
      this.current = name;
    }
  };

  /* ================================================================
     THUMBNAIL — captures a frame from a video element into a dataURL
     ================================================================ */
  async function generateThumbnail(blobUrl) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.src = blobUrl;
      video.currentTime = 0.1;

      const finish = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 240;
          canvas.height = Math.round(240 * (video.videoHeight / video.videoWidth || 1.33));
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        } catch (err) {
          resolve(null);
        }
      };

      video.addEventListener('loadeddata', () => {
        // seeking a touch in guarantees a decoded frame on most browsers
        video.currentTime = Math.min(0.15, (video.duration || 1) / 2);
      });
      video.addEventListener('seeked', finish, { once: true });
      video.addEventListener('error', () => resolve(null), { once: true });
      setTimeout(finish, 1200); // safety net if events never fire
    });
  }

  /* ================================================================
     ADMIN — settings panel wiring
     ================================================================ */
  const Admin = {
    init() {
      document.getElementById('btn-admin').addEventListener('click', () => this.open());
      document.getElementById('admin-login-cancel').addEventListener('click', () => App.goHome());
      document.getElementById('admin-login-submit').addEventListener('click', () => this.tryUnlock());
      document.getElementById('admin-close').addEventListener('click', () => App.goHome());
      document.getElementById('btn-reset-defaults').addEventListener('click', async () => {
        const ok = await Utils.confirm('Reset all guestbook settings to defaults?');
        if (ok) { Settings.resetToDefaults(); this.populateFields(); Utils.toast('Settings reset.'); }
      });

      document.querySelectorAll('.admin-tab').forEach((tab) => {
        tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
      });

      this.wireBackground();
      this.wireAudio();
      this.wireCountdown();
      this.wireRecordingSettings();
      this.wireTheme();
      this.wirePassword();
    },

    switchTab(name) {
      document.querySelectorAll('.admin-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
      document.querySelectorAll('.admin-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === name));
    },

    open() {
      Screens.show('admin');
      const hasPassword = !!Settings.data.passwordHash;
      document.getElementById('admin-login').classList.remove('hidden');
      document.getElementById('admin-panel').classList.add('hidden');
      document.getElementById('admin-password-input').value = '';
      document.getElementById('admin-login-error').classList.add('hidden');
      document.getElementById('admin-login').querySelector('.muted.small').classList.toggle('hidden', hasPassword);
    },

    async tryUnlock() {
      const input = document.getElementById('admin-password-input').value;
      const hasPassword = !!Settings.data.passwordHash;

      if (!hasPassword) {
        // First run: whatever is typed (including blank) becomes the password
        if (input) Settings.set('passwordHash', simpleHash(input));
        this.enterPanel();
        return;
      }
      if (simpleHash(input) === Settings.data.passwordHash) {
        this.enterPanel();
      } else {
        document.getElementById('admin-login-error').classList.remove('hidden');
      }
    },

    enterPanel() {
      document.getElementById('admin-login').classList.add('hidden');
      document.getElementById('admin-panel').classList.remove('hidden');
      this.populateFields();
    },

    populateFields() {
      const d = Settings.data;
      document.getElementById('input-overlay-opacity').value = d.overlayOpacity;
      document.getElementById('overlay-opacity-value').textContent = d.overlayOpacity + '%';
      document.getElementById('input-overlay-color').value = d.overlayColor;

      document.getElementById('input-countdown-duration').value = d.countdownDuration;
      document.getElementById('countdown-duration-value').textContent = d.countdownDuration + 's';
      document.getElementById('input-countdown-style').value = d.countdownStyle;
      document.getElementById('input-countdown-fontsize').value = d.countdownFontSize;
      document.getElementById('countdown-fontsize-value').textContent = d.countdownFontSize + 'px';
      document.getElementById('input-countdown-color').value = d.countdownColor;

      document.getElementById('input-aspect-ratio').value = d.videoAspectRatio;

      document.getElementById('input-accent-color').value = d.accentColor;
      document.getElementById('input-button-color').value = d.buttonColor;
      document.getElementById('input-font-choice').value = d.fontChoice;
      document.getElementById('input-radius').value = d.radius;
      document.getElementById('radius-value').textContent = d.radius + 'px';

      const greetingPreview = document.getElementById('greeting-preview');
      if (d.greetingAudio) {
        greetingPreview.src = d.greetingAudio;
        greetingPreview.classList.remove('hidden');
      } else {
        greetingPreview.classList.add('hidden');
      }
    },

    flashSaved() {
      const note = document.getElementById('admin-save-note');
      note.textContent = 'Saved';
      note.classList.add('show');
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => note.classList.remove('show'), 1200);
    },

    readFileAsDataURL(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    },

    wireBackground() {
      document.getElementById('input-bg-image').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const dataUrl = await this.readFileAsDataURL(file);
        Settings.set('bgImage', dataUrl);
        this.flashSaved();
      });
      document.getElementById('input-bg-video').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const dataUrl = await this.readFileAsDataURL(file);
        Settings.set('bgVideo', dataUrl);
        this.flashSaved();
      });
      document.getElementById('btn-clear-bg-video').addEventListener('click', () => {
        Settings.set('bgVideo', null);
        document.getElementById('input-bg-video').value = '';
        this.flashSaved();
      });
      document.getElementById('input-overlay-opacity').addEventListener('input', (e) => {
        document.getElementById('overlay-opacity-value').textContent = e.target.value + '%';
        Settings.set('overlayOpacity', Number(e.target.value));
      });
      document.getElementById('input-overlay-color').addEventListener('input', (e) => {
        Settings.set('overlayColor', e.target.value);
      });
    },

    wireAudio() {
      document.getElementById('input-greeting-audio').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const dataUrl = await this.readFileAsDataURL(file);
        Settings.set('greetingAudio', dataUrl);
        this.populateFields();
        this.flashSaved();
      });
      document.getElementById('btn-clear-greeting').addEventListener('click', () => {
        Settings.set('greetingAudio', null);
        document.getElementById('input-greeting-audio').value = '';
        this.populateFields();
        this.flashSaved();
      });
    },

    wireCountdown() {
      document.getElementById('input-countdown-duration').addEventListener('input', (e) => {
        document.getElementById('countdown-duration-value').textContent = e.target.value + 's';
        Settings.set('countdownDuration', Number(e.target.value));
      });
      document.getElementById('input-countdown-style').addEventListener('change', (e) => {
        Settings.set('countdownStyle', e.target.value);
      });
      document.getElementById('input-countdown-fontsize').addEventListener('input', (e) => {
        document.getElementById('countdown-fontsize-value').textContent = e.target.value + 'px';
        Settings.set('countdownFontSize', Number(e.target.value));
      });
      document.getElementById('input-countdown-color').addEventListener('input', (e) => {
        Settings.set('countdownColor', e.target.value);
      });
    },

    wireRecordingSettings() {
      document.getElementById('input-aspect-ratio').addEventListener('change', (e) => {
        Settings.set('videoAspectRatio', e.target.value);
        Utils.toast('New aspect ratio applies on the next recording.');
      });
    },

    wireTheme() {
      document.getElementById('input-accent-color').addEventListener('input', (e) => {
        Settings.set('accentColor', e.target.value);
      });
      document.getElementById('input-button-color').addEventListener('input', (e) => {
        Settings.set('buttonColor', e.target.value);
      });
      document.getElementById('input-font-choice').addEventListener('change', (e) => {
        Settings.set('fontChoice', e.target.value);
      });
      document.getElementById('input-radius').addEventListener('input', (e) => {
        document.getElementById('radius-value').textContent = e.target.value + 'px';
        Settings.set('radius', Number(e.target.value));
      });
    },

    wirePassword() {
      document.getElementById('btn-save-password').addEventListener('click', () => {
        const val = document.getElementById('input-new-password').value;
        Settings.set('passwordHash', val ? simpleHash(val) : null);
        document.getElementById('input-new-password').value = '';
        this.flashSaved();
        Utils.toast(val ? 'Password updated.' : 'Password removed.');
      });
    }
  };

  /* ================================================================
     APP — top-level flow controller
     ================================================================ */
  const App = {
    activeStream: null,
    pendingRecording: null,   // { blobUrl, blob, duration, thumbnail }
    wakeLockSentinel: null,
    countdownTimeoutIds: [],

    async init() {
      Settings.load();
      Admin.init();
      this.setViewportHeightVar();
      window.addEventListener('resize', () => this.setViewportHeightVar());

      document.querySelectorAll('.btn').forEach((el) => Utils.wireRipple(el));

      document.getElementById('btn-call').addEventListener('click', () => { Sound.click(); this.startCallFlow(); });
      document.getElementById('btn-stop-recording').addEventListener('click', () => { Sound.click(); this.stopRecording(); });
      document.getElementById('btn-record-again').addEventListener('click', () => { Sound.click(); this.recordAgain(); });
      document.getElementById('btn-use-video').addEventListener('click', () => { Sound.click(); this.saveRecording(); });
      document.getElementById('btn-playback-back').addEventListener('click', () => { Sound.click(); this.goHome(); });
      document.getElementById('btn-playback-delete').addEventListener('click', () => { Sound.click(); this.deleteFromPlayback(); });

      // Prevent accidental navigation away from the kiosk.
      window.addEventListener('beforeunload', (e) => {
        e.preventDefault();
        e.returnValue = '';
      });
      document.addEventListener('contextmenu', (e) => e.preventDefault());

      // First tap anywhere: unlock fullscreen + wake lock + audio, browsers
      // require a user gesture before granting these.
      const unlockOnce = () => {
        this.requestFullscreen();
        this.requestWakeLock();
        Sound.ensureCtx();
        document.removeEventListener('pointerdown', unlockOnce);
      };
      document.addEventListener('pointerdown', unlockOnce);

      this.registerServiceWorker();
      this.requestPersistentStorage();
      await this.refreshRecentList();
      Screens.show('home');
    },

    setViewportHeightVar() {
      document.documentElement.style.setProperty('--vh', (window.innerHeight * 0.01) + 'px');
    },

    async requestFullscreen() {
      try {
        const el = document.documentElement;
        if (el.requestFullscreen) await el.requestFullscreen();
        if (screen.orientation && screen.orientation.lock) {
          screen.orientation.lock('portrait').catch(() => {});
        }
      } catch (err) { /* fullscreen may be blocked; app still works */ }
    },

    async requestWakeLock() {
      try {
        if ('wakeLock' in navigator) {
          this.wakeLockSentinel = await navigator.wakeLock.request('screen');
          document.addEventListener('visibilitychange', async () => {
            if (document.visibilityState === 'visible' && !this.wakeLockSentinel) {
              try { this.wakeLockSentinel = await navigator.wakeLock.request('screen'); } catch (e) {}
            }
          });
        }
      } catch (err) { /* not fatal */ }
    },

    registerServiceWorker() {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {
          // Optional — the app already works fully offline once the tab
          // is loaded, since it has no external network dependencies.
        });
      }
    },

    /**
     * Asks the browser not to auto-evict this site's storage (IndexedDB,
     * localStorage) under disk-space pressure. Not a guarantee, but it
     * meaningfully lowers the odds recordings get silently cleared mid-event
     * on a phone that's also used for other things. Safe to call repeatedly;
     * a no-op on browsers that don't support the API.
     */
    async requestPersistentStorage() {
      try {
        if (navigator.storage && navigator.storage.persist) {
          const already = await navigator.storage.persisted();
          if (!already) await navigator.storage.persist();
        }
      } catch (err) { /* not fatal — best effort only */ }
    },

    goHome() {
      this.cancelCountdown();
      Camera.stop();
      Screens.show('home');
      this.refreshRecentList();
    },

    /* ---------- CALL FLOW: greeting → countdown → recording ---------- */
    async startCallFlow() {
      Screens.show('call');
      document.getElementById('call-status-text').textContent = 'Calling…';
      document.getElementById('countdown-display').classList.add('hidden');
      document.getElementById('countdown-display').textContent = '';

      // Start requesting the camera in the background so it's ready
      // the instant the countdown finishes.
      const cameraPromise = Camera.start().catch((err) => {
        console.error('Camera error', err);
        Utils.toast('Camera/microphone access is required to record.');
        return null;
      });

      const audioEl = document.getElementById('greeting-audio');
      const hasGreeting = !!Settings.data.greetingAudio;

      const beginCountdown = () => this.runCountdown(cameraPromise);

      if (hasGreeting) {
        audioEl.src = Settings.data.greetingAudio;
        audioEl.currentTime = 0;
        document.getElementById('call-status-text').textContent = 'Playing greeting…';
        audioEl.onended = beginCountdown;
        audioEl.onerror = beginCountdown;
        try {
          await audioEl.play();
        } catch (err) {
          // Autoplay may be blocked in rare cases — fall back immediately.
          beginCountdown();
        }
      } else {
        // No greeting configured — brief pause so "Calling…" registers,
        // then move straight to the countdown.
        this.countdownTimeoutIds.push(setTimeout(beginCountdown, 1200));
      }
    },

    cancelCountdown() {
      this.countdownTimeoutIds.forEach((id) => clearTimeout(id));
      this.countdownTimeoutIds = [];
      const audioEl = document.getElementById('greeting-audio');
      audioEl.pause();
      audioEl.onended = null;
    },

    runCountdown(cameraPromise) {
      if (Screens.current !== 'call') return; // user navigated away
      document.getElementById('call-status-text').textContent = 'Get ready…';
      const display = document.getElementById('countdown-display');
      display.classList.remove('hidden');

      const duration = Settings.data.countdownDuration;
      const style = Settings.data.countdownStyle;
      const phraseSteps = ['Ready…', 'Get Set…', 'Record!'];

      const stepFor = (secondsLeft, index, total) => {
        if (style === 'phrase') {
          const i = Math.min(phraseSteps.length - 1, Math.floor((index / total) * phraseSteps.length));
          return phraseSteps[i];
        }
        return String(secondsLeft);
      };

      let count = duration;
      const tick = () => {
        if (Screens.current !== 'call') return;
        display.textContent = stepFor(count, duration - count, duration);
        display.style.animation = 'none';
        // eslint-disable-next-line no-unused-expressions
        display.offsetWidth;
        display.style.animation = '';
        Sound.click();
        count -= 1;
        if (count >= 0) {
          this.countdownTimeoutIds.push(setTimeout(tick, 1000));
        } else {
          this.beginRecording(cameraPromise);
        }
      };
      tick();
    },

    /* ---------- RECORDING ---------- */
    async beginRecording(cameraPromise) {
      const stream = await cameraPromise;
      if (!stream) { this.goHome(); return; }
      if (Screens.current !== 'call') { Camera.stop(); return; } // navigated away mid-countdown

      this.activeStream = stream;
      Screens.show('recording');
      const preview = document.getElementById('camera-preview');
      preview.srcObject = stream;
      document.getElementById('rec-timer').textContent = '00:00';

      Recorder.start(stream, (elapsed) => {
        document.getElementById('rec-timer').textContent = Utils.formatTimer(elapsed);
      });
    },

    async stopRecording() {
      if (Screens.current !== 'recording') return;
      const { blob, duration } = await Recorder.stop();
      Camera.stop();
      const preview = document.getElementById('camera-preview');
      preview.srcObject = null;

      const blobUrl = URL.createObjectURL(blob);
      const thumbnail = await generateThumbnail(blobUrl);

      this.pendingRecording = { blob, blobUrl, duration, thumbnail };

      const finishVideo = document.getElementById('finish-preview');
      finishVideo.src = blobUrl;
      finishVideo.play().catch(() => {});
      Screens.show('finish');
    },

    recordAgain() {
      if (this.pendingRecording) {
        URL.revokeObjectURL(this.pendingRecording.blobUrl);
        this.pendingRecording = null;
      }
      document.getElementById('finish-preview').src = '';
      this.startCallFlow();
    },

    async saveRecording() {
      if (!this.pendingRecording) { this.goHome(); return; }
      const { blob, duration, thumbnail } = this.pendingRecording;
      const now = Date.now();
      const record = {
        id: Utils.genId(),
        blob,
        thumbnail,
        createdAt: now,
        duration,
        size: blob.size
      };

      try {
        await this.enforceStorageBudget();
        await DB.addVideo(record);
        this.downloadRecording(blob, now);
        Utils.toast('Message saved — thank you!');
      } catch (err) {
        console.error('Save failed', err);
        Utils.toast('Could not save the video. Storage may be full.');
      }

      URL.revokeObjectURL(this.pendingRecording.blobUrl);
      this.pendingRecording = null;
      document.getElementById('finish-preview').src = '';
      this.goHome();
    },

    /**
     * Triggers a normal browser download of the saved clip so a copy also
     * lands on the phone itself (Chrome on Android saves it to the
     * Downloads folder). Note: this is the closest a web page can get to
     * "save to gallery" — whether it also shows up inside the Photos/
     * Gallery app depends on the phone, since some gallery apps only index
     * DCIM/Movies folders and some don't preview .webm thumbnails at all.
     */
    downloadRecording(blob, timestamp) {
      try {
        const d = new Date(timestamp);
        const stamp = `${d.getFullYear()}-${Utils.pad(d.getMonth() + 1)}-${Utils.pad(d.getDate())}_${Utils.pad(d.getHours())}-${Utils.pad(d.getMinutes())}-${Utils.pad(d.getSeconds())}`;
        const filename = `guestbook-${stamp}.webm`;

        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        // Give the browser a moment to start the download before revoking.
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 4000);
      } catch (err) {
        console.error('Auto-download failed', err);
        Utils.toast('Saved in the app, but the on-device download failed.');
      }
    },

    /** Optional auto-delete of the oldest recording if storage is nearly full. */
    async enforceStorageBudget() {
      const est = await DB.estimate();
      if (!est || !est.quota) return;
      const usedRatio = est.usage / est.quota;
      if (usedRatio > 0.92) {
        const oldestId = await DB.oldestId();
        if (oldestId) {
          await DB.deleteVideo(oldestId);
          Utils.toast('Storage nearly full — removed the oldest message to make room.');
        }
      }
    },

    /* ---------- RECENT LIST + PLAYBACK ---------- */
    async refreshRecentList() {
      const list = document.getElementById('recent-list');
      const emptyMsg = document.getElementById('recent-empty');
      const recent = await DB.getRecent(20);

      list.querySelectorAll('.rec-card').forEach((el) => el.remove());
      emptyMsg.classList.toggle('hidden', recent.length > 0);

      recent.forEach((rec) => {
        const card = document.createElement('div');
        card.className = 'rec-card';
        card.innerHTML = `
          <div class="rec-thumb-wrap">
            <img src="${rec.thumbnail || ''}" alt="Recording thumbnail" />
            <span class="rec-duration">${Utils.formatDuration(rec.duration)}</span>
          </div>
          <div class="rec-meta">${Utils.formatDate(rec.createdAt)} · ${Utils.formatTime(rec.createdAt)}</div>
        `;
        card.addEventListener('click', () => { Sound.click(); this.openPlayback(rec); });
        list.appendChild(card);
      });

      this.updateStorageEstimate();
    },

    async updateStorageEstimate() {
      const pill = document.getElementById('storage-estimate');
      const est = await DB.estimate();
      if (est && est.quota) {
        pill.textContent = `${Utils.formatBytes(est.usage)} used`;
      } else {
        pill.textContent = '';
      }
    },

    currentPlaybackId: null,
    openPlayback(record) {
      this.currentPlaybackId = record.id;
      const video = document.getElementById('playback-video');
      video.src = URL.createObjectURL(record.blob);
      document.getElementById('playback-meta').textContent =
        `${Utils.formatDate(record.createdAt)} · ${Utils.formatTime(record.createdAt)} · ${Utils.formatDuration(record.duration)}`;
      Screens.show('playback');
      video.play().catch(() => {});
    },

    async deleteFromPlayback() {
      if (!this.currentPlaybackId) return;
      const ok = await Utils.confirm('Delete this recording? This cannot be undone.');
      if (!ok) return;
      await DB.deleteVideo(this.currentPlaybackId);
      this.currentPlaybackId = null;
      document.getElementById('playback-video').pause();
      document.getElementById('playback-video').removeAttribute('src');
      Utils.toast('Recording deleted.');
      this.goHome();
    }
  };

  document.addEventListener('DOMContentLoaded', () => App.init());
})();