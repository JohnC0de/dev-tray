import { execFile } from 'node:child_process';
import { scanEntries, killEntry } from './linux-scanner.js';

process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EPIPE') throw error;
});

function parsePort(value: string | undefined): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535');
  return port;
}

function parsePid(value: string | undefined): number {
  const pid = Number(value);
  if (!Number.isInteger(pid) || pid < 2) throw new Error('PID must be a positive process id');
  return pid;
}

async function main(): Promise<void> {
  const [command = 'scan', argument] = process.argv.slice(2);

  if (command === 'scan') {
    console.log(JSON.stringify({ entries: await scanEntries(), error: null }));
    return;
  }

  if (command === 'waybar') {
    const entries = await scanEntries();
    const tooltip = entries.length
      ? entries.map((entry) => `${entry.projectName} · :${entry.port}${entry.framework ? ` · ${entry.framework}` : ''}`).join('\n')
      : 'No dev servers';
    console.log(JSON.stringify({
      text: `󰖟 ${entries.length}`,
      tooltip,
      class: entries.length ? 'active' : 'idle',
    }));
    return;
  }

  if (command === 'kill') {
    await killEntry(parsePid(argument));
    return;
  }

  if (command === 'open') {
    const port = parsePort(argument);
    const entry = (await scanEntries()).find((candidate) => candidate.port === port);
    if (!entry) throw new Error(`Port ${port} is not a listed dev server`);
    const child = execFile('xdg-open', [entry.openUrl ?? `http://localhost:${port}`], () => {});
    child.unref();
    return;
  }

  throw new Error('Usage: dev-tray-linux [scan|waybar|kill <pid>|open <port>]');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (process.argv[2] === 'scan') console.log(JSON.stringify({ entries: [], error: message }));
  else if (process.argv[2] === 'waybar') console.log(JSON.stringify({ text: '󰖟 !', tooltip: message, class: 'error' }));
  else console.error(`dev-tray-linux: ${message}`);
  process.exitCode = 1;
});
