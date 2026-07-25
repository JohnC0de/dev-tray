import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import Store from 'electron-store';
import {
  DEFAULT_SETTINGS,
  SettingsSchema,
  type Settings,
} from '@dev-tray/core';

const store = new Store({ name: 'settings' });

function readRaw(): Record<string, unknown> {
  try {
    return (store.store as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

export function loadSettings(): Settings {
  const parsed = SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...readRaw() });
  if (parsed.success) return parsed.data;
  return DEFAULT_SETTINGS;
}

export function saveSettings(partial: Partial<Settings>): Settings {
  const current = loadSettings();
  const next = SettingsSchema.parse({ ...current, ...partial });
  store.store = next;
  return next;
}

export function getRefreshInterval(): number {
  return loadSettings().refreshInterval;
}

export function setRefreshInterval(seconds: number): number {
  return saveSettings({ refreshInterval: seconds as Settings['refreshInterval'] }).refreshInterval;
}

export function completeOnboarding(): boolean {
  saveSettings({ hasCompletedOnboarding: true });
  return true;
}

export function settingsForInit(): Pick<Settings, 'refreshInterval' | 'hasCompletedOnboarding'> {
  const s = loadSettings();
  return {
    refreshInterval: s.refreshInterval,
    hasCompletedOnboarding: s.hasCompletedOnboarding,
  };
}

export function getScanBackend(): Settings['scanBackend'] {
  return loadSettings().scanBackend;
}

export function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function resetSettingsForTest(): void {
  if (fs.existsSync(settingsPath())) fs.unlinkSync(settingsPath());
}
