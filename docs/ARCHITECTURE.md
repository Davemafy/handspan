# Handspan architecture

An MCP-compatible host talks to `/mcp` using Streamable HTTP with a bearer token.

```
AI client (reasoning and planning)
            |
            | HTTPS MCP (tools/list, tools/call)
            v
Handspan server (auth, allowlists, tool definitions)
       |                           |
       v                           v
Playwright Chromium          GitHub REST API
- approved HTTPS sites       - fixed repository/branch
- screenshots as PNG          - text file reads
- DOM / errors                - guarded source file updates
- bounded sessions           - workflow dispatch / job status
                                   |
                                   v
                            GitHub Actions runner
                            - npm ci / tests / build
```

The server contains **no model or automation loop**. The AI client decides which MCP tool to use. Handspan never initiates a background conversation or bypasses AI-client quotas.

For anonymous public open-source distribution, no deployment URL or credentials are committed. Each self-hoster supplies theirs separately.

## Deliberate exclusions from v0.2

- Arbitrary host shell or Docker commands: too broad an attack surface.
- Arbitrary ZIP execution: avoid uncontrolled npm scripts on the MCP container.
- OAuth/OIDC: required for some ChatGPT integrations; attach a trusted auth provider when applicable.
- Multi-tenant session store: would require persistent storage, scoped auth, audit logs and a worker queue.
- Developer-machine remote control: this server operates its **own** Railway/container browser, not your laptop.

## Extending safely

Implement a new MCP tool in `src/server.js`, with logic isolated in `src/` and explicit input validation. Do not send backend keys or arbitrary scripts to the browser. Reuse `safe` for structured errors. Add tests and capability docs.
