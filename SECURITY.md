# Security guidance

Handspan can control a browser and read approved source code. Treat the MCP token like an SSH key.

## Deployment rules

1. Prefer dedicated Railway service and dedicated GitHub fine-grained token.
2. Never expose the MCP service without authentication. `/health` is deliberately information-minimal.
3. Prefer exact hostname allowlists; avoid exposing authenticated administration panels in `TARGET_HOSTS`. Wildcard public-web mode requires external egress isolation and must not be treated as safe merely because private hostname suffixes are blocked.
4. Keep `ENABLE_INTERACTIONS=false` and `ENABLE_GITHUB_WRITES=false` unless required.
5. Keep GitHub workflows on a restricted branch and review workflow edits separately.
6. Rotate tokens after suspected leaks and keep deployment logs private.
7. Use dedicated staging data and accounts for tests. Browser clicks may perform irreversible actions.
8. Never assume request interception is a network sandbox. Add firewall/egress policy and DNS protections before browsing untrusted domains.

## Known limits

- Browser request routing does not comprehensively cover all possible network channels and cannot itself prevent DNS rebinding.
- Browser state lives in memory: a Railway restart loses all sessions.
- The starter uses one static bearer secret. It does not implement OAuth 2.1, per-user permissions, audit logging or token rotation.
- GitHub Actions steps run the repository's scripts in GitHub's runner; protect workflow permissions and secrets accordingly.
- Console and HTTP error messages could contain application data. Do not allowlist sensitive sites without reviewing what is returned.

If you find a vulnerability, do not post private tokens or exploit details in a public issue. Contact the maintainer privately through the repository's security advisory flow once published.
