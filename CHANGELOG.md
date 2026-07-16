# Changelog

All notable changes to `@framedash/mcp-server` are documented here. This project
follows [Keep a Changelog](https://keepachangelog.com/) and
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.3] - 2026-07-17

### Added

- npm `keywords` and an `mcpName` field, a `server.json` MCP Registry manifest,
  and a gated registry-publish step in the mirror release workflow, so the
  server is discoverable and installable from the MCP Registry.

### Changed

- Sharper package description (game telemetry: analytics, heatmaps, perf
  regressions, retention, alerts from AI agents).
- The missing-`FRAMEDASH_API_KEY` error now names the env var, the project API
  Keys page (https://app.framedash.dev), and the docs URL so an AI agent can
  self-serve setup.

## [0.1.2] - 2026-07-05

### Added

- `get_funnel` gains a `window` input (conversion window in seconds: 3600,
  21600, 86400, or 604800; default 86400), matching the funnels REST endpoint
  and the CLI's existing option.
- New `./server` and `./package.json` export subpaths so a host application can
  embed the server without the stdio bin: `createServer(apiClient, version)`
  builds the MCP server around an `@framedash/api-client` instance. As part of
  this, `createServer` now takes the handshake `version` explicitly (the
  `package.json` filesystem read moved into the stdio bin, making the module
  bundler-safe); stdio behavior is unchanged.

### Changed

- Raise the minimum supported Node.js runtime to `>=20.0.0` (was `>=18.0.0`) so
  Node's default Happy Eyeballs / `autoSelectFamily` concurrent IPv4 fallback is
  a guaranteed contract. On a broken-IPv6 network (a global AAAA advertised with
  no working route) an older runtime without that default would wedge every
  connect on the unreachable address; requiring Node 20+ makes the fast IPv4
  fallback part of the supported-runtime contract.
- Large tool responses are now truncated without serializing the full result
  array first, reducing per-call CPU and memory on big result sets; truncation
  semantics (what the client receives) are unchanged.
- Dependency majors: `zod` `^3.25` -> `^4.3` and `@modelcontextprotocol/sdk`
  `^1.27` -> `^1.29`.

### Fixed

- The version advertised in the MCP handshake is now sourced from
  `package.json` instead of a hardcoded string that had drifted from the
  published version.

## [0.1.1] - 2026-06-07

Published from the public mirror via npm Trusted Publishing (OIDC) with a
provenance attestation; the published manifest now carries repository metadata.
No API changes.

## [0.1.0] - 2026-06-06

Initial public pre-release (beta).

- MCP server exposing read-only Framedash analytics tools to LLM clients over the
  stdio transport.
- Installable via `npx @framedash/mcp-server`.
