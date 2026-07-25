import { z } from 'zod';

export const RefreshIntervalSchema = z.union([
  z.literal(2),
  z.literal(5),
  z.literal(10),
  z.literal(30),
]);

export const SettingsSchema = z.object({
  refreshInterval: RefreshIntervalSchema.default(5),
  hasCompletedOnboarding: z.boolean().default(false),
  debugLogging: z.boolean().default(false),
  scanBackend: z.enum(['native', 'powershell']).default('native'),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  refreshInterval: 5,
  hasCompletedOnboarding: false,
  debugLogging: false,
  scanBackend: 'native',
};

export const ALLOWED_INTERVALS = [2, 5, 10, 30] as const;
