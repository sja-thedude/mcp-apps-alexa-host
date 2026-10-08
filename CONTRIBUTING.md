# Contributing

Thanks for helping make MCP Apps hosts easier to build.

1. Fork, then branch from `dev` (`feature/…`, `fix/…`).
2. Run `nvm use && npm install && npm run dev`.
3. Before opening a pull request, run:
   ```bash
   npm run typecheck && npm test && npm run build
   npm run e2e -- http://localhost:8787
   ```
4. Open the pull request against `dev`, with a short description and a screenshot for UI changes.

Good first contributions:
- A router that calls an LLM.
- Fullscreen and picture-in-picture display modes.
- Rendering `resource_link` content.
- More example servers.
- Accessibility improvements.

Please keep the host server-agnostic: no assumptions about specific tools.
