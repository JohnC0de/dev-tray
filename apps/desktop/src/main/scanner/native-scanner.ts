import { ScanRowSchema, type ScanRow } from '@dev-tray/core';

export async function scanNative(): Promise<ScanRow[]> {
  try {
    const native = await import('@dev-tray/scan-native');
    const rows = native.scanListeningPorts() as unknown[];
    return ScanRowSchema.array().parse(rows);
  } catch (e) {
    throw new Error(`native scan failed: ${(e as Error).message}`);
  }
}
