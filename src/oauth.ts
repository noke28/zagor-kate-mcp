import { OAuthProvider, AuthorizationError, CimdFetchError, authorizationErrorRedirect } from "@cloudflare/workers-oauth-provider";
import type { OAuthHelpers, ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { fetchAuthorized } from "./index.ts";
import type { Env } from "./index.ts";

export const ISSUER = "https://zagor-kate-mcp.kenan-begicsa.workers.dev";
type OAuthEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };
const scopes = ["mcp:read", "offline_access"];
const escape = (value: string) => value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
const pageHeaders = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export function consentPage(details: ConsentDescription, handle: string): string {
  return `<!doctype html><html lang="bs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>KATE — poveži pristup</title><h1>KATE / ZAGOR HQ</h1>
  <p>Aplikacija <strong>${escape(details.clientName)}</strong> traži pristup za čitanje izvora.</p>
  <p>${details.clientDomain ? `Domena aplikacije: ${escape(details.clientDomain)}` : "Naziv aplikacije je navela sama aplikacija; nije potvrđen."}</p>
  <p>Pristup će biti vraćen na: <strong>${escape(details.redirectHost)}</strong>.</p>
  ${details.redirectIsLoopback ? "<p>Nastavi samo ako si upravo pokrenuo prijavu u aplikaciji na svom uređaju.</p>" : ""}
  <p>Dozvole: ${details.scope.map(escape).join(", ")}. Izmjene kanona i PMC zapisa nisu omogućene.</p>
  <form method="post" action="/authorize"><input type="hidden" name="handle" value="${escape(handle)}">
  <button name="decision" value="approve">Nastavi na GitHub</button>
  <button name="decision" value="deny">Odustani</button></form></html>`;
}

export async function s256(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const loginHandler = {
  async fetch(request: Request, rawEnv: Env): Promise<Response> {
    const env = rawEnv as OAuthEnv;
    const url = new URL(request.url);
    const issuer = ISSUER;
    if (url.origin !== issuer) return new Response("Unknown authorization origin", { status: 400 });
    if (!["/authorize", "/callback"].includes(url.pathname)) return new Response("Not found", { status: 404 });
    if (!env.OAUTH_GITHUB_CLIENT_ID || !env.OAUTH_GITHUB_CLIENT_SECRET || !env.OAUTH_ALLOWED_GITHUB_LOGIN) {
      return new Response("GitHub OAuth setup is pending. Configure the OAuth application in Cloudflare.", { status: 503, headers: pageHeaders });
    }
    const oauth = env.OAUTH_PROVIDER;
    try {
      if (url.pathname === "/authorize" && request.method === "GET") {
        const auth = await oauth.parseAuthRequest(request);
        if (!auth.codeChallenge || auth.codeChallengeMethod !== "S256") return new Response("S256 PKCE is required", { status: 400, headers: pageHeaders });
        if (auth.scope.some(scope => !scopes.includes(scope))) return new Response("Unsupported scope", { status: 400, headers: pageHeaders });
        const details = await oauth.describeConsent(auth);
        const consent = await oauth.beginConsent(auth);
        for (const [key, value] of Object.entries(pageHeaders)) consent.headers.set(key, value);
        return new Response(consentPage(details, consent.handle), { headers: consent.headers });
      }
      if (url.pathname === "/authorize" && request.method === "POST") {
        if (request.headers.get("Origin") !== issuer) return new Response("Invalid origin", { status: 403 });
        const form = await request.formData();
        const handle = String(form.get("handle") || "");
        if (form.get("decision") !== "approve") {
          const denied = await oauth.denyConsent(request, handle);
          return new Response(null, { status: 302, headers: denied.headers });
        }
        const approved = await oauth.approveConsent(request, handle);
        if (!approved.request.scope.includes("mcp:read")) return new Response("Read scope is required", { status: 400 });
        const verifier = crypto.randomUUID() + crypto.randomUUID();
        const upstream = await oauth.beginUpstream(approved.request, { data: { verifier }, headers: approved.headers });
        const target = new URL("https://github.com/login/oauth/authorize");
        target.search = new URLSearchParams({ client_id: env.OAUTH_GITHUB_CLIENT_ID, redirect_uri: `${issuer}/callback`, state: upstream.state, code_challenge: await s256(verifier), code_challenge_method: "S256" }).toString();
        upstream.headers.set("Location", target.href);
        upstream.headers.set("Referrer-Policy", "no-referrer");
        return new Response(null, { status: 302, headers: upstream.headers });
      }
      if (url.pathname === "/callback" && request.method === "GET") {
        const resumed = await oauth.finishUpstream<{ verifier: string }>(request);
        const denied = () => {
          resumed.headers.set("Location", authorizationErrorRedirect(resumed.request, "access_denied"));
          return new Response(null, { status: 302, headers: resumed.headers });
        };
        const code = url.searchParams.get("code");
        if (url.searchParams.has("error") || !code) return denied();
        const response = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: new URLSearchParams({ client_id: env.OAUTH_GITHUB_CLIENT_ID, client_secret: env.OAUTH_GITHUB_CLIENT_SECRET, redirect_uri: `${issuer}/callback`, code, code_verifier: resumed.data.verifier }),
        });
        if (!response.ok) return denied();
        const token: { access_token?: string } = await response.json();
        if (!token.access_token) return denied();
        const userResponse = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "zagor-kate-mcp", "X-GitHub-Api-Version": "2022-11-28" } });
        if (!userResponse.ok) return denied();
        const user: { id: number; login: string } = await userResponse.json();
        if (!Number.isSafeInteger(user.id) || user.login?.toLowerCase() !== env.OAUTH_ALLOWED_GITHUB_LOGIN.toLowerCase()) return denied();
        const result = await oauth.completeAuthorization({ request: resumed.request, userId: String(user.id), metadata: { label: "KATE read-only" }, scope: resumed.request.scope, props: { userId: String(user.id), login: user.login.toLowerCase() } });
        resumed.headers.set("Location", result.redirectTo);
        resumed.headers.set("Referrer-Policy", "no-referrer");
        return new Response(null, { status: 302, headers: resumed.headers });
      }
      return new Response("Method not allowed", { status: 405 });
    } catch (error) {
      if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
      if (error instanceof AuthorizationError || error instanceof CimdFetchError) return new Response("Authorization expired or invalid. Start again from your client.", { status: 400, headers: pageHeaders });
      return new Response("Authorization temporarily unavailable", { status: 503, headers: pageHeaders });
    }
  },
};

export const oauthWorker = new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler: {
    async fetch(request, env, ctx) {
      const props = ctx.props as { login?: string } | undefined;
      const auth = (ctx as unknown as { auth?: { scope?: string[] } }).auth;
      if (!env.OAUTH_ALLOWED_GITHUB_LOGIN || props?.login !== env.OAUTH_ALLOWED_GITHUB_LOGIN.toLowerCase()) return new Response("Forbidden", { status: 403 });
      if (!auth?.scope?.includes("mcp:read")) return new Response("Read scope is required", { status: 403 });
      return fetchAuthorized(request, env, true);
    },
  },
  defaultHandler: loginHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  accessTokenTTL: 3600,
  refreshTokenTTL: 2592000,
  scopesSupported: scopes,
  requiredScopes: ["mcp:read"],
  resourceMetadata: { resource: `${ISSUER}/mcp`, authorization_servers: [ISSUER] },
  clientIdMetadataDocumentEnabled: true,
});
