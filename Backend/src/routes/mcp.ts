import { SITE_URL } from './oauth'; // card copies live in agent-discovery; SITE_URL stays owned by oauth.ts
import { mcpServerCard } from './agent-discovery';
import { errorResponse } from '../lib/http';
import type { Env } from '../types';

/** JSON with a custom content type (errorResponse pins `application/json`). */
function typedJson(payload: unknown, status: number, contentType: string): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': contentType, 'cache-control': 'no-store' },
  });
}

/**
 * Minimal stateless MCP (Model Context Protocol) server over the Streamable HTTP
 * transport (`/mcp`, JSON-RPC 2.0 over POST). Advertised by the Server Card at
 * /.well-known/mcp/server-card.json.
 *
 * Design constraints honoured deliberately:
 *  - STATELESS: no SSE stream, no sessions (no mcp-session-id). Every POST is a
 *    complete request/response pair, which is what the spec's stateless mode
 *    allows and keeps this endpoint free of per-session storage.
 *  - READ-ONLY and UNAUTHENTICATED: the tools expose only the same public
 *    marketing data as the landing page (pricing, product overview). Creating
 *    anything would require the account lifecycle documented in /auth.md.
 * The card deliberately omits primitives; tools/list is the runtime truth.
 */

const SERVER_PROTOCOL_VERSION = '2025-06-18';
/** Versions this endpoint can accept back from the client, newest first. */
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18'];

const SERVER_INFO = {
  name: 'Dawer',
  version: '1.0.0',
} as const;

const MCP_JSON = 'application/json; charset=utf-8';

/** JSON-RPC response helpers (MCP is JSON-RPC 2.0, not the API envelope). */
function rpcResult(id: unknown, result: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    status: 200,
    headers: { 'content-type': MCP_JSON, 'cache-control': 'no-store' },
  });
}

function rpcError(id: unknown, code: number, message: string, status = 200): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }), {
    status,
    headers: { 'content-type': MCP_JSON, 'cache-control': 'no-store' },
  });
}

const EMPTY_RESPONSE: Response = new Response(null, { status: 202 });

/* ---------------------------------------------------------------- */
/* Tools: runtime truth via tools/list — the Server Card lists none. */
/* ------------------------------------------------------------------ */

interface PlanRow {
  name: string;
  slug: string;
  price_cents: number;
  interval: string;
  features: string | null;
}

/**
 * Same public pricing read as the landing-page feed (routes/public-plans.ts):
 * only active plans, marketing bullets only — never the internal entitlement
 * blob. Formatted as MCP tool output (text content blocks).
 */
