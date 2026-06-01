'use strict';

// JSON-file settings store under userData.

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const ALLOWED_INTERVALS = [2, 5, 10, 30];
const DEFAULTS = Object.freeze({
  refreshInterval: 5,
  hasCompletedOnboarding: false,
  debugLogging: false,
});

class Store {
  constructor() {
    this._file = path.join(app.getPath('userData'), 'settings.json');
    this._data = { ...DEFAULTS };
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this._file, 'utf8');
      const parsed = JSON.parse(raw);
      this._data = { ...DEFAULTS, ...parsed };
    } catch {
      // No file yet (first run) or unreadable — keep defaults.
    }
    if (!ALLOWED_INTERVALS.includes(this._data.refreshInterval)) {
      this._data.refreshInterval = DEFAULTS.refreshInterval;
    }
    // Normalize booleans so a hand-edited/corrupt file (e.g. "no") can't be
    // truthy and silently skip onboarding.
    this._data.hasCompletedOnboarding = !!this._data.hasCompletedOnboarding;
    this._data.debugLogging = !!this._data.debugLogging;
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this._file), { recursive: true });
      fs.writeFileSync(this._file, JSON.stringify(this._data, null, 2), 'utf8');
    } catch {
      // Best effort; settings are non-critical.
    }
  }

  get all() { return { ...this._data }; }

  get refreshInterval() { return this._data.refreshInterval; }
  set refreshInterval(v) {
    const n = Number(v);
    this._data.refreshInterval = ALLOWED_INTERVALS.includes(n) ? n : DEFAULTS.refreshInterval;
    this._save();
  }

  get hasCompletedOnboarding() { return this._data.hasCompletedOnboarding; }
  set hasCompletedOnboarding(v) { this._data.hasCompletedOnboarding = !!v; this._save(); }
}

module.exports = { Store, ALLOWED_INTERVALS };
