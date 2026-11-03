# Handspan

**Your tools. Your machine. Your agent.**

Handspan is a small, MIT-licensed MCP server that gives any compatible assistant controlled access to a real browser, visual screenshots, repository files and GitHub Actions builds. It is **not** another AI assistant, model, chat UI, or autonomous scheduler.

Everyone can self-host the code. Each user keeps their deployment URL, access token, and repository credentials in their own configuration. **This repository intentionally contains no owner's personal service URL or secrets.**

> **Release status — source-verified starter, not a live deployed service.** `npm run verify` passes 11 local tests. Due to npm registry connectivity in the authoring environment, the actual MCP HTTP handshake, Playwright screenshot capture and Docker/Railway deployment have not yet been executed here. Do not interpret a passing unit test as a successful deployment.

## What it gives an agent

| MCP tool | Capability |
|---|---|
| `inspect_site` | Navigate to an approved HTTPS site and return **two real PNG screenshots**, desktop and mobile, plus page/browser diagnostics |
| `browser_open` | Open a long-lived Chromium session |
| `browser_screenshot` | Return PNG image content (not a description or URL) |
| `browser_snapshot` | Read headings, controls, horizontal overflow, failed images, HTTP/JS errors |
| `browser_interact` | Click, fill, press, scroll in an existing session; **off by default** |
| `browser_close` | End a browser session |
| `github_repo_info` | Read an approved repository's selected branch and commit |
| `github_read_file` | Read a text source file in the approved repo and path scope |
| `github_update_file` | Update an **existing** source file using a matching SHA; **off by default** |
| `github_run_build` | Dispatch a fixed GitHub Actions verification workflow in an approved repo |
| `github_build_runs` | View recent workflow statuses and links |
| `github_build_jobs` | Inspect job conclusions and individual steps |

GitHub Actions handles builds instead of running arbitrary project scripts in the same process that handles MCP authentication. A workflow must already exist in the destination repository before `github_run_build` can run it.

## Start locally

Requires Node.js 22+, npm, and Playwright Chromium.

```sh
cp .env.example .env
# Edit .env. Set TARGET_HOSTS and a strong, unique MCP_ACCESS_TOKEN.
npm install
npx playwright install --with-deps chromium
# Load the environment variables first, e.g.:
set -a; . ./.env; set +a
npm run verify
npm run test:protocol
npm start
```

In another shell, with the same access token:

```sh
MCP_URL=http://127.0.0.1:3000/mcp \
MCP_ACCESS_TOKEN='<server-token>' \
npm run smoke -- https://example.com
```

The smoke test calls the real MCP endpoint and writes `screenshots/desktop.png` and `screenshots/mobile.png`. Screenshot files are gitignored. Update the example URL to a host listed in `TARGET_HOSTS`.

### Publish your own server on Railway

1. Create a GitHub repository from this ZIP, or push this folder to a new repository you control. The public code is suitable for a public repository; **do not commit `.env`**.
2. Deploy it as a new Railway service from GitHub. Railway automatically detects the root `Dockerfile`.
3. In Railway **Variables**, set `MCP_ACCESS_TOKEN` to 32+ random characters (prefer 64 random hex characters), `TARGET_HOSTS` to your approved websites, and optional `RESOURCE_HOSTS` for images/fonts. Set `MCP_PUBLIC_HOST` to the Railway-assigned hostname after generating a domain, or use Railway's `RAILWAY_PUBLIC_DOMAIN`.
4. Start with one service instance and at least ~1 GB of memory for Chromium. No background queue is needed for browser tools.
5. Verify `GET https://<YOUR_RAILWAY_DOMAIN>/health` and then run the **remote smoke test** against `MCP_URL=https://<YOUR_RAILWAY_DOMAIN>/mcp`. The `/health` endpoint is non-sensitive, but the `/mcp` endpoint requires `Authorization: Bearer <MCP_ACCESS_TOKEN>`.
6. Use the HTTPS MCP endpoint in your compatible MCP client. Enable browser interactions only for dedicated test accounts/sites.

Your URL and token are private to your deployment. **A private URL alone is not authentication.** All tool calls must pass the configured token. Never use the same token in code examples, public screenshots, PRs, or bug reports.

`Dockerfile` uses a pinned Microsoft Playwright image matching the pinned npm Playwright version. `PORT` is read from Railway automatically.