async function pricingToolResult(env: Env): Promise<Record<string, unknown>> {
  const result = await env.DB.prepare(
    `SELECT name, slug, price_cents, interval, features
     FROM plans
     WHERE active = 1
     ORDER BY price_cents ASC`,
  ).all<PlanRow>();

  const lines: string[] = ['# Dawer pricing plans', ''];
  for (const row of result.results ?? []) {
    const currency = (row.price_cents / 100).toFixed(0);
    const bullets: string[] = [];
    if (row.features) {
      try {
        const parsed = JSON.parse(row.features) as { features?: unknown };
        if (Array.isArray(parsed.features)) {
          bullets.push(...parsed.features.filter((item): item is string => typeof item === 'string').slice(0, 3));
        }
      } catch {
        // Marketing bullets only; a malformed blob just shows fewer bullets.
      }
    }
    lines.push(
      `## ${row.name} (${row.slug})`,
      `- Price: ${currency} TND per ${row.interval.replace('_', ' ')}`,
      ...bullets.map((bullet) => `- ${bullet}`),
      `- Details: ${SITE_URL}/api/public/plans`,
      '',
    );
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

const OVERVIEW_TEXT = `# Dawer — product overview

Dawer is a gamified customer-acquisition platform for shops, restaurants and cafés
in Tunisia. Merchants install an interactive fortune wheel in their venue (QR/poster),
customers play, share contact details and win a reward delivered instantly by
WhatsApp or e-mail. The merchant keeps every lead in a dashboard and runs later
WhatsApp/SMS/e-mail marketing campaigns from the same console.

- Free trial (Starter), paid plans without commitment: ${SITE_URL}/api/public/plans
- Pricing/goal page for humans: ${SITE_URL}/
- Contact: contact@dawer.com — Tunis, Tunisie (+216 55 000 000)
- Agent-facing guides: ${SITE_URL}/auth.md and ${SITE_URL}/llms.txt
- Traffic policy: Content-Signal ai-train=yes (see robots.txt)
`;

const TOOLS = [
  {
    name: 'get_dawer_pricing',
    title: 'Get Dawer pricing plans',
    description: 'Returns the active Dawer merchant pricing plans (name, price in Tunisian dinar, billing interval, top features). Public data, no authentication needed.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_dawer_overview',
    title: 'Get Dawer product overview',
    description: 'Returns a short description of the Dawer product (what it does, who it is for), official links and contact details. Public data, no authentication needed.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    annotations: { readOnlyHint: true },
  },
] as const;

async function callTool(name: unknown, env: Env): Promise<Record<string, unknown>> {
  if (name === 'get_dawer_pricing') {
    return pricingToolResult(env);
  }
  if (name === 'get_dawer_overview') {
    return { content: [{ type: 'text', text: OVERVIEW_TEXT }] };
  }
  // Per the MCP spec, a wrong tool name is a Tool execution error surfaced
  // inside a successful JSON-RPC response (isError flag), not a protocol error.
  return {
    content: [{ type: 'text', text: `Unknown tool: ${String(name)}` }],
    isError: true,
  };
}

/**
 * Streamable HTTP MCP endpoint (stateless subset):
 *  - POST /mcp with JSON-RPC 2.0 body (single message; no batched payloads).
 *  - GET /mcp would be the SSE stream — intentionally 405 (see header).
 */
export async function handleMcpRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // Cross-origin browser calls are refused: these tools are for server-side
  // agents/local clients that do not send an Origin header. This is the MCP
  // spec's DNS-rebinding/CSRF stance for a server without allowed-origins CORS.
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== url.host) {
        return errorResponse('Cross-origin MCP calls are not allowed.', 403);
      }
    } catch {
      return errorResponse('Cross-origin MCP calls are not allowed.', 403);
    }
  }

  if (url.pathname === '/mcp/server-card') {
    if (request.method === 'GET') {
      // SEP-2127: GET <streamable-http-url>/server-card is the reserved card
      // location; serve the exact same document as the well-known copy.
      return typedJson(mcpServerCard, 200, 'application/json; charset=utf-8');
    }
    return errorResponse('Method not allowed.', 405);
  }

  if (request.method !== 'POST') {
    // GET would stream server events (browser clients); DELETE ends a session.
    const response = errorResponse('Method not allowed. POST JSON-RPC 2.0 to /mcp.', 405);
    response.headers.set('allow', 'POST');
    return response;
  }

  const contentType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    return rpcError(null, -32700, 'Requests must use Content-Type: application/json.', 415);
  }

  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return rpcError(null, -32700, 'Invalid JSON.', 400);
  }

  const requestObject = (Array.isArray(body) ? body[0] : body) as
    | { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }
    | null;
  // Batches are out of scope for the stateless subset; a batch answer would
  // need multipart/streaming responses we deliberately do not serve.
  if (
    !requestObject
    || Array.isArray(body)
    || requestObject.jsonrpc !== '2.0'
    || typeof requestObject.method !== 'string'
  ) {
    return rpcError(requestObject && 'id' in requestObject ? requestObject.id : null, -32600, 'Invalid JSON-RPC 2.0 request.');
  }

  const id = 'id' in requestObject ? requestObject.id : undefined;
  const method = requestObject.method;

  // Notifications have no id and expect NO response body (202 Accepted).
  if (method.startsWith('notifications/')) {
    return EMPTY_RESPONSE;
  }

  if (method === 'initialize') {
    const params = requestObject.params as { protocolVersion?: unknown } | undefined;
    const clientVersion = typeof params?.protocolVersion === 'string' ? params.protocolVersion : SERVER_PROTOCOL_VERSION;
    // Echo the client's version when we understand it, otherwise our default:
    // the client decides what to do with a server it cannot speak to.
    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(clientVersion) ? clientVersion : SERVER_PROTOCOL_VERSION;
    return rpcResult(id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
    });
  }

  if (method === 'tools/list') {
    return rpcResult(id, { tools: TOOLS });
  }

  if (method === 'tools/call') {
    const params = requestObject.params as { name?: unknown; arguments?: unknown } | undefined;
    if (typeof params?.name !== 'string') {
      return rpcError(id, -32602, 'Missing params.name.');
    }
    try {
      return rpcResult(id, await callTool(params.name, env));
    } catch (error) {
      console.error('MCP tool execution failed.', error);
      return rpcResult(id, {
        content: [{ type: 'text', text: 'Tool execution failed on the server.' }],
        isError: true,
      });
    }
  }

  return rpcError(id, -32601, `Method not supported: ${method}.`);
}
