const FRAMEWORK_PATTERNS: Array<[RegExp, string]> = [
  [/\bvite\b/i, 'vite'],
  [/\bnext\b/i, 'next'],
  [/\bnuxt\b/i, 'nuxt'],
  [/\bwebpack-dev-server\b/i, 'webpack'],
  [/\breact-scripts\b/i, 'cra'],
  [/\b@angular\/cli\b/i, 'angular'],
  [/\bsvelte-kit\b/i, 'svelte'],
  [/\bremix\b/i, 'remix'],
  [/\bastro\b/i, 'astro'],
  [/\brails\b|\bpuma\b|\brackup\b/i, 'rails'],
  [/\buvicorn\b/i, 'uvicorn'],
  [/\bgunicorn\b/i, 'gunicorn'],
  [/\bflask\b/i, 'flask'],
  [/\bdjango\b/i, 'django'],
  [/\bphp\s+-S\b|\bartisan\s+serve\b/i, 'php'],
  [/\bdeno\s+run\b.*\b--watch\b/i, 'deno'],
  [/\bbun\s+--hot\b|\bbun\s+dev\b/i, 'bun'],
  [/\bparcel\b/i, 'parcel'],
  [/\besbuild\b.*--serve/i, 'esbuild'],
];

export function detectFramework(cmd: string | undefined | null): string | null {
  if (!cmd) return null;
  for (const [re, label] of FRAMEWORK_PATTERNS) {
    if (re.test(cmd)) return label;
  }
  return null;
}
