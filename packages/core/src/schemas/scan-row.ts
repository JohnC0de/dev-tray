import { z } from 'zod';

export const ScanRowSchema = z.object({
  port: z.number().int().min(1).max(65535),
  pid: z.number().int().positive(),
  name: z.string().optional(),
  path: z.string().optional(),
  cmd: z.string().optional(),
  cwd: z.string().optional(),
  start: z.string().nullable().optional(),
});

export type ScanRow = z.infer<typeof ScanRowSchema>;

export const ScanResultSchema = z.object({
  ok: z.boolean(),
  ports: z.array(ScanRowSchema).optional(),
  error: z.string().optional(),
  diagnostics: z
    .object({
      duration: z.number(),
      portsFound: z.number().optional(),
      dataSource: z.string().optional(),
      timestamp: z.string().optional(),
    })
    .optional(),
});

export type ScanResult = z.infer<typeof ScanResultSchema>;
