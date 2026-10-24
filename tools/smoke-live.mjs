import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from '../src/server.mjs';

const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const checks = [];
try {
  for (const path of ['/health', '/fx?base=USD&quote=INR', '/macro?country=IN&indicator=gdp&year=2024', '/fx?question=spot%20USD%20to%20INR']) {
    const started = performance.now(), response = await fetch(base + path), body = await response.json();
    checks.push({ path, status: response.status, duration_ms: performance.now() - started, body });
  }
  const report = { checked_at: new Date().toISOString(), scope: 'Local HTTP server making free requests to official upstream sources; not a Telegraph integration test', checks };
  await mkdir(new URL('../reports/', import.meta.url), { recursive: true });
  await writeFile(new URL(`../reports/live-source-${report.checked_at.replaceAll(':', '-')}.json`, import.meta.url), JSON.stringify(report, null, 2) + '\n');
  await writeFile(new URL('../reports/live-source-smoke.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  assert.equal(checks[0].status, 200);
  assert.equal(checks[1].status, 200, 'Live FX upstream failed');
  assert.equal(checks[2].status, 200, 'Live World Bank upstream failed');
  assert.equal(checks[3].status, 422);
} finally { await new Promise(resolve => server.close(resolve)); }
