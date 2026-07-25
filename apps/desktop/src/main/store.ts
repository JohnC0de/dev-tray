import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export const ALLOWED_INTERVALS = [2, 5, 10, 30] as const;

const DEFAULTS = Object.freeze({
  refreshInterval: 5,
  hasCompletedOnboarding: false,
  debugLogging: false,
});

export type SettingsData = {
  refreshInterval: number;
  hasCompletedOnboarding: boolean;
  debugLogging: boolean;
};

export class Store {
  private readonly _file: string;
  private _data: SettingsData;

  constructor() {
    this._file = path.join(app.getPath('userData'), 'settings.json');
    this._data = { ...DEFAULTS };
    this._load();
  }

  private _load(): void {
    try {
      const raw = fs.readFileSync(this._file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<SettingsData>;
      this._data = { ...DEFAULTS, ...parsed };
    } catch {
      // No file yet (first run) or unreadable — keep defaults.
    }
    if (!ALLOWED_INTERVALS.includes(this._data.refreshInterval as typeof ALLOWED_INTERVALS[number])) {
      this._data.refreshInterval = DEFAULTS.refreshInterval;
    }
    this._data.hasCompletedOnboarding = !!this._data.hasCompletedOnboarding;
    this._data.debugLogging = !!this._data.debugLogging;
  }

  private _save(): void {
    try {
      fs.mkdirSync(path.dirname(this._file), { recursive: true });
      fs.writeFileSync(this._file, JSON.stringify(this._data, null, 2), 'utf8');
    } catch {
      // Best effort; settings are non-critical.
    }
  }

  get all(): SettingsData {
    return { ...this._data };
  }

  get refreshInterval(): number {
    return this._data.refreshInterval;
  }

  set refreshInterval(v: unknown) {
    const n = Number(v);
    this._data.refreshInterval = ALLOWED_INTERVALS.includes(n as typeof ALLOWED_INTERVALS[number])
      ? n
      : DEFAULTS.refreshInterval;
    this._save();
  }

  get hasCompletedOnboarding(): boolean {
    return this._data.hasCompletedOnboarding;
  }

  set hasCompletedOnboarding(v: unknown) {
    this._data.hasCompletedOnboarding = !!v;
    this._save();
  }
}
