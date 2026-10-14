import html from '../public/hq/index.html';
import script from '../public/hq/app.js';

// Public shell only. All source reads still pass through the OAuth MCP handler.
export function hqResponse(request: Request): Response | undefined {
  const path = new URL(request.url).pathname;
  if (!['/hq', '/hq/', '/hq/callback', '/hq/app.js'].includes(path)) return;
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  const js = path === '/hq/app.js';
  return new Response(request.method === 'HEAD' ? null : js ? script : html, { headers: {
    'Content-Type': js ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  } });
}
