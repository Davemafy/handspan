// Starts the actual service, checks /health and MCP tools/list, then tears it down.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';

const token = randomBytes(32).toString('hex');
const port = 38477;
const child = spawn(process.execPath, ['src/server.js'], {
  env: { ...process.env, PORT: String(port), MCP_ACCESS_TOKEN: token, TARGET_HOSTS: 'example.com' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', chunk => { logs += String(chunk); });
child.stderr.on('data', chunk => { logs += String(chunk); });
const base = `http://127.0.0.1:${port}`;
try {
  let healthy = false;
  for (let i = 0; i < 40; i++) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${logs}`);
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) { healthy = true; break; }
    } catch { /* Still starting. */ }
    await sleep(250);
  }
  assert.ok(healthy, `Server did not become healthy: ${logs}`);

  const unauthorized = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(unauthorized.status, 401, 'MCP must reject unauthenticated calls');

  const response = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
  });
  assert.equal(response.status, 200, `MCP status ${response.status}: ${await response.text()}`);
  const parsed = await response.json();
  const names = parsed.result?.tools?.map(item => item.name) || [];
  assert.equal(names.length, 12, `Unexpected tools: ${JSON.stringify(parsed)}`);
  assert.ok(names.includes('inspect_site'));
  assert.ok(names.includes('github_run_build'));
  assert.ok(names.includes('github_read_file'));
  console.log('Protocol check passed:', names.join(', '));
} finally {
  child.kill('SIGTERM');
  await sleep(200);
  if (child.exitCode === null) child.kill('SIGKILL');
}
