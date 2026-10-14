import test from 'node:test';
import assert from 'node:assert/strict';
import { deepHealth } from '../src/health.ts';
const request = token => new Request('https://worker.test/health/deep', { headers: token ? { Authorization: 'Bearer ' + token } : {} });
const env = { MCP_API_KEY: 'secret', OAUTH_KV: {}, OAUTH_GITHUB_CLIENT_ID: 'id', OAUTH_GITHUB_CLIENT_SECRET: 'value', OAUTH_ALLOWED_GITHUB_LOGIN: 'owner' };
const root = async () => ({ path: 'authority/ROOT_FULL_CURRENT.md', content: 'test fixture' });
test('deep probe denies unauthenticated requests', async () => {
  assert.equal((await deepHealth(request(), env, root, ['get_root'])).status, 401);
  assert.equal((await deepHealth(request('wrong'), env, root, ['get_root'])).status, 401);
});
test('deep probe checks real root reader and does not disclose content', async () => {
  const response = await deepHealth(request('secret'), env, root, ['get_root']);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.equal(body.includes('test fixture'), false);
  assert.equal(JSON.parse(body).checks.oauth_flow.status, 'NOT_TESTED');
});
test('missing root fails closed', async () => {
  const response = await deepHealth(request('secret'), env, async () => { throw Error('token leak'); }, ['get_root']);
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes('token leak'), false);
});
test('missing tool or OAuth config returns degraded readiness', async () => {
  assert.equal((await deepHealth(request('secret'), env, root, [])).status, 503);
  assert.equal((await deepHealth(request('secret'), { ...env, OAUTH_GITHUB_CLIENT_SECRET: '' }, root, ['get_root'])).status, 503);
});
