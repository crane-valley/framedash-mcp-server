# @framedash/mcp-server

MCP (Model Context Protocol) server for the Framedash game telemetry platform. The published 0.2.0 package provides 12 read-only tools and 4 resources for querying analytics data from LLM-powered tools.

## Setup

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "framedash": {
      "command": "npx",
      "args": ["@framedash/mcp-server"],
      "env": {
        "FRAMEDASH_API_KEY": "fd_xxx",
        "FRAMEDASH_PROJECT_ID": "your-project-uuid"
      }
    }
  }
}
```

### VS Code (Claude Extension)

Add to your VS Code settings:

```json
{
  "claude.mcpServers": {
    "framedash": {
      "command": "npx",
      "args": ["@framedash/mcp-server"],
      "env": {
        "FRAMEDASH_API_KEY": "fd_xxx",
        "FRAMEDASH_PROJECT_ID": "your-project-uuid"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FRAMEDASH_API_KEY` | Yes | API key with `analytics:read` for the aggregate tools; the raw `query` tool additionally requires `data:admin` |
| `FRAMEDASH_PROJECT_ID` | No | Default project UUID for project-scoped tools |
| `FRAMEDASH_BASE_URL` | No | API base URL (default: `https://app.framedash.dev`) |

If `FRAMEDASH_PROJECT_ID` is omitted, project-scoped tools still work but
require an explicit `project_id` argument per call.

## Tools

| Tool | Description |
|------|-------------|
| `query` | Execute SQL analytics query (SELECT only, limit default 100) |
| `get_dashboard` | Project KPI summary (DAU, MAU, sessions, events) |
| `get_retention` | Cohort retention data |
| `get_funnel` | Funnel analysis for event steps |
| `get_insights` | Event insights with grouping |
| `get_heatmap` | Heatmap grid data for a map |
| `list_projects` | Show the project bound to the API key |
| `get_project_status` | Project health overview |
| `list_maps` | List maps in a project |
| `list_content` | List content registry entries |
| `list_alerts` | List alert rules |
| `get_alert_history` | Alert trigger history |

### Unreleased source additions

These additions require building this source revision; they are not in the published 0.2.0 npm package. This revision registers 14 tools on stdio and 13 on the hosted OAuth endpoint, where `query` is omitted because OAuth cannot grant `data:admin`.

| Tool | Scope | Input / output |
|------|-------|----------------|
| `list_builds` | `analytics:read` | Optional `project_id`, `days` (7/14/30/90; default 30), exact `build_id`, `fresh` (default false). Returns the existing builds payload; an exact build avoids the newest-50 list cap. |
| `compare_builds` | `analytics:read` | Required distinct `baseline`/`candidate` build IDs; optional `project_id`, `days` (7/14/30/90; default 30), `map_id`, `platform`, `fresh` (default false). Returns the existing P50/P95 comparison payload and sample/session counts; does not apply a CI threshold. |
| `get_heatmap` context | `analytics:read` | Legacy text remains unchanged. `structuredContent.cells` contains the same complete cells as the legacy JSON prefix; `total`, `returned`, and `truncated` describe response truncation. `context` records filters, world-coordinate units, metric units, and unknown axis/null causes; use `list_maps.upAxis` to determine X/Z versus X/Y. |

Heatmap response truncation is a presentation limit, not ingestion readiness or missing telemetry. Legacy text retains its existing 51,200 UTF-16-unit limit and, on overflow, at most 50 complete cells. Structured cells are recovered from that bounded JSON prefix without serializing the full source array again. If one cell exceeds the text limit and only a partial cell is displayed, structured cells are empty and `returned: 0, truncated: true` makes that omission explicit. `total` is the source cell count.

Metadata filter strings (`project_id`, `map_id`, `event_name`) are limited to 256 UTF-16 units. Names in `context.truncated_fields` identify prefix values; the actual API request uses the full filter. Metadata truncation is separate from cell truncation. Including both text and structured representations, the JSON-encoded tool result stays within `6 * 51,200 + 8,192 = 315,392` bytes: each bounded representation needs at most three UTF-8 bytes per UTF-16 unit, and 8 KiB covers the fixed context, capped filter values and result fields. JSON-RPC envelope IDs are client-controlled and outside this tool-result budget.

`compare_builds.isRegression` reports direction, not a threshold breach or statistical certainty. Sample/session counts do not verify expected samples or completed ingestion. Map/platform filters change the population; `load_time_ms` is unavailable with a map filter. Null metric causes remain unknown. The existing CLI `framedash perf-diff --threshold <pct> --fail-on-regression` provides an opt-in CI gate without requiring raw SQL access.

## Resources

| URI | Description |
|-----|-------------|
| `framedash://projects` | Project bound to the API key |
| `framedash://projects/{projectId}/maps` | Map list with bounds |
| `framedash://projects/{projectId}/content` | Content registry |
| `framedash://projects/{projectId}/status` | Project health status |

## Hosted HTTP compatibility

The stateless hosted HTTP endpoint `/api/mcp` rejects request batches containing more than 100 messages with HTTP 400 and JSON-RPC error code -32600. This limit applies per POST request and is separate from the existing 1 MiB request-body limit. The independent stdio transport remains unaffected.

To accommodate this bound, update clients to split message batches into groups of at most 100 messages, or transmit messages as individual POST requests.

## Development

Run from the repository root:

```bash
pnpm install
pnpm --filter @framedash/mcp-server... build
pnpm --filter @framedash/mcp-server test
```

With pnpm 9, the trailing `...` selects the MCP package plus its workspace
dependencies, including `@framedash/api-client`, before compiling from a clean
checkout.

## License

MIT
