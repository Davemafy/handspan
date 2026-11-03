import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { BrowserService } from './browser.js';
import { GitHubService, parseProjects } from './github.js';
import { settingsFromEnv, isAuthorized } from './security.js';

const settings = settingsFromEnv();
const secret = process.env.MCP_ACCESS_TOKEN;
if (!secret || secret.length < 32) {
  throw new Error('Set MCP_ACCESS_TOKEN to a random string of at least 32 characters before starting.');
}
if (!settings.targets.length) throw new Error('TARGET_HOSTS must contain at least one site.');
const browsers = new BrowserService(settings);
const github = new GitHubService({
  token: process.env.GITHUB_TOKEN,
  repositories: parseProjects(process.env.GITHUB_REPOS || ''),
  branch: process.env.GITHUB_BRANCH || 'main',
  workflow: process.env.GITHUB_WORKFLOW || 'handspan-verify.yml',
  enableWrites: process.env.ENABLE_GITHUB_WRITES === 'true',
});
const text = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const errorResult = (err) => ({ isError: true, content: [{ type: 'text', text: (err instanceof Error ? err.message : 'Unexpected error').replace(/https?:\/\/[^\s]+/g, '[URL omitted]').slice(0, 800) }] });
const safe = (callback) => async (input) => { try { return await callback(input); } catch (error) { return errorResult(error); } };
const sessionId = z.string().uuid().describe('ID returned by browser_open.');

const handler = createMcpHandler(() => {
  const server = new McpServer({ name: 'handspan', version: '0.2.0' });

  server.registerTool('inspect_site', {
    description: 'Inspect one approved site in desktop and mobile Chromium. Returns two ACTUAL PNG images plus console, network, and DOM diagnostics. Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({ url: z.string().url().describe('Approved live HTTPS URL') }),
  }, safe(async ({ url }) => {
    const content = [];
    for (const device of ['desktop', 'mobile']) {
      let opened;
      try {
        opened = await browsers.open(url, device);
        const capture = await browsers.screenshot(opened.sessionId);
        const diagnostics = await browsers.snapshot(opened.sessionId);
        content.push({ type: 'text', text: JSON.stringify({ ...opened, diagnostics }, null, 2) });
        content.push({ type: 'image', data: capture.png.toString('base64'), mimeType: 'image/png' });
      } finally {
        if (opened) await browsers.close(opened.sessionId);
      }
    }
    return { content };
  }));

  server.registerTool('browser_open', {
    description: 'Start an interactive browser session on an approved HTTPS site. Session expires after 10 minutes of inactivity.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({ url: z.string().url(), device: z.enum(['desktop', 'mobile']).default('desktop') }),
  }, safe(async ({ url, device }) => text(await browsers.open(url, device))));

  server.registerTool('browser_screenshot', {
    description: 'Return the actual screenshot from an existing browser session as a PNG image.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({ sessionId, fullPage: z.boolean().default(false) }),
  }, safe(async ({ sessionId, fullPage }) => {
    const capture = await browsers.screenshot(sessionId, fullPage);
    return { content: [
      { type: 'text', text: JSON.stringify({ device: capture.device, url: capture.url, width: capture.width }) },
      { type: 'image', data: capture.png.toString('base64'), mimeType: 'image/png' },
    ] };
  }));

  server.registerTool('browser_snapshot', {
    description: 'Read headings, controls, horizontal overflow, broken images, JavaScript errors and failed network requests.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({ sessionId }),
  }, safe(async ({ sessionId }) => text(await browsers.snapshot(sessionId))));

  server.registerTool('browser_interact', {
    description: 'Click, fill, press, or scroll on an existing browser session. Disabled unless ENABLE_INTERACTIONS=true. Test accounts only; do not trigger destructive production actions without user approval.',
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: z.object({
      sessionId,
      action: z.enum(['click', 'fill', 'press', 'scroll']),
      selector: z.string().max(500).default('body'),
      value: z.string().max(2000).optional(),
    }),
  }, safe(async ({ sessionId, action, selector, value }) => text(await browsers.interact(sessionId, action, selector, value))));

  server.registerTool('browser_close', {
    description: 'Close and dispose an existing browser session.',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: z.object({ sessionId }),
  }, safe(async ({ sessionId }) => text({ closed: await browsers.close(sessionId) })));

  const repoSchema = z.string().min(3).describe('Exact owner/repo configured in GITHUB_REPOS.');
  server.registerTool('github_repo_info', {
    description: 'Read approved repository metadata and configured branch head commit.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({ repo: repoSchema }),
  }, safe(async ({ repo }) => text(await github.repoInfo(repo))));

  server.registerTool('github_read_file', {
    description: 'Read a UTF-8 file in an approved repository on the configured branch; excludes secrets, dotfiles and other unsafe paths.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({ repo: repoSchema, path: z.string().max(220) }),
  }, safe(async ({ repo, path }) => text(await github.readFile(repo, path))));

  server.registerTool('github_update_file', {
    description: 'Update an EXISTING source/test file on the configured branch, guarded by its current SHA. Disabled unless ENABLE_GITHUB_WRITES=true. Review and approve source changes before invoking.',
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: z.object({ repo: repoSchema, path: z.string().max(220), content: z.string().max(256000),
      expectedSha: z.string().regex(/^[a-f0-9]{40}$/), message: z.string().min(1).max(120) }),
  }, safe(async (input) => text(await github.updateFile(input.repo, input.path, input.content, input.expectedSha, input.message))));

  server.registerTool('github_run_build', {
    description: 'Dispatch the fixed workflow GITHUB_WORKFLOW on the configured branch in an approved repo. Does not accept arbitrary shell commands.',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: z.object({ repo: repoSchema }),
  }, safe(async ({ repo }) => text(await github.dispatchBuild(repo))));

  server.registerTool('github_build_runs', {
    description: 'List recent verification workflow runs for the configured repository and branch.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({ repo: repoSchema }),
  }, safe(async ({ repo }) => text(await github.buildRuns(repo))));

  server.registerTool('github_build_jobs', {
    description: 'Inspect per-job and per-step results of a verified workflow run; includes links to logs and artifacts.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({ repo: repoSchema, runId: z.number().int().positive() }),
  }, safe(async ({ repo, runId }) => text(await github.buildJobs(repo, runId))));

  return server;
}, { responseMode: 'json' });

const app = createMcpExpressApp({
  host: '0.0.0.0',
  allowedHosts: settings.publicHosts,
  allowedOrigins: settings.publicHosts,
});
const nodeHandler = toNodeHandler(handler);

app.get('/health', (_req, res) => res.json({ ok: true, service: 'handspan', version: '0.2.0' }));
app.all('/mcp', (req, res, next) => {
  if (!isAuthorized(req.headers.authorization, secret)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}, (req, res) => { void nodeHandler(req, res, req.body); });

const port = Number(process.env.PORT || 3000);
const httpServer = app.listen(port, '0.0.0.0', () => {
  console.log(`handspan MCP listening on port ${port}`);
});
async function shutdown() {
  httpServer.close();
  await handler.close();
  await browsers.closeAll();
}
process.once('SIGTERM', () => { void shutdown().then(() => process.exit(0)); });
process.once('SIGINT', () => { void shutdown().then(() => process.exit(0)); });
