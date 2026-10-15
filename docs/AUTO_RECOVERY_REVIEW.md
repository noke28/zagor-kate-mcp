# KATE MCP — Controlled Auto-Recovery (review only)
Status: PROPOSAL / NOT DEPLOYED. Scope: infrastructure only. No canon edits.

## Verified baseline (main, 2026-10-14)
- `src/index.ts` already exposes GET /health (liveness only) and routes /mcp to either legacy bearer or OAuthProvider.
- `TOOLS` includes get_root; `callTool(env,"get_root",{})` reads `authority/ROOT_FULL_CURRENT.md` from `GITHUB_REPO`, branch main, through GitHub API.
- `src/oauth.ts` uses `OAUTH_KV`, `OAUTH_GITHUB_CLIENT_ID`, `OAUTH_GITHUB_CLIENT_SECRET`, `OAUTH_ALLOWED_GITHUB_LOGIN`, PKCE and mcp:read. OAuth read-only sessions must stay read-only.
- `wrangler.toml`: `ENABLE_PMC_WRITES=false`. No authority/source files may be changed.

## Proposed probe contract
1. GET /health: unauthenticated liveness only; 200 when handler runs. No claims about OAuth, tools or ROOT.
2. GET /health/deep: protected by existing MCP_API_KEY using constant-time credential comparison where available; no diagnostic detail on unauthorized response; Cache-Control no-store. Never expose tokens, source content, GitHub response bodies, login identifiers or file contents.
3. Deep checks: binding presence (OAuth config only, not proof of login), registered get_root in TOOLS, actual `callTool(env,"get_root",{})` with bounded timeout; exact expected path and nonempty content. Return structured PASS/FAIL/NOT_TESTED. OAuth end-to-end stays NOT_TESTED unless an authenticated synthetic flow actually runs.
4. Failure categories: CONFIG_MISSING, TOOL_MISSING, ROOT_UNAVAILABLE, ROOT_INVALID, UPSTREAM_TIMEOUT, OAUTH_CONFIG_MISSING, INTERNAL_ERROR. No false 'HEALTHY' when required checks fail. HTTP 503 for degraded dependencies; 401 for unauthorized. The health route must not shadow OAuth routes.
5. Root validation is **access and path validation**, not canon semantic alignment. No ROOT fallback, edits, sync or automatic promotion.

## Remediation controller — GitHub Actions, independent of Worker
- Scheduled or manual monitoring checks public /health and authenticated /health/deep with GitHub Actions secret; never include secret in logs.
- Require >=3 consecutive failures separated by at least 2 minutes; distinguish timeout, 401, 403, 404, 429 and 5xx; only 5xx/timeouts are retry candidates.
- For ROOT/GitHub 429, 5xx or network timeout: exponential retry with jitter, max 3 attempts, honor Retry-After, never write content. For OAuth config or 401/403: alert only, no secret rotation or bypass.
- On persistent failures, create/update one GitHub issue per incident fingerprint; apply a 60-minute cooldown and concurrency group to prevent loops. Do not deploy in response to a failure until a tested recovery mechanism is separately enabled.
- Optional **fully automatic** production rollback is gated by: known-good immutable version identifier, preexisting validated rollback action, current and candidate SHA attestation, successful prior smoke tests, no active release, one rollback per incident, 15-minute cooldown, and post-rollback independent synthetic OAuth/MCP/ROOT checks. Abort/alert if any gate fails. Never roll back secrets, KV state, OAuth policy or canon. A Worker rollback may not fix dependency outages.
- Never automatically change code, rotate OAuth credentials, weaken authorization, change GitHub token permissions, mutate KV records, change source repository, or merge PRs. Those are separate privileged operations requiring explicit author approval.
- Deployment control: production deployment/rollback remains disabled until approved. This branch must not be merged or deployed automatically.

## Minimum test matrix
- /health 200 even when ROOT unavailable, correctly labeled liveness only.
- /health/deep 401 missing/invalid token; no leaked internals.
- Deep success with mocked GitHub ROOT path/content.
- Deep ROOT 404, empty content, GitHub 429/500, timeout; return FAIL/503 without content leakage.
- Missing OAuth credentials => FAIL config, NOT_TESTED functional OAuth.
- Missing get_root registry => FAIL.
- Existing tests/oauth.test.mjs and tests/mcp.test.mjs must still pass; full OAuth authorization/refresh, read-only write_pmc rejection and MCP tools/list remain intact.
- Controller tests: transient failure recovery, persistent outage alert, incident deduplication, 401/403 no rollback, rollback gate failure, rollback once and post-rollback fail.
- CI: npm ci && npm run typecheck && npm test; no deploy secrets in PR builds.

## Review gates
Gate A: approve probe contract and tests.
Gate B: approve non-mutating controller with alerts.
Gate C: separately authorize production deployment and, if desired, scoped immutable-version rollback.
Only KENO may approve production policy changes; no canon changes permitted.
