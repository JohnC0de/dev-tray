'use strict';

// Smoke test: `node src/main/scanner-cli.js` runs two scans against the real
// machine and prints the resolved dev-server list. Verifies the worker,
// JSON framing, project resolution and filtering without launching Electron.

const path = require('node:path');
const { PortScanner } = require('./scanner');

async function main() {
  const workerPath = path.join(__dirname, '..', '..', 'scan-worker.ps1');
  const scanner = new PortScanner(workerPath);
  scanner.on('worker-stderr', (m) => console.error('[worker stderr]', m));

  for (let i = 1; i <= 2; i++) {
    const t0 = Date.now();
    const res = await scanner.scan();
    const ms = Date.now() - t0;
    console.log(`\n=== scan #${i} (${ms}ms) ===`);
    if (!res.ok) {
      console.log('ERROR:', res.error);
      continue;
    }
    console.log(`diagnostics:`, res.diagnostics);
    if (res.ports.length === 0) {
      console.log('(no dev servers detected)');
    }
    for (const p of res.ports) {
      const branch = p.branch ? ` (${p.branch})` : '';
      const up = p.startTime ? `  started ${p.startTime}` : '';
      console.log(`  :${p.port}  ${p.projectName}${branch}  pid=${p.pid}${up}`);
    }
  }

  scanner.dispose();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
