# Contributing

- Keep Handspan an MCP **tool** server; do not add an LLM-based agent loop or UI.
- Keep all credentials, user-specific domain names and private repository identifiers out of source, tests and examples.
- Add tests for each authorization, path validation, and tool behavior change.
- Never add arbitrary shell execution, open redirects, unrestricted repo writes or file:// browser navigation.
- Run `npm run verify`, then `npm run test:protocol`, then `npm run smoke -- https://<approved-host>` in a networked developer environment before requesting review.
- Documentation must distinguish unit-verified behavior from real browser, CI or remote deployment evidence.

MIT licensed contributions.
