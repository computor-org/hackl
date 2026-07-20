# Security

## Reporting a vulnerability

Report privately through GitHub Security Advisories on this repository
("Report a vulnerability" under the Security tab). Do not open a public issue for
a sensitive report. Include reproduction steps and affected versions.

Fixes land in the latest release; older releases are not patched.

## Operating Hackl safely

- **The GUI server is loopback-only.** `hackl serve` binds `127.0.0.1`, mints a
  per-launch random token, and rejects requests whose `Host` or `Origin` is not
  loopback (defense against DNS-rebinding and cross-site access). Treat the
  printed URL as a credential: it carries the token. Do not paste it into chats,
  issues, or logs.
- **Yolo mode runs any command with no approval.** It is off by default and
  requires `--allow-yolo` on the server or the explicit Yolo mode in the GUI.
  Every yolo command is written to the server's audit output. Use it only in a
  disposable workspace; prefer agent mode, where each command is approval-gated.
- **API keys stay server-side.** A configured `apiKey` (e.g. OpenRouter) is sent
  only to the model endpoint, never to a browser client, and is stripped from
  the environment handed to MCP child processes. Keep keys in `HACKL_API_KEY` or
  `~/.config/hackl/config.json`, not in a repo-local file.
- **No telemetry.** The only outbound traffic is the configured model endpoint,
  read-only local-server probes, the MCP servers you configure, and (only when you
  run `hackl up`) the pinned llama.cpp release and the model you choose.
- **Managed engine.** `hackl up` binds llama.cpp to `127.0.0.1`; `--allow-remote`
  opts into `0.0.0.0` with a warning. The llama.cpp binary is a pinned,
  sha256-verified download (verified against an in-repo table; never fetched at
  `npm install`). Model weights are pulled from Hugging Face and carry their own
  licenses, surfaced on first download. An already-running server is adopted
  read-only: hackl only stops or restarts an instance it started itself.
  llama.cpp's own web UI is served unauthenticated on the loopback port; do not
  expose it via `0.0.0.0`.

## Supply chain

- Install with **npm 11 or newer**. npm 11 honors the `allowScripts` allowlist in
  `package.json` and blocks dependency install scripts that are not on it; the
  bundled npm 10 ignores it. CI pins npm 11.
- Installs use a committed lockfile (`npm ci`); CI fails on a high-severity
  advisory in production dependencies and pins GitHub Actions to commit SHAs.
