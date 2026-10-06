export interface Env {
  MCP_API_KEY: string;
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
  DOCMOST_URL: string;
  DOCMOST_API_KEY: string;
}

const AUTHORITY = {
  ustav: "authority/USTAV_FULL.md",
  root: "authority/ROOT_FULL_CURRENT.md",
  rootLite: "authority/ROOT-LITE_CURRENT.md",
  source: "authority/SOURCE_CURRENT.md",
  authority: "authority/AUTHORITY.md",
} as const;

const TOOLS = [
  {
    name: "get_ustav",
    description: "Read the current USTAV authority document.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_root",
    description: "Read the CURRENT FULL ROOT.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_root_lite",
    description: "Read ROOT-LITE navigation layer.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_source_archive",
    description: "Read the current SOURCE provenance document.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "search_sources",
    description: "Search authority and KATE procedure sources in the main Zagor repository.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        scope: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_kate_procedure",
    description: "Read a KATE procedure by name from kate/procedures/<name>.md.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "write_pmc",
    description: "Write a PMC system record as a GitHub Issue. Never writes canon.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["system"] },
        decision: { type: "string" },
        rationale: { type: "string" },
      },
      required: ["scope", "decision", "rationale"],
    },
  },
  {
    name: "get_docmost_page",
    description: "Read a Docmost page by page ID.",
    inputSchema: {
      type: "object",
      properties: { page_id: { type: "string" } },
      required: ["page_id"],
    },
  },
] as const;

function authHeaders(env: Env): HeadersInit {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "zagor-kate-mcp",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function ghFetch(env: Env, path: string): Promise<any> {
  const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/${path}`, {
    headers: authHeaders(env),
  });
  if (!r.ok) {
    throw new Error(`GitHub ${path}: ${r.status} ${await r.text()}`);
  }
  return r.json();
}

function decodeBase64Utf8(value: string): string {
  const binary = atob(value.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function ghFileContent(env: Env, path: string): Promise<string> {
  const data = await ghFetch(env, `contents/${path}?ref=main`);
  if (!data?.content) throw new Error(`Missing file content: ${path}`);
  return decodeBase64Utf8(data.content);
}

async function docmostFetch(env: Env, path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${env.DOCMOST_URL.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.DOCMOST_API_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`Docmost ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function searchCode(env: Env, query: string): Promise<any[]> {
  const q = encodeURIComponent(`${query} repo:${env.GITHUB_REPO}`);
  const r = await fetch(`https://api.github.com/search/code?q=${q}&per_page=25`, {
    headers: authHeaders(env),
  });
  if (!r.ok) throw new Error(`GitHub search: ${r.status} ${await r.text()}`);
  const data: any = await r.json();
  return (data.items || []).map((item: any) => ({
    path: item.path,
    url: item.html_url,
    name: item.name,
  }));
}

async function callTool(env: Env, name: string, args: any): Promise<any> {
  switch (name) {
    case "get_ustav":
      return { path: AUTHORITY.ustav, content: await ghFileContent(env, AUTHORITY.ustav) };

    case "get_root":
      return { path: AUTHORITY.root, content: await ghFileContent(env, AUTHORITY.root) };

    case "get_root_lite":
      return { path: AUTHORITY.rootLite, content: await ghFileContent(env, AUTHORITY.rootLite) };

    case "get_source_archive":
      return { path: AUTHORITY.source, content: await ghFileContent(env, AUTHORITY.source) };

    case "search_sources": {
      const raw = await searchCode(env, args.query);
      const scope = String(args.scope || "").trim().toLowerCase();
      const allowed = raw.filter((item: any) => {
        if (!scope) return item.path.startsWith("authority/") || item.path.startsWith("kate/procedures/");
        return item.path.toLowerCase().includes(scope);
      });
      return { matches: allowed };
    }

    case "get_kate_procedure": {
      const safe = String(args.name || "");
      if (!/^[a-z0-9-]+$/.test(safe)) throw new Error("Invalid procedure name");
      const path = `kate/procedures/${safe}.md`;
      return { path, content: await ghFileContent(env, path) };
    }

    case "get_docmost_page": {
      const data = await docmostFetch(env, "/api/pages/info", {
        method: "POST",
        body: JSON.stringify({ pageId: args.page_id }),
      });
      const page = data.data || data.page || data;
      return {
        content: page?.content || page?.body || "",
        title: page?.title || "",
        page_id: page?.id || args.page_id,
      };
    }

    case "write_pmc": {
      if (args.scope !== "system") {
        throw new Error("MCP write_pmc only supports system scope; story PMC is handled by kate_worker.");
      }
      const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
        method: "POST",
        headers: {
          ...authHeaders(env),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: `[PMC] ${String(args.decision).slice(0, 100)}`,
          body: `## Decision\n${args.decision}\n\n## Rationale\n${args.rationale}`,
          labels: ["pmc", "kate-decision"],
        }),
      });
      if (!r.ok) throw new Error(`GitHub issue create: ${r.status} ${await r.text()}`);
      const data: any = await r.json();
      return { url: data.html_url, number: data.number };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function json(data: any, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, service: "zagor-kate-mcp" });
    }

    const auth = request.headers.get("Authorization");
    if (!env.MCP_API_KEY || auth !== `Bearer ${env.MCP_API_KEY}`) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }

    try {
      if (url.pathname === "/mcp/tools/list" && request.method === "GET") {
        return json({ tools: TOOLS });
      }

      if (url.pathname === "/mcp/tools/call" && request.method === "POST") {
        const body = (await request.json()) as { name?: string; arguments?: any };
        if (!body.name) return json({ success: false, error: "Missing tool name" }, 400);
        const result = await callTool(env, body.name, body.arguments || {});
        return json({ success: true, result });
      }

      return json({ success: false, error: "Not found" }, 404);
    } catch (e: any) {
      return json({ success: false, error: e?.message || String(e) }, 500);
    }
  },
};
