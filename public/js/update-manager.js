class UpdateManager {
  constructor() {
    this._state = 'idle';
    this._registration = null;
    this._waiting = null;
    this._release = null;
    this._listeners = {};
    this._bannerEl = null;
    this._reloaded = false;
    this._activating = false;
  }

  async init() {
    await this._fetchRelease();
    await this._register();
    this._checkWaiting();
  }

  async _fetchRelease() {
    try {
      const res = await fetch('/version.json');
      if (!res.ok) return;
      this._release = await res.json();
    } catch {
      /* version.json unavailable — proceed without metadata */
    }
  }

  async _register() {
    if (!('serviceWorker' in navigator)) return;
    try {
      this._registration = await navigator.serviceWorker.register('/sw.js');
      this._registration.addEventListener('updatefound', () => this._onUpdateFound());
    } catch {
      /* SW registration failed — degraded experience */
    }
  }

  _checkWaiting() {
    if (this._registration && this._registration.waiting) {
      this._waiting = this._registration.waiting;
      this._setState('update-available');
    }
  }

  _onUpdateFound() {
    const installing = this._registration.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed' && navigator.serviceWorker.controller) {
        this._waiting = installing;
        this._setState('update-available');
      }
    });
  }

  _setState(state) {
    if (this._state === state) return;
    this._state = state;
    this._emit('statechange', { state });
    this._syncBanner();
  }

  getState() {
    return this._state;
  }

  getRelease() {
    return this._release;
  }

  isCritical() {
    return !!(this._release && this._release.critical);
  }

  getWaitingWorker() {
    return this._waiting;
  }

  getRegistration() {
    return this._registration;
  }

  addEventListener(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  }

  removeEventListener(event, fn) {
    const list = this._listeners[event];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i !== -1) list.splice(i, 1);
  }

  _emit(event, data) {
    const list = this._listeners[event];
    if (list) list.forEach(function (fn) { fn(data); });
  }

  setBannerElement(el) {
    this._bannerEl = el;
    this._syncBanner();
  }

  applyUpdate() {
    if (this._activating) return;
    if (!this._waiting) return;
    this._activating = true;
    this._setState('updating');
    var self = this;
    function onControllerChange() {
      if (self._reloaded) return;
      self._reloaded = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      window.location.reload();
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    var timeoutId = setTimeout(function () {
      if (!self._reloaded) {
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
        self._activating = false;
        self._setState('update-available');
      }
    }, 10000);
    try {
      this._waiting.postMessage('SKIP_WAITING');
    } catch (e) {
      clearTimeout(timeoutId);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      this._activating = false;
      this._setState('update-available');
    }
  }

  _syncBanner() {
    if (!this._bannerEl) return;
    var show = this._state === 'update-available';
    var updating = this._state === 'updating';
    this._bannerEl.hidden = !show && !updating;
    if (updating) {
      this._bannerEl.hidden = false;
    }
  }
}
