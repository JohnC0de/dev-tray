import { z } from 'zod';
import { EntrySchema, SettingsSchema } from '@dev-tray/core';

export const IPC = {
  APP_INIT: 'app:init',
  SETTINGS_SET_LAUNCH_AT_LOGIN: 'settings:setLaunchAtLogin',
  SETTINGS_SET_REFRESH_INTERVAL: 'settings:setRefreshInterval',
  SETTINGS_COMPLETE_ONBOARDING: 'settings:completeOnboarding',
  PORTS_REFRESH: 'ports:refresh',
  PORTS_UPDATE: 'ports:update',
  PORT_KILL: 'port:kill',
  PORTS_KILL_ALL: 'ports:killAll',
  PORT_OPEN: 'port:open',
  CLIPBOARD_WRITE: 'clipboard:write',
  SHELL_OPEN_EXTERNAL: 'shell:openExternal',
  APP_QUIT: 'app:quit',
  WINDOW_HIDE: 'window:hide',
  WINDOW_RESIZE: 'window:resize',
  WINDOW_WILL_SHOW: 'window:will-show',
  TRAY_UPDATE: 'tray:update',
  CONTEXT_OPEN_EXPLORER: 'context:openExplorer',
  CONTEXT_OPEN_EDITOR: 'context:openEditor',
} as const;

export const InitResponseSchema = z.object({
  version: z.string(),
  appName: z.string(),
  settings: SettingsSchema.pick({
    refreshInterval: true,
    hasCompletedOnboarding: true,
  }),
  launchAtLogin: z.boolean(),
});

export const PortsUpdateSchema = z.object({
  entries: z.array(EntrySchema),
  isScanning: z.boolean(),
  error: z.string().nullable(),
  diagnostics: z
    .object({
      duration: z.number(),
      portsFound: z.number().optional(),
      dataSource: z.string().optional(),
      timestamp: z.string().optional(),
    })
    .nullable()
    .optional(),
});

export const KillRequestSchema = z.object({
  pid: z.number().int(),
  port: z.number().int(),
});

export const PortOpenSchema = z.object({
  port: z.number().int().min(1).max(65535),
  url: z.string().optional(),
});

export const ClipboardWriteSchema = z.object({
  text: z.string(),
});

export const ShellOpenExternalSchema = z.object({
  url: z.string().regex(/^https?:\/\//),
});

export const WindowResizeSchema = z.object({
  height: z.number(),
});

export const TrayUpdateSchema = z.object({
  dataURL: z.string().optional(),
  tooltip: z.string().optional(),
});

export const ContextPathSchema = z.object({
  cwd: z.string().nullable().optional(),
  gitRoot: z.string().nullable().optional(),
});

export const SetRefreshIntervalSchema = z.object({
  seconds: z.union([z.literal(2), z.literal(5), z.literal(10), z.literal(30)]),
});

export const SetLaunchAtLoginSchema = z.object({
  enabled: z.boolean(),
});

export type InitResponse = z.infer<typeof InitResponseSchema>;
export type PortsUpdate = z.infer<typeof PortsUpdateSchema>;