### Add repository and build tools

1. Give the server a fine-grained `GITHUB_TOKEN`, limited to the specific repositories you approve. Permissions: repository metadata read, contents read, and Actions write/read. If you later enable `github_update_file`, Contents write is also required.
2. Set `GITHUB_REPOS=owner/repo,owner/another-repo` (exact, comma separated), `GITHUB_BRANCH=main` (or `dev` for Igor) and `GITHUB_WORKFLOW=handspan-verify.yml`.
3. Copy [`examples/verify-workflow/handspan-verify.yml`](examples/verify-workflow/handspan-verify.yml) into **each authorized repository**, at `.github/workflows/handspan-verify.yml`, and commit it to the configured branch.
4. Call `github_run_build` with an approved repo. It dispatches that **fixed workflow**, not arbitrary commands. Call `github_build_runs` and then `github_build_jobs` to inspect the result.
5. Keep `ENABLE_GITHUB_WRITES=false` until you intentionally enable source editing. Existing files require their SHA from `github_read_file`; protected paths are never writable through this tool.

For a private repo, no cloning or uploading a ZIP to Handspan is necessary: the server talks to GitHub's API under a restricted token. The GitHub Actions runner checks out the repo, runs configured CI, and reports results. If the build needs application-specific environment values, configure them in that repository's GitHub Actions secrets or test environment—not in Handspan.

**Note:** The example workflow performs Node/npm installs, typechecking, tests and builds, but does not automatically spin up the built site and capture screenshots. Browser inspection works on a deployed approved HTTPS URL; preview environments and screenshot artifacts from CI can be added as follow-up tools.

## Integrating with an AI client

Handspan uses MCP Streamable HTTP at `https://<your-host>/mcp`, with bearer-token authentication. Compatible MCP clients with remote HTTP and custom header support can connect directly.

**ChatGPT limitation:** Simply hosting this server does not connect it to this chat. ChatGPT's custom MCP plugin connection support depends on the user's plan, client and workspace settings. OpenAI's plugin authentication guidance uses OAuth 2.1 for authenticated MCP integrations; **this release implements a static Bearer token, not OAuth**, so do not expect a direct ChatGPT plugin connection to work without a supported auth adapter and suitable account access. See [OpenAI plugin authentication](https://developers.openai.com/plugins/build/auth) and [connection support](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt). A compatible third-party client can test the core server without that integration.

## Security model

- **Authenticated:** `/mcp` requires a long, constant-time-checked bearer token.
- **Allowlisted:** Only exact approved HTTPS hostnames, explicit static-resource domains, and approved GitHub repositories/branches can be accessed.
- **Reduced browser exposure:** No arbitrary file URLs, custom ports, IP-literal targets, service workers, or unrestricted browser sessions. Browser interactions are disabled until explicitly enabled.
- **Build isolation:** Project code runs only via approved GitHub Actions workflows, never through an arbitrary command-execution MCP tool.
- **Controlled writes:** GitHub source writes are opt-in, path-restricted, existing-file-only, and require the original blob SHA to guard against overwriting concurrent edits.
- **Ephemeral sessions:** Browser sessions expire after 10 minutes idle or on service restart.

**Not a hardened hostile-web sandbox:** Browser request interception is not a complete firewall; websites can try DNS-based attacks or browser protocols outside ordinary navigation. Keep target domains limited to sites you operate, restrict outbound networking where possible, and do not put high-value credentials in the browser container. This is a personal developer tool, not a multi-tenant hostile-code execution service. See [SECURITY.md](SECURITY.md).

## Self-hosting and open source

Licensed under MIT. Fork, audit, modify and deploy on your own server. No vendor account or hard-coded origin is required in Handspan itself. You supply your own infrastructure and credentials. Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Verification checklist

- [x] JavaScript syntax validation and 11 policy tests pass locally
- [ ] `npm install` and MCP HTTP protocol startup succeeds in a networked environment
- [ ] Two screenshots are received from real Chromium and visually inspected
- [ ] GitHub Actions dispatch and job retrieval verified with an approved test repository/token
- [ ] Remote Railway deployment receives the same real results
- [ ] OAuth-compatible ChatGPT connection, if your client/account supports it

The unchecked boxes are **not** claimed as complete.
