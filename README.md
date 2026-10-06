# zagor-kate-mcp

ZAGOR KATE MCP server — canon access layer for Phase 3A bridge.

## Purpose

Remote MCP source-access layer for the ZAGOR KATE worker.

It exposes read-oriented tools for:

- USTAV
- CURRENT FULL ROOT
- ROOT-LITE
- SOURCE provenance
- KATE procedures
- Docmost page reads
- source search

It also exposes a constrained system-level PMC write tool.

## Authority boundary

This service does **not** write to:

- USTAV
- ROOT
- ROOT-LITE
- SOURCE

Authority remains in the main repository:

`noke28/zagor-duh-zime`

Current source mapping:

- `authority/USTAV_FULL.md`
- `authority/ROOT_FULL_CURRENT.md`
- `authority/ROOT-LITE_CURRENT.md`
- `authority/SOURCE_CURRENT.md`
- `authority/AUTHORITY.md`

## Local development

```bash
npm install
npm run dev
```

## Type check

```bash
npm run typecheck
```

## Cloudflare deploy

Configure secrets first:

```bash
wrangler secret put MCP_API_KEY
wrangler secret put GITHUB_TOKEN
wrangler secret put DOCMOST_URL
wrangler secret put DOCMOST_API_KEY
```

Then:

```bash
npm run deploy
```

## HTTP surface

- `GET /health`
- `GET /mcp/tools/list`
- `POST /mcp/tools/call`

All MCP endpoints require:

`Authorization: Bearer <MCP_API_KEY>`

`/health` remains unauthenticated for deployment health checks.
