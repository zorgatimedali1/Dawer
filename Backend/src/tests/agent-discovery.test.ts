import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../types';
import { handleAgentDiscoveryRoute } from '../routes/agent-discovery';
import { handleMcpRoute } from '../routes/mcp';
import { handleOauthDiscoveryRoute } from '../routes/oauth';
import { sha256Hex } from '../lib/crypto';
import { createTestEnv, type TestEnv } from './helpers/d1';

let env: TestEnv;

beforeEach(() => {
  env = createTestEnv();
});

function getRequest(path: string, extraHeaders: Record<string, string> = {}): Request {
  return new Request(`https://dawer.tn${path}`, { method: 'GET', headers: extraHeaders });
}

async function payload(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>;
}

function mcpRequest(method: string, params: Record<string, unknown>, id: number | string = 1): Request {
  return new Request('https://dawer.tn/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
}

describe('agent discovery documents', () => {
  it('serves the RFC 9727 API catalog as a linkset', async () => {
    const response = await handleAgentDiscoveryRoute(getRequest('/.well-known/api-catalog'), env as unknown as Env);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/linkset+json');
    const body = await payload(response);
    const entry = body.linkset.at(0);
    expect(entry.anchor).toBe('https://dawer.tn/');
    const hrefs = [...entry['service-desc'], ...entry['service-doc'], ...entry.status, ...entry.describedby].map(
      (link: { href: string }) => link.href,
    );
    expect(hrefs).toContain('https://dawer.tn/.well-known/openapi.json');
    expect(hrefs).toContain('https://dawer.tn/health');
  });

  it('describes the public surface in the OpenAPI document', async () => {
    const response = await handleAgentDiscoveryRoute(getRequest('/.well-known/openapi.json'), env as unknown as Env);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/vnd.oai.openapi+json');
    const body = await payload(response);
    expect(body.openapi).toBe('3.1.0');
    for (const path of ['/health', '/api/public/plans', '/api/oauth/token', '/api/auth/register']) {
      expect(body.paths, `${path} must be described`).toHaveProperty(path);
    }
  });

  it('publishes protected-resource metadata whose authorization server issuer matches RFC 8414', async () => {
    const response = await handleAgentDiscoveryRoute(
      getRequest('/.well-known/oauth-protected-resource'),
      env as unknown as Env,
    );
    const prm = await payload(response);

    expect(prm.resource).toBe('https://dawer.tn/');
    expect(prm.authorization_servers).toEqual(['https://dawer.tn']);
    expect(prm.bearer_methods_supported).toContain('header');

    const asMetadata = await payload(
      await handleOauthDiscoveryRoute(getRequest('/.well-known/oauth-authorization-server'), env as unknown as Env),
    );
    expect(asMetadata.issuer).toBe('https://dawer.tn');
    // auth.md agent-auth profile: registration surface advertised.
    expect(asMetadata.agent_auth.skill).toBe('https://dawer.tn/auth.md');
    expect(asMetadata.agent_auth.register_uri).toBe('https://dawer.tn/api/auth/register');
  });

  it('advertises the MCP Server Card at both reserved locations', async () => {
    for (const [path, route] of [
      ['/.well-known/mcp/server-card.json', handleAgentDiscoveryRoute],
      ['/mcp/server-card', handleMcpRoute],
    ] as const) {
      const response = await route(getRequest(path), env as unknown as Env);
      expect(response.status, path).toBe(200);
      const body = await payload(response);
      expect(body.name).toBe('tn.dawer/mcp');
      expect(body.version).toBe('1.0.0');
      expect(body.remotes.at(0).url).toBe('https://dawer.tn/mcp');
    }
  });

  it('serves the ARD manifest with wide-open CORS and well-formed entries', async () => {
    const response = await handleAgentDiscoveryRoute(getRequest('/.well-known/ai-catalog.json'), env as unknown as Env);

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const body = await payload(response);
    expect(typeof body.specVersion).toBe('string');
    expect(body.entries.length).toBeGreaterThan(0);
    for (const entry of body.entries) {
      expect(entry.identifier).toMatch(/^urn:air:dawer\.tn:.+/);
      // Exactly one of url|data per entry (ARD spec §3.4).
      expect(entry.url !== undefined).toBe(entry.data === undefined);
      expect(Array.isArray(entry.representativeQueries)).toBe(true);
      expect(entry.representativeQueries.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('publishes an agent-skills index whose digest matches the served SKILL.md', async () => {
    const index = await payload(
      await handleAgentDiscoveryRoute(getRequest('/.well-known/agent-skills/index.json'), env as unknown as Env),
    );

    expect(index.$schema).toBe('https://schemas.agentskills.io/discovery/0.2.0/schema.json');
    expect(index.skills.length).toBeGreaterThan(0);

    const skill = index.skills.at(0);
    expect(skill.name).toBe('dawer-api');
    const digest = `sha256:${await sha256Hex(await (await handleAgentDiscoveryRoute(getRequest(skill.url.replace('https://dawer.tn', '')), env as unknown as Env)).text())}`;
    expect(skill.digest).toBe(digest);
  });

  it('still answers 404 for unknown well-known paths (never the API envelope)', async () => {
    const response = await handleAgentDiscoveryRoute(getRequest('/.well-known/not-registered'), env as unknown as Env);
    expect(response.status).toBe(404);
  });
});

describe('MCP endpoint (stateless streamable HTTP)', () => {
  it('negotiates the protocol version and answers initialize', async () => {
    const response = await handleMcpRoute(mcpRequest('initialize', { protocolVersion: '2025-06-18' }), env as unknown as Env);
    expect(response.status).toBe(200);
    const body = await payload(response);
    expect(body.result.protocolVersion).toBe('2025-06-18');
    expect(body.result.serverInfo.name).toBe('Dawer');
    expect(body.result.capabilities.tools).toBeDefined();
  });

  it('lists the read-only tools', async () => {
    const body = await payload(await handleMcpRoute(mcpRequest('tools/list', {}), env as unknown as Env));
    const names = body.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain('get_dawer_pricing');
    expect(names).toContain('get_dawer_overview');
    for (const tool of body.result.tools) {
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('reads only public marketing data in get_dawer_pricing', async () => {
    // schema.sql seeds the real marketing plans; insert one extra plan rather
    // than asserting on seeded rows (operator-editable in production).
    await env.DB.prepare(
      `INSERT INTO plans (id, name, slug, price_cents, interval, features, active, created_at)
       VALUES ('p-testing', 'TestPlan', 'testplan', 24900, 'year', '{"features":["100 SMS inclus"]}', 1, ?)`,
    ).bind(new Date().toISOString()).run();

    const body = await payload(
      await handleMcpRoute(mcpRequest('tools/call', { name: 'get_dawer_pricing' }), env as unknown as Env),
    );
    expect(body.result.isError).toBeUndefined();
    expect(body.result.content.at(0).type).toBe('text');
    expect(body.result.content.at(0).text).toContain('TestPlan');
    expect(body.result.content.at(0).text).toContain('249');
  });

  it('reports unknown tools and unknown methods with the proper JSON-RPC errors', async () => {
    const toolCall = await payload(
      await handleMcpRoute(mcpRequest('tools/call', { name: 'nope' }, 'id-1'), env as unknown as Env),
    );
    expect(toolCall.result.isError).toBe(true);

    const list = await payload(await handleMcpRoute(mcpRequest('resources/list', {}), env as unknown as Env));
    expect(list.error.code).toBe(-32601);
  });

  it('answers notifications with 202 and no body', async () => {
    const response = await handleMcpRoute(mcpRequest('notifications/initialized', {}), env as unknown as Env);
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
  });

  it('refuses method/origin misuse', async () => {
    expect((await handleMcpRoute(getRequest('/mcp'), env as unknown as Env)).status).toBe(405);

    const crossOrigin = await handleMcpRoute(
      new Request('https://dawer.tn/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example.com' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
      env as unknown as Env,
    );
    expect(crossOrigin.status).toBe(403);
  });
});
