import path from 'node:path';

export const ALLOWED_FALLBACK = new Set([
  'node', 'bun', 'deno',
  'python', 'python3', 'pythonw',
  'ruby', 'php', 'go', 'java', 'dotnet',
  'uvicorn', 'gunicorn', 'puma', 'rails',
  'mix', 'elixir', 'erl', 'beam', 'beam.smp',
  'air', 'reflex', 'caddy',
]);

export const IGNORED_DIR_NAMES = new Set([
  '_build', 'build', 'tmp', 'temp', 'dist', 'deps', 'node_modules', 'bin', '.bin',
  'nodejs', 'node', 'system32', 'syswow64', 'windows', 'windowsapps',
  'program files', 'program files (x86)', 'programdata', 'appdata', 'local', 'roaming', 'microsoft',
]);

export const ELECTRON_CHILD_RE =
  /\s--type=(renderer|gpu-process|utility|zygote|ppapi|ppapi-broker|crashpad-handler|broker|nacl-loader|service)\b/i;

export function isMeaningfulDir(name: string | undefined | null): boolean {
  if (!name || name === path.sep || name.startsWith('.')) return false;
  if (/^[A-Za-z]:\\?$/.test(name)) return false;
  return !IGNORED_DIR_NAMES.has(name.toLowerCase());
}

export function isDocker(name: string, cmd: string | undefined | null): boolean {
  const n = (name || '').toLowerCase();
  if (n.includes('docker') || n.startsWith('com.dock') || n.startsWith('vpnkit')) return true;
  if (cmd && /\bdocker(d|-proxy|\.exe)?\b/i.test(cmd)) return true;
  return false;
}

export function shouldKeepFallback(
  baseName: string,
  candidateDir: string | null,
  cmd: string | undefined | null,
): boolean {
  const n = (baseName || '').toLowerCase();
  if (ALLOWED_FALLBACK.has(n)) return true;
  if (isDocker(n, cmd)) return true;
  if (n.startsWith('python') && /^python[\d.]*$/.test(n)) return true;
  if (candidateDir) {
    const base = path.basename(candidateDir).toLowerCase();
    if (isMeaningfulDir(base) && ALLOWED_FALLBACK.has(base)) return true;
  }
  return false;
}

export function isElectronChild(cmd: string | undefined | null): boolean {
  return !!(cmd && ELECTRON_CHILD_RE.test(cmd));
}
