# Connecting a compatible MCP client

The remote server endpoint is:

`https://YOUR_DEPLOYMENT_HOST/mcp`

It requires:

`Authorization: Bearer YOUR_PRIVATE_MCP_ACCESS_TOKEN`

Clients differ in whether they accept custom headers, environment interpolation, or OAuth-only authentication. Consult the particular client's remote-MCP configuration guidance. Do not paste a live token into publicly shared project configuration. ChatGPT's plugin setup typically requires OAuth 2.1 and eligible access; see the root README.

For an ordinary HTTP client, you can check that `tools/list` works using:

```bash
curl -sS -X POST "https://YOUR_DEPLOYMENT_HOST/mcp" \
  -H "Authorization: Bearer YOUR_PRIVATE_MCP_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
