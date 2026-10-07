import { spawn } from 'node:child_process';
import { killEntries, scanEntries } from './linux-scanner.js';

process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EPIPE') throw error;
});

const [command = 'scan', ...arguments_] = process.argv.slice(2);

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

function escapePango(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function openUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('xdg-open', [url], {
      detached: true,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('exit', (exitCode, signal) => {
      if (exitCode === 0) resolve();
      else reject(new Error(
        signal
          ? `xdg-open was terminated by ${signal}`
          : `xdg-open exited with code ${String(exitCode)}`,
      ));
    });
  });
}

async function main(): Promise<void> {
  if (command === 'scan') {
    console.log(JSON.stringify({ entries: await scanEntries(), error: null }));
    return;
  }

  if (command === 'waybar') {
    const entries = await scanEntries();
    const tooltip = entries.length
      ? entries.map((entry) => {
        const projectName = escapePango(entry.projectName);
        const framework = entry.framework ? ` · ${escapePango(entry.framework)}` : '';
        return `${projectName} · :${entry.port}${framework}`;
      }).join('\n')
      : 'No active dev servers';
    console.log(JSON.stringify({
      text: `󰖟 ${entries.length}`,
      tooltip,
      class: entries.length ? 'active' : 'idle',
    }));
    return;
  }

  if (command === 'kill') {
    if (arguments_.length === 0) throw new Error('At least one PID is required');
    await killEntries(arguments_.map(parsePid));
    return;
  }

  if (command === 'open') {
    const port = parsePort(arguments_[0]);
    const entry = (await scanEntries()).find((candidate) => candidate.port === port);
    if (!entry) throw new Error(`Port ${port} is not a listed dev server`);
    await openUrl(entry.openUrl ?? `http://localhost:${port}`);
    return;
  }

  throw new Error('Usage: dev-tray-linux [scan|waybar|kill <pid...>|open <port>]');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (command === 'scan') console.log(JSON.stringify({ entries: [], error: message }));
  else if (command === 'waybar') console.log(JSON.stringify({
    text: '󰖟 !',
    tooltip: escapePango(message),
    class: 'error',
  }));
  else console.error(`dev-tray-linux: ${message}`);
  process.exitCode = 1;
});
