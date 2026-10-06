import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
const env = { MCP_API_KEY: 'test-secret', GITHUB_REPO: 'noke28/zagor-duh-zime', GITHUB_TOKEN: 'test' };
const rpc = async (method, params = {}, id = 1) => worker.fetch(new Request('https://worker.test/mcp', {
  method: 'POST', headers: { Authorization: 'Bearer test-secret', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
}), env);
test('health works; missing and wrong auth are rejected', async () => {
  assert.equal((await worker.fetch(new Request('https://worker.test/health'), env)).status, 200);
  assert.equal((await worker.fetch(new Request('https://worker.test/mcp'), env)).status, 401);
  assert.equal((await worker.fetch(new Request('https://worker.test/mcp', { headers: { Authorization: 'Bearer wrong' } }), env)).status, 401);
});
test('MCP initialize and list tools; writes disabled by default', async () => {
  const r = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).result.serverInfo.name, 'zagor-kate-mcp');
  const list = await (await rpc('tools/list')).json();
  assert.equal(list.result.tools.length, 7);
  assert.ok(list.result.tools.some(t => t.name === 'get_root'));
  const denied = await (await rpc('tools/call', { name: 'write_pmc', arguments: { scope: 'system', decision: 'x', rationale: 'x' } })).json();
  assert.equal(denied.result.isError, true);
});
test('source read returns MCP content and uses canonical GitHub path', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(url, 'https://api.github.com/repos/noke28/zagor-duh-zime/contents/authority/ROOT_FULL_CURRENT.md?ref=main');
    return Response.json({ content: Buffer.from('ROOT čita se').toString('base64') });
  };
  try {
    const body = await (await rpc('tools/call', { name: 'get_root', arguments: {} })).json();
    assert.equal(JSON.parse(body.result.content[0].text).content, 'ROOT čita se');
  } finally { globalThis.fetch = original; }
});
test('cross-origin requests rejected and invalid procedure cannot traverse paths', async () => {
  assert.equal((await worker.fetch(new Request('https://worker.test/mcp', { headers: { Authorization: 'Bearer test-secret', Origin: 'https://evil.test' } }), env)).status, 403);
  const body = await (await rpc('tools/call', { name: 'get_kate_procedure', arguments: { name: '../root' } })).json();
  assert.equal(body.result.isError, true);
});
