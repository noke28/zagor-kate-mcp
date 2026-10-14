const origin = location.origin;
const callback = `${origin}/hq/callback`;
const resource = `${origin}/mcp`;
const storageKey = 'zagor-hq-pkce';
const el = id => document.getElementById(id);
let token;
let expiry = 0;
let rpcId = 0;
const lifecycle = new AbortController();
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
function session(active) {
  for (const id of ['root', 'search-button', 'logout']) el(id).disabled = !active;
  el('login').disabled = active;
}
function clearSession() {
  token = undefined; expiry = 0; session(false);
  el('root-content').textContent = ''; el('provenance').textContent = '';
  el('matches').replaceChildren(); el('search-status').textContent = '';
}
async function responseJson(response) {
  if (!response.ok) throw new Error(`Zahtjev nije uspio (HTTP ${response.status}).`);
  return response.json();
}
async function login() {
  // Only PKCE transaction data survives the redirect. Access tokens stay in memory.
  const client = await responseJson(await fetch('/oauth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'ZAGOR HQ / KATE', redirect_uris: [callback], token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] }),
  }));
  if (typeof client.client_id !== 'string') throw new Error('Registracija klijenta nije završena.');
  const verifier = random(); const state = random();
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  sessionStorage.setItem(storageKey, JSON.stringify({ verifier, state, clientId: client.client_id, created: Date.now() }));
  const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: callback, response_type: 'code', scope: 'mcp:read', state, resource, code_challenge: challenge, code_challenge_method: 'S256' });
  location.assign(`/authorize?${params}`);
}
async function finishLogin() {
  if (location.pathname !== '/hq/callback') return;
  const params = new URLSearchParams(location.search);
  history.replaceState(null, '', '/hq');
  const raw = sessionStorage.getItem(storageKey); sessionStorage.removeItem(storageKey);
  if (!raw) throw new Error('Prijava nije pokrenuta u ovom prikazu.');
  const tx = JSON.parse(raw);
  if (params.get('state') !== tx.state || !Number.isFinite(tx.created) || Date.now() - tx.created > 15 * 60 * 1000 || Date.now() < tx.created) throw new Error('Prijava je istekla ili nije vezana za ovaj prikaz.');
  if (params.has('error')) throw new Error('Prijava nije odobrena.');
  if (params.get('iss') !== origin || !params.get('code')) throw new Error('Neispravan odgovor prijave.');
  const result = await responseJson(await fetch('/oauth/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', client_id: tx.clientId, redirect_uri: callback, code: params.get('code'), code_verifier: tx.verifier, resource }) }));
  if (typeof result.access_token !== 'string' || result.token_type?.toLowerCase() !== 'bearer' || !Number.isFinite(result.expires_in) || result.expires_in <= 0) throw new Error('Prijava nije dala važeću sesiju.');
  token = result.access_token; expiry = Date.now() + result.expires_in * 1000;
  session(true);
  el('connection').textContent = 'Prijava završena. Provjeravam pristup alatima…';
  await status();
}
async function rpc(method, params = {}) {
  if (!token || Date.now() >= expiry) { clearSession(); throw new Error('Poveži pristup preko GitHuba.'); }
  const activeToken = token;
  const response = await fetch('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  if ([401, 403].includes(response.status)) clearSession();
  const data = await responseJson(response);
  if (token !== activeToken) throw new Error('Sesija ovog prikaza je zatvorena.');
  if (data.error || data.result?.isError) throw new Error('KATE poziv nije uspio. Provjeri dozvole i konfiguraciju izvora.');
  return data.result;
}
async function status(input = {}) {
  emptyInput(input);
  const health = await responseJson(await fetch('/health'));
  if (health.ok !== true || health.service !== 'zagor-kate-mcp') throw new Error('KATE health odgovor nije potvrđen.');
  let toolsAvailable = false;
  if (token && Date.now() < expiry) {
    const listed = await rpc('tools/list');
    toolsAvailable = ['get_root', 'search_sources'].every(name => listed.tools?.some(tool => tool.name === name));
    if (!toolsAvailable) throw new Error('Potrebni KATE alati nisu dostupni.');
  } else clearSession();
  const result = { serviceAvailable: true, authenticatedToolsAvailable: toolsAvailable, rootReadVerified: false };
  el('connection').textContent = toolsAvailable ? 'Server i autorizovani alati dostupni. Čitanje ROOT-a provjeri zasebno.' : 'Server dostupan. Poveži pristup za čitanje izvora.';
  return result;
}
function emptyInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('Ovaj alat ne prihvata argumente.');
}
async function call(name, args) {
  const result = await rpc('tools/call', { name, arguments: args });
  const text = result.content?.find(item => item.type === 'text')?.text;
  if (!text) throw new Error('Odgovor izvora nedostaje.');
  return JSON.parse(text);
}
async function root(input = {}) {
  emptyInput(input);
  const result = await call('get_root', {});
  if (result.path !== 'authority/ROOT_FULL_CURRENT.md' || typeof result.content !== 'string' || !result.content.trim()) throw new Error('CURRENT FULL ROOT nije potvrđen.');
  el('provenance').textContent = `Izvor: KATE get_root · ${result.path} · ${new Date().toLocaleString()}`;
  el('root-content').textContent = result.content;
  el('connection').textContent = 'CURRENT FULL ROOT uspješno pročitan. Statusi kanona su u sadržaju izvora.';
  return result;
}
async function search(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'query') || typeof input.query !== 'string' || !input.query.trim() || input.query.length > 200) throw new Error('Unesi pojam za pretragu (do 200 znakova).');
  const result = await call('search_sources', { query: input.query.trim() });
  if (!Array.isArray(result.matches)) throw new Error('Odgovor pretrage nije ispravan.');
  const list = result.matches.map(match => {
    const url = new URL(match.url);
    if (url.origin !== 'https://github.com' || !url.pathname.startsWith('/noke28/zagor-duh-zime/') || typeof match.path !== 'string' || !/^(authority\/|kate\/procedures\/)/.test(match.path)) throw new Error('Porijeklo rezultata nije potvrđeno.');
    const li = document.createElement('li'); const a = document.createElement('a');
    a.href = url.href; a.textContent = match.path; a.target = '_blank'; a.rel = 'noopener noreferrer'; li.append(a); return li;
  });
  el('matches').replaceChildren(...list);
  el('query').value = input.query;
  el('search-status').textContent = `Pronađeno: ${result.matches.length} · Izvor: KATE search_sources / GitHub`;
  return result;
}
async function showError(action, target = 'connection') {
  try { return await action(); } catch (error) { el(target).textContent = error instanceof Error ? error.message : 'Zahtjev nije uspio.'; }
}
el('login').addEventListener('click', () => showError(login));
el('logout').addEventListener('click', () => { clearSession(); el('connection').textContent = 'Sesija ovog prikaza je zatvorena.'; });
el('status').addEventListener('click', () => showError(status));
el('root').addEventListener('click', () => showError(root));
el('search').addEventListener('submit', event => { event.preventDefault(); void showError(() => search({ query: el('query').value }), 'search-status'); });
window.addEventListener('pagehide', () => { lifecycle.abort(); clearSession(); });
session(false);
await showError(finishLogin);
if (document.modelContext?.registerTool) {
  const noArgs = { type: 'object', properties: {}, additionalProperties: false };
  const definitions = [
    { name: 'get_kate_connection_status', title: 'Status KATE veze', description: 'Provjeri dostupnost servera i autorizovanih alata. Ne potvrđuje čitanje ROOT-a.', inputSchema: noArgs, execute: status },
    { name: 'get_current_full_root', title: 'Otvori CURRENT FULL ROOT', description: 'Pročitaj CURRENT FULL ROOT preko autorizovanog KATE get_root i prikaži sadržaj i putanju. Potrebna je prijava.', inputSchema: noArgs, execute: root },
    { name: 'search_kate_sources', title: 'Pretraži KATE izvore', description: 'Pretraži authority i KATE procedure preko autorizovanog search_sources i prikaži putanje i GitHub linkove.', inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['query'], additionalProperties: false }, execute: search },
  ];
  try {
    for (const definition of definitions) await document.modelContext.registerTool({ ...definition, annotations: { readOnlyHint: true, untrustedContentHint: true } }, { signal: lifecycle.signal });
    el('webmcp').textContent = 'WebMCP: tri funkcije dostupne.';
  } catch { lifecycle.abort(); el('webmcp').textContent = 'WebMCP registracija nije uspjela. Koristi dugmad.'; }
} else el('webmcp').textContent = 'Ovaj preglednik nema WebMCP podršku. Sve funkcije su dostupne preko dugmadi.';
