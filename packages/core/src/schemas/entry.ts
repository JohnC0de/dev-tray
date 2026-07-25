import { z } from 'zod';

export const HealthSchema = z.enum(['unknown', 'alive', 'dead', 'slow']);

export const PartialEntrySchema = z.object({
  id: z.string(),
  port: z.number().int(),
  pid: z.number().int(),
  projectName: z.string(),
  gitRoot: z.string().nullable(),
  cwd: z.string().nullable(),
  branchCurrent: z.string().nullable(),
  startTime: z.string().nullable(),
  framework: z.string().nullable(),
  groupKey: z.string().nullable(),
});

export type PartialEntry = z.infer<typeof PartialEntrySchema>;

export const EntrySchema = PartialEntrySchema.extend({
  branchAtStart: z.string().nullable(),
  branchDrifted: z.boolean(),
  health: HealthSchema,
  openUrl: z.string().nullable(),
});

export type Entry = z.infer<typeof EntrySchema>;

/** Legacy shape compatibility during migration */
export const LegacyEntrySchema = EntrySchema.extend({
  branch: z.string().optional(),
});
