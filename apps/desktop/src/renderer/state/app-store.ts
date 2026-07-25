import { createSignal, createMemo } from 'solid-js';
import type { Entry } from '@dev-tray/core';
import type { AppInit, DevTrayBridge, PortsUpdatePayload } from '../env.js';

function bridge(): DevTrayBridge {
  if (!window.devTray) throw new Error('devTray bridge is not available');
  return window.devTray;
}

export const api: DevTrayBridge = new Proxy({} as DevTrayBridge, {
  get(_target, prop) {
    const value = bridge()[prop as keyof DevTrayBridge];
    return typeof value === 'function' ? (value as (...args: never[]) => unknown).bind(bridge()) : value;
  },
});

export const [appName, setAppName] = createSignal('Dev Tray');
export const [version, setVersion] = createSignal('');
export const [settings, setSettings] = createSignal({
  refreshInterval: 5,
  hasCompletedOnboarding: false,
});
export const hasCompletedOnboarding = createMemo(() => settings().hasCompletedOnboarding);
export const [launchAtLogin, setLaunchAtLogin] = createSignal(false);
export const [entries, setEntries] = createSignal<Entry[]>([]);
export const [isScanning, setIsScanning] = createSignal(false);
export const [error, setError] = createSignal<string | null>(null);
export const [settingsOpen, setSettingsOpen] = createSignal(false);
export const [collapsedGroups, setCollapsedGroups] = createSignal<Set<string>>(new Set());

export function entryGroupKey(entry: Entry): string {
  return entry.groupKey || entry.projectName || String(entry.port);
}

export const groupedEntries = createMemo(() => {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries()) {
    const key = entryGroupKey(entry);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }
  return groups;
});

export function toggleGroup(key: string): void {
  setCollapsedGroups((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
}

export function applyPortsUpdate(data: PortsUpdatePayload): void {
  setEntries(data.entries || []);
  setIsScanning(!!data.isScanning);
  setError(data.error || null);
}

export async function initApp(): Promise<void> {
  try {
    const info: AppInit = await api.init();
    setAppName(info.appName || 'Dev Tray');
    setVersion(info.version || '');
    setSettings(info.settings);
    setLaunchAtLogin(!!info.launchAtLogin);
  } catch (e) {
    console.error('init failed', e);
  }
}

export function completeOnboarding(): Promise<boolean> {
  return api.completeOnboarding();
}
