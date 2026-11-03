import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const endpoint = process.env.MCP_URL || 'http://127.0.0.1:3000/mcp';
const token = process.env.MCP_ACCESS_TOKEN;
const url = process.argv[2];
if (!url) throw new Error('Usage: npm run smoke -- https://approved-domain.example');
if (!token) throw new Error('Set MCP_ACCESS_TOKEN before running smoke.');

async function call(method, params) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.floor(Math.random() * 1e6), method, params }),
    signal: AbortSignal.timeout(90_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`MCP ${response.status}: ${body.slice(0, 250)}`);
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    const event = body.split('\n').find(line => line.startsWith('data: '));
    if (!event) throw new Error('No SSE data in response');
    return JSON.parse(event.slice(6));
  }
  return JSON.parse(body);
}

const listing = await call('tools/list');
const names = (listing.result?.tools || []).map(tool => tool.name);
console.log('Available tools:', names.join(', '));
if (!names.includes('inspect_site')) throw new Error('inspect_site tool missing');
const response = await call('tools/call', { name: 'inspect_site', arguments: { url } });
if (response.error || response.result?.isError) throw new Error(JSON.stringify(response.error || response.result).slice(0, 500));
const content = response.result?.content || [];
const images = content.filter(item => item.type === 'image');
if (images.length !== 2) throw new Error(`Expected 2 screenshots, received ${images.length}`);
await mkdir('screenshots', { recursive: true });
for (let i = 0; i < images.length; i++) {
  const file = path.join('screenshots', i === 0 ? 'desktop.png' : 'mobile.png');
  await writeFile(file, Buffer.from(images[i].data, 'base64'));
  console.log('Saved', file);
}
for (const item of content.filter(item => item.type === 'text')) {
  try {
    const report = JSON.parse(item.text);
    console.log(`${report.device}: status=${report.status}, title=${report.title}, errors=${report.diagnostics?.events.length}`);
  } catch { console.log(item.text.slice(0, 300)); }
}
