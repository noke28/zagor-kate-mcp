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

## MCP client connection (v0.1.1)

The standards-based endpoint is **`POST /mcp`**, using MCP Streamable HTTP
(JSON-RPC initialization, `tools/list`, and `tools/call`). The older REST
routes remain for diagnostics. They are not the URL to add in an MCP client.

Production URL: `https://zagor-kate-mcp.kenan-begicsa.workers.dev/mcp`

Configure an MCP-capable client:

- Server name: `KATE / ZAGOR`
- Transport: `Streamable HTTP`
- URL: the production URL above
- Header: `Authorization: Bearer <your MCP_API_KEY>`

This server supplies tools and project sources. It is not an AI model API.
A screen asking for **Model ID** and an OpenAI-compatible **Endpoint URL**
is for configuring the model provider; do not put Cloudflare or MCP keys there.
The client needs a separate MCP server configuration. Client support for custom
Bearer headers must be checked; OAuth-only clients need an additional auth adapter.

## Minimal Cloudflare setup

Cloudflare dashboard → Workers & Pages → `zagor-kate-mcp` → Settings →
Variables and Secrets → Add:

| Name | Type | Value |
| --- | --- | --- |
| `MCP_API_KEY` | Secret | A unique random password; use the same value in the MCP client |
| `GITHUB_TOKEN` | Secret | Fine-grained GitHub token limited to `noke28/zagor-duh-zime`, Contents: Read-only |

Save/deploy the settings. `/health` alone confirms the Worker is running; it
does not verify source permissions. Check `initialize`, then `tools/list`,
then call `get_root` to confirm source access.

Docmost is optional: only its tool needs `DOCMOST_URL` and `DOCMOST_API_KEY`.
PMC writes are disabled by default. Enabling them requires
`ENABLE_PMC_WRITES=true` and GitHub Issues write permission; no canon write
endpoint exists.

Cloudflare's connected app can deploy directly. GitHub Actions is an optional
alternative requiring repository secrets `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`; these credentials never go into the MCP client.
