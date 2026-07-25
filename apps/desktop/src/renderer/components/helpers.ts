import { resolveOpenUrl, type Entry } from '@dev-tray/core';
import { api } from '../state/app-store.js';

export const ICON = {
  branch:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="8" r="2.4"/><path d="M6 8.4v7.2"/><path d="M18 10.2c0 4-3 4.5-6 5"/></svg>',
  open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  close:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  chevron:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>',
};

export function formatUptime(startISO: string | null): string {
  if (!startISO) return '';
  const s = Math.floor((Date.now() - new Date(startISO).getTime()) / 1000);
  if (s < 60) return '<1m';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function healthClass(entry: Entry): string {
  const h = entry.health;
  if (h === 'dead' || h === 'slow' || h === 'unknown') return `health-${h}`;
  return 'health-alive';
}

export function killRow(entry: Entry, onLeave: () => void): void {
  api.killPort(entry.pid, entry.port);
  onLeave();
}

export function openEntry(entry: Entry): void {
  api.openPort(entry.port, resolveOpenUrl(entry));
}

export function copyEntryUrl(entry: Entry): void {
  api.copy(resolveOpenUrl(entry));
}
