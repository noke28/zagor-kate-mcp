import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
// Only stub the Workers base class in Node; the OAuth implementation is real.
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export class WorkerEntrypoint {}', shortCircuit: true };
  return next(specifier, context);
}});
const { oauthWorker, ISSUER, s256, consentPage } = await import('../src/oauth.ts');
class MemoryKV {
  data = new Map();
  async get(key, type) { const value = this.data.get(key) ?? null; return value && (type === 'json' || type?.type === 'json') ? JSON.parse(value) : value; }
  async put(key, value) { this.data.set(key, value); }
  async delete(key) { this.data.delete(key); }
  async list({ prefix = '' } = {}) { return { keys: [...this.data.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
}
const setup = () => ({ OAUTH_KV: new MemoryKV(), OAUTH_GITHUB_CLIENT_ID: 'test-client', OAUTH_GITHUB_CLIENT_SECRET: 'test-secret', OAUTH_ALLOWED_GITHUB_LOGIN: 'noke28', GITHUB_REPO: 'noke28/zagor-duh-zime', GITHUB_TOKEN: 'source-token', ENABLE_PMC_WRITES: 'true' });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const call = (env, path, init) => oauthWorker.fetch(new Request(`${ISSUER}${path}`, init), env, ctx);
const cookie = response => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
async function register(env) {
  const response = await call(env, '/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Test client', redirect_uris: ['https://client.test/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) });
  assert.equal(response.status, 201);
  return response.json();
}
async function begin(env, client) {
  const verifier = 'a'.repeat(64);
  const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: 'https://client.test/callback', response_type: 'code', scope: 'mcp:read offline_access', state: 'client-state', resource: `${ISSUER}/mcp`, code_challenge: await s256(verifier), code_challenge_method: 'S256' });
  const response = await call(env, `/authorize?${params}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  const handle = html.match(/name="handle" value="([^"]+)"/)[1];
  return { handle, cookies: cookie(response), verifier, params };
}
async function approve(env, started) {
  return call(env, '/authorize', { method: 'POST', headers: { Origin: ISSUER, Cookie: started.cookies }, body: new URLSearchParams({ handle: started.handle, decision: 'approve' }) });
}
async function complete(env, client, started, login = 'noke28') {
  const approved = await approve(env, started);
  assert.equal(approved.status, 302);
  const target = new URL(approved.headers.get('Location'));
  assert.equal(target.origin, 'https://github.com');
  assert.equal(target.searchParams.get('scope'), null); // Identity only, no repository grant.
  assert.equal(target.searchParams.get('code_challenge_method'), 'S256');
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (url === 'https://github.com/login/oauth/access_token') {
      assert.equal(await s256(init.body.get('code_verifier')), target.searchParams.get('code_challenge'));
      return Response.json({ access_token: 'upstream-test-token' });
    }
    assert.equal(url, 'https://api.github.com/user');
    return Response.json({ id: 123, login });
  };
  try {
    const callback = await call(env, `/callback?state=${encodeURIComponent(target.searchParams.get('state'))}&code=github-code`, { headers: { Cookie: cookie(approved) } });
    assert.equal(callback.status, 302);
    return new URL(callback.headers.get('Location'));
  } finally { globalThis.fetch = original; }
}
const exchange = (env, client, started, code, verifier = started.verifier) => call(env, '/oauth/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: 'https://client.test/callback', code, code_verifier: verifier, resource: `${ISSUER}/mcp` }) });

test('discovery challenges unauthenticated MCP access and setup fails closed', async () => {
  const env = setup();
  const challenge = await call(env, '/mcp');
  assert.equal(challenge.status, 401);
  assert.match(challenge.headers.get('WWW-Authenticate'), /resource_metadata/);
  const metadata = await (await call(env, '/.well-known/oauth-protected-resource/mcp')).json();
  assert.equal(metadata.resource, `${ISSUER}/mcp`);
  assert.deepEqual(metadata.scopes_supported, ['mcp:read']);
  const authorization = await (await call(env, '/.well-known/oauth-authorization-server')).json();
  assert.ok(authorization.code_challenge_methods_supported.includes('S256'));
  delete env.OAUTH_GITHUB_CLIENT_SECRET;
  assert.equal((await call(env, '/authorize')).status, 503);
});
test('consent escapes client data; forged forms, unbound callbacks and non-PKCE requests fail', async () => {
  assert.ok(!consentPage({ clientName: '<script>', scope: ['mcp:read'], redirectHost: 'client.test', redirectIsLoopback: false }, 'handle').includes('<script>'));
  const env = setup(); const client = await register(env); const started = await begin(env, client);
  assert.equal((await call(env, '/authorize', { method: 'POST', headers: { Origin: 'https://evil.test' }, body: new URLSearchParams({ handle: started.handle, decision: 'approve' }) })).status, 403);
  assert.equal((await call(env, '/authorize', { method: 'POST', headers: { Origin: ISSUER }, body: new URLSearchParams({ handle: started.handle, decision: 'approve' }) })).status, 400);
  assert.equal((await call(env, '/callback?state=forged&code=forged')).status, 400);
  started.params.delete('code_challenge'); started.params.delete('code_challenge_method');
  assert.notEqual((await call(env, `/authorize?${started.params}`)).status, 200);
});
test('Deny returns access_denied and wrong GitHub identity receives no code', async () => {
  const env = setup(); const client = await register(env); const started = await begin(env, client);
  const denied = await call(env, '/authorize', { method: 'POST', headers: { Origin: ISSUER, Cookie: started.cookies }, body: new URLSearchParams({ handle: started.handle, decision: 'deny' }) });
  assert.equal(new URL(denied.headers.get('Location')).searchParams.get('error'), 'access_denied');
  const result = await complete(env, client, await begin(env, client), 'someone-else');
  assert.equal(result.searchParams.get('error'), 'access_denied');
  assert.equal(result.searchParams.get('code'), null);
});
test('full OAuth exchange and refresh allow reads but never PMC writes or code replay', async () => {
  const env = setup(); const client = await register(env); const started = await begin(env, client);
  const result = await complete(env, client, started);
  assert.equal(result.searchParams.get('state'), 'client-state');
  const code = result.searchParams.get('code'); assert.ok(code);
  const response = await exchange(env, client, started, code); assert.equal(response.status, 200);
  const tokens = await response.json(); assert.ok(tokens.access_token); assert.ok(tokens.refresh_token);
  const rpc = async (method, params = {}) => call(env, '/mcp', { method: 'POST', headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const listed = await (await rpc('tools/list')).json();
  assert.ok(listed.result.tools.some(t => t.name === 'get_root'));
  assert.ok(!listed.result.tools.some(t => t.name === 'write_pmc'));
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(url, 'https://api.github.com/repos/noke28/zagor-duh-zime/contents/authority/ROOT_FULL_CURRENT.md?ref=main');
    return Response.json({ content: Buffer.from('Verified source čitanje').toString('base64') });
  };
  try {
    const read = await (await rpc('tools/call', { name: 'get_root' })).json();
    assert.equal(JSON.parse(read.result.content[0].text).content, 'Verified source čitanje');
  } finally { globalThis.fetch = original; }

  const write = await (await rpc('tools/call', { name: 'write_pmc', arguments: { scope: 'system', decision: 'x', rationale: 'x' } })).json();
  assert.equal(write.result.isError, true);
  assert.equal((await call(env, '/mcp/tools/call', { method: 'POST', headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'write_pmc' }) })).status, 403);
  const refreshed = await call(env, '/oauth/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token, resource: `${ISSUER}/mcp` }) });
  assert.equal(refreshed.status, 200);
  const refreshedTokens = await refreshed.json();
  const invalidResource = await call(env, '/oauth/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', client_id: client.client_id, refresh_token: refreshedTokens.refresh_token, resource: 'https://other.test/mcp' }) });
  assert.notEqual(invalidResource.status, 200);
  assert.notEqual((await exchange(env, client, started, code)).status, 200);
});
test('wrong PKCE verifier cannot exchange authorization code', async () => {
  const env = setup(); const client = await register(env); const started = await begin(env, client);
  const result = await complete(env, client, started);
  assert.notEqual((await exchange(env, client, started, result.searchParams.get('code'), 'b'.repeat(64))).status, 200);
});
