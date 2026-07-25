import type { Entry } from '@dev-tray/core';

export interface AppInit {
  version: string;
  appName: string;
  settings: {
    refreshInterval: number;
    hasCompletedOnboarding: boolean;
  };
  launchAtLogin: boolean;
}

export interface PortsUpdatePayload {
  entries: Entry[];
  isScanning: boolean;
  error: string | null;
  diagnostics?: {
    duration: number;
    portsFound?: number;
    dataSource?: string;
    timestamp?: string;
  } | null;
}

export interface DevTrayBridge {
  init: () => Promise<AppInit>;
  setLaunchAtLogin: (enabled: boolean) => Promise<boolean>;
  setRefreshInterval: (seconds: number) => Promise<number>;
  completeOnboarding: () => Promise<boolean>;
  refresh: () => void;
  killPort: (pid: number, port: number) => void;
  killAll: () => void;
  openPort: (port: number, url?: string) => void;
  copy: (text: string) => void;
  openExternal: (url: string) => void;
  openInExplorer: (cwd: string | null, gitRoot: string | null) => void;
  openInEditor: (cwd: string | null, gitRoot: string | null) => void;
  quit: () => void;
  hideWindow: () => void;
  resizeWindow: (height: number) => void;
  dragStart: (screenX: number, screenY: number) => void;
  dragMove: (screenX: number, screenY: number) => void;
  dragEnd: () => void;
  getBounds: () => Promise<{ x: number; y: number; width: number; height: number } | null>;
  updateTray: (payload: { dataURL?: string; tooltip?: string }) => void;
  onPortsUpdate: (cb: (data: PortsUpdatePayload) => void) => () => void;
  onWillShow: (cb: () => void) => () => void;
}

declare global {
  interface Window {
    devTray: DevTrayBridge;
  }
}

export {};
