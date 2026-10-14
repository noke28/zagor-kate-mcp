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

Legacy diagnostic clients can use:

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
Bearer headers must be checked; OAuth clients can use the v0.1.2 authorization flow below after activation.

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

## GitHub OAuth connection (v0.1.2)

Status: implementation prepared; production activation requires deployment and
GitHub OAuth application credentials. Do not infer host connection from this README.

The same `/mcp` URL now supports OAuth 2.1 via
`@cloudflare/workers-oauth-provider` (locked in package-lock.json). It provides
resource discovery, authorization-server discovery, dynamic client registration,
S256 PKCE, one-hour access tokens and 30-day refresh tokens. GitHub is used only
to verify identity; the existing source-read `GITHUB_TOKEN` remains separate.
Only `OAUTH_ALLOWED_GITHUB_LOGIN=noke28` may authorize. OAuth sessions always
require `mcp:read` and cannot list or invoke `write_pmc`, even if legacy PMC writes
are enabled later. No canon write route is added.

### Activate

1. Register a GitHub **OAuth App** at https://github.com/settings/applications/new:
   - Application name: `KATE ZAGOR HQ`
   - Homepage URL: `https://zagor-kate-mcp.kenan-begicsa.workers.dev/health`
   - Authorization callback URL: `https://zagor-kate-mcp.kenan-begicsa.workers.dev/callback`
   - Device flow: leave disabled.
2. In Cloudflare Worker Settings → Variables and Secrets, add:
   - `OAUTH_GITHUB_CLIENT_ID`: the OAuth App Client ID.
   - `OAUTH_GITHUB_CLIENT_SECRET`: the generated Client Secret.
   Enter them directly in Cloudflare; never paste the secret in chat, commits or plugin files.
3. Deploy this revision. `wrangler.toml` binds `OAUTH_KV` to the dedicated
   `zagor-kate-oauth` namespace and keeps `ENABLE_PMC_WRITES=false`.
4. Update the existing plugin's `mcp.json` and `.mcp.json` to use the same verified
   URL and transport **without** the `api_key` authentication extension and with
   no static Authorization header. OAuth is discovered from the server's `401`
   challenge. Keep the existing plugin identity and onboarding skill.
5. Verify resource metadata, authorization-server metadata and the `401`
   challenge; then start an actual client connection. Approve the consent screen,
   sign in as `noke28`, initialize MCP, list tools and read `get_root`.
   Successful deployment is separate from successful ChatGPT connection.

Until both GitHub OAuth credentials exist, `/authorize` and `/callback` return
`503` without granting access. Existing Bearer-key clients and `/health` continue
to work. OAuth does not disable authentication to work around host limitations.

### Verification and rollback

`npm run typecheck`, `npm test`, `npx wrangler deploy --dry-run`.
Tests use the real OAuth library and an in-memory KV; GitHub token exchange and
identity responses are mocked. They cover discovery, consent escaping, CSRF,
PKCE, account allowlisting, token exchange/refresh, audience checks, code replay,
and the read-only boundary. The Workers base class is the only runtime stub.
A real browser sign-in and ChatGPT tool invocation remain activation checks.

Rollback: restore the previous Worker version. Keep the legacy MCP secret and
source token. OAuth KV data can remain for investigation; do not delete it as part
of rollback. A later return to OAuth should invalidate old grants as needed.
