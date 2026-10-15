import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/hq/app.js', import.meta.url), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
async function browser({ supported = true, params, transaction } = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', value: '', disabled: false, listeners: {}, children: [], addEventListener(name, fn) { this.listeners[name] = fn; }, replaceChildren(...nodes) { this.children = nodes; }, append(node) { this.children.push(node); } });
    return elements.get(id);
  };
  const definitions = []; const requests = []; const stored = new Map();
  if (transaction) stored.set('zagor-hq-pkce', JSON.stringify(transaction));
  const document = { getElementById: element, createElement: () => element(`node-${elements.size}`), modelContext: supported ? { registerTool(tool, options) { definitions.push({ ...tool, signal: options.signal }); } } : undefined };
  const location = { origin: 'https://zagor-kate-mcp.kenan-begicsa.workers.dev', pathname: params ? '/hq/callback' : '/hq', search: params ? `?${params}` : '', assign(url) { this.target = url; } };
  let result = { path: 'authority/ROOT_FULL_CURRENT.md', content: '<script>untrusted</script>' };
  const fetch = async (url, init) => {
    requests.push({ url, init });
    if (url === '/oauth/register') return Response.json({ client_id: 'client-123' }, { status: 201 });
    if (url === '/oauth/token') return Response.json({ access_token: 'test-session', token_type: 'Bearer', expires_in: 3600 });
    if (url === '/health') return Response.json({ ok: true, service: 'zagor-kate-mcp' });
    assert.equal(url, '/mcp');
    const body = JSON.parse(init.body);
    return Response.json({ result: body.method === 'tools/list' ? { tools: [{ name: 'get_root' }, { name: 'search_sources' }] } : { content: [{ type: 'text', text: JSON.stringify(result) }] } });
  };
  const window = { listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; } };
  const storage = { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) };
  await new AsyncFunction('document', 'location', 'sessionStorage', 'history', 'window', 'fetch', source)(document, location, storage, { replaceState() {} }, window, fetch);
  return { element, definitions, requests, location, stored, window, setResult: value => { result = value; } };
}
const tx = () => ({ state: 'bound-state', verifier: 'a'.repeat(43), clientId: 'client-123', created: Date.now() });
const validParams = new URLSearchParams({ code: 'one-use-code', state: 'bound-state', iss: 'https://zagor-kate-mcp.kenan-begicsa.workers.dev' });

test('three read-only WebMCP tools register; unsupported browsers retain buttons', async () => {
  const b = await browser();
  assert.equal(b.definitions.length, 3);
  assert.ok(b.definitions.every(t => t.annotations.readOnlyHint));
  assert.equal((await b.definitions[0].execute({})).authenticatedToolsAvailable, false);
  await assert.rejects(b.definitions[1].execute({}), /bearer ključ/);
  await assert.rejects(b.definitions[0].execute({ extra: true }));
  const fallback = await browser({ supported: false });
  assert.match(fallback.element('webmcp').textContent, /dugmadi/);
});

test('bearer login validates key in memory and authenticates tool listing', async () => {
  const b = await browser();
  b.element('bearer-key').value = 'test-secret';
  await b.element('login').listeners.click();
  assert.equal(b.element('bearer-key').value, '');
  assert.equal(b.element('root').disabled, false);
  assert.equal(b.requests.some(r => r.url === '/mcp' && r.init.headers.Authorization === 'Bearer test-secret'), true);
  assert.equal(b.stored.size, 0);
  assert.equal(b.requests.some(r => r.url === '/oauth/register' || r.url === '/oauth/token'), false);
});

test('missing bearer key rejects login without exposing tools', async () => {
  const b = await browser();
  await b.element('login').listeners.click();
  assert.match(b.element('connection').textContent, /bearer ključ/);
  assert.equal(b.element('root').disabled, true);
  assert.equal(b.requests.some(r => r.url === '/mcp'), false);
});

test('authorized ROOT and searches update visible state; logout clears source content', async () => {
  const b = await browser();
  b.element('bearer-key').value = 'test-secret';
  await b.element('login').listeners.click();
  assert.equal(b.element('root').disabled, false);
  const result = await b.definitions[1].execute({});
  assert.equal(b.element('root-content').textContent, result.content);
  await assert.rejects(b.definitions[2].execute({ query: 'x', extra: 'x' }));
  b.setResult({ matches: [{ path: 'authority/SOURCE_CURRENT.md', url: 'https://github.com/noke28/zagor-duh-zime/blob/main/authority/SOURCE_CURRENT.md' }] });
  await b.definitions[2].execute({ query: 'Zagor' });
  assert.equal(b.element('matches').children.length, 1);
  b.setResult({ matches: [{ path: 'authority/x', url: 'https://evil.test/x' }] });
  await assert.rejects(b.definitions[2].execute({ query: 'Zagor' }), /Porijeklo/);
  b.element('logout').listeners.click();
  assert.equal(b.element('root-content').textContent, '');
  await assert.rejects(b.definitions[1].execute({}), /bearer ključ/);
  b.window.listeners.pagehide();
  assert.ok(b.definitions.every(t => t.signal.aborted));
});
