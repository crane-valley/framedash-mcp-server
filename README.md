# @framedash/mcp-server

MCP (Model Context Protocol) server for the Framedash game telemetry platform. Provides 12 read-only tools and 4 resources for querying analytics data from LLM-powered tools.

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

## Resources

| URI | Description |
|-----|-------------|
| `framedash://projects` | Project bound to the API key |
| `framedash://projects/{projectId}/maps` | Map list with bounds |
| `framedash://projects/{projectId}/content` | Content registry |
| `framedash://projects/{projectId}/status` | Project health status |

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
