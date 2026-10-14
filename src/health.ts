import type { Env } from './index.ts';

const EXPECTED_ROOT = 'authority/ROOT_FULL_CURRENT.md';
const status = (value: 'PASS' | 'FAIL' | 'NOT_TESTED', code?: string) => ({ status: value, ...(code ? { code } : {}) });

export async function deepHealth(request: Request, env: Env, rootReader: () => Promise<{ path: string; content: string }>, toolNames: readonly string[]): Promise<Response> {
  const provided = request.headers.get('Authorization') || '';
  const expected = 'Bearer ' + (env.MCP_API_KEY || '');
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] || 0) ^ (b[i] || 0);
  const headers = { 'Cache-Control': 'no-store' };
  if (!env.MCP_API_KEY || diff !== 0) return Response.json({ error: 'Unauthorized' }, { status: 401, headers });

  const checks = {
    oauth_config: status(env.OAUTH_KV && env.OAUTH_GITHUB_CLIENT_ID && env.OAUTH_GITHUB_CLIENT_SECRET && env.OAUTH_ALLOWED_GITHUB_LOGIN ? 'PASS' : 'FAIL', 'CONFIG_ONLY'),
    oauth_flow: status('NOT_TESTED'),
    get_root_registered: status(toolNames.includes('get_root') ? 'PASS' : 'FAIL'),
    root_read: status('NOT_TESTED'),
  };
  if (checks.get_root_registered.status === 'PASS') {
    try {
      const result = await Promise.race([
        rootReader(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
      ]);
      checks.root_read = result.path === EXPECTED_ROOT && result.content.trim() ? status('PASS') : status('FAIL', 'ROOT_INVALID');
    } catch {
      checks.root_read = status('FAIL', 'ROOT_UNAVAILABLE');
    }
  }
  const ok = checks.oauth_config.status === 'PASS' && checks.get_root_registered.status === 'PASS' && checks.root_read.status === 'PASS';
  return Response.json({ service: 'zagor-kate-mcp', ready: ok, checks }, { status: ok ? 200 : 503, headers });
}
