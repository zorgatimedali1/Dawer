import { sha256Hex } from '../lib/crypto';
import { errorResponse } from '../lib/http';
import { SITE_URL, handleOauthDiscoveryRoute } from './oauth';
import type { Env } from '../types';

/**
 * Agent-facing discovery documents (well-known URIs + /auth.md artifacts that
 * live under .well-known). Each document is generated from constants here, so
 * self-referencing URLs and digests are always in sync with what is served.
 *
 * Everything in this file is unauthenticated public metadata: no PII, no
 * operational detail, read-only answers to "how do I talk to this site?".
 * RFC 8288 link headers that point agents at these documents are set in the
 * baseline security middleware (index.ts) and in public/_headers.
 */

/** JSON with a custom content type (jsonResponse pins `application/json`). */
function typedJson(payload: unknown, status: number, contentType: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': contentType, ...extraHeaders },
  });
}

/* ------------------------------------------------------------------ */
/* OpenAPI description of the public API surface (service-desc target). */
/* ------------------------------------------------------------------ */

const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Dawer API',
    version: '1.0.0',
    description:
      'Dawer is a gamified customer-acquisition platform for merchants in Tunisia '
      + '(interactive fortune wheel in-store, rewards by WhatsApp/e-mail). '
      + 'Automated clients authenticate with a merchant account through the '
      + 'OAuth 2.0 password grant and call the JSON API with `Authorization: Bearer`.',
  },
  servers: [{ url: SITE_URL }],
  tags: [
    { name: 'Discovery', description: 'Machine-readable metadata documents (public, unauthenticated).' },
    { name: 'Public', description: 'Unauthenticated marketing/probe feeds used by the landing page.' },
    { name: 'Auth', description: 'Account lifecycle for merchant operators and automated clients.' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', description: 'Opaque session token from the password grant; 3-day lifetime.' },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/health': {
      get: {
        tags: ['Public'],
        summary: 'Liveness probe (cron/reconcile recency).',
        description: 'Returns HTTP 200 with operational heartbeats; 5xx signals the worker is unhealthy. Unauthenticated.',
        security: [],
        responses: { '200': { description: 'Service alive.' } },
      },
    },
    '/api/public/plans': {
      get: {
        tags: ['Public'],
        summary: 'Active pricing plans (merchant-facing marketing feed).',
        operationId: 'listPlans',
        security: [],
        responses: {
          '200': {
            description: 'Active plans ordered by price, with marketing bullets.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    plans: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          slug: { type: 'string' },
                          priceCents: { type: 'integer' },
                          interval: { type: 'string' },
                          features: { type: 'array', items: { type: 'string' } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/public/partners': {
      get: {
        tags: ['Public'],
        summary: 'Partner marquee list.',
        operationId: 'listPartners',
        security: [],
        responses: {
          '200': {
            description: 'Partner names and public logo URLs.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    partners: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          name: { type: 'string' },
                          logoUrl: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/agent/identity': {
      post: {
        tags: ['Auth'],
        summary: 'Anonymous agent identity staging (auth.md anonymous method).',
        description:
          'Stages an UNOWNED machine identity: no business, no trial, e-mail campaigns disabled. '
          + 'Credentials (email+password) are returned once for the password grant; the operator claims '
          + 'ownership by signing in once at /auth/login. Advertised in agent_auth of the RFC 8414 document.',
        operationId: 'registerAgentIdentity',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['type'],
                properties: { type: { type: 'string', enum: ['anonymous'] } },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Machine identity created with a one-time credential pair.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    registration_id: { type: 'string' },
                    registration_type: { type: 'string', enum: ['anonymous'] },
                    credentials: {
                      type: 'object',
                      properties: { username: { type: 'string' }, password: { type: 'string' } },
                    },
                    token_endpoint: { type: 'string' },
                    claim_url: { type: 'string' },
                    revocation_uri: { type: 'string' },
                  },
                },
              },
            },
          },
          '400': { description: 'Validation failed / unsupported registration type.' },
        },
      },
    },
    '/api/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Self-service merchant account registration.',
        description: 'Creates a merchant account (optionally with a business) and issues a session. Suitable for automated clients because it requires no browser-only step.',
        operationId: 'register',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password', 'firstName', 'lastName'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8, maxLength: 128 },
                  firstName: { type: 'string', maxLength: 60 },
                  lastName: { type: 'string', maxLength: 60 },
                  businessName: { type: 'string', minLength: 2, maxLength: 120 },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Account created; session cookie set in the response.' },
          '409': { description: 'E-mail already registered.' },
          '400': { description: 'Validation failed.' },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Interactive sign-in (browser cookie session).',
        description:
          'Browser-focused: the session token travels in an HttpOnly cookie and can carry a Turnstile token. '
          + 'Automated clients should use `/api/oauth/token` instead, which returns the token in the JSON body.',
        operationId: 'login',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                  turnstileToken: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Signed in (session cookie).' }, '401': { description: 'Invalid credentials.' } },
      },
    },
    '/api/oauth/token': {
      post: {
        tags: ['Auth'],
        summary: 'OAuth 2.0 password grant — token acquisition for automated clients.',
        description:
          'RFC 6749 §4.3 form-encoded request; returns `access_token` (Bearer, 3-day lifetime) in the JSON body '
          + 'instead of a cookie. No CAPTCHA, no cookies. Wrong passwords share the interactive-login lockout counter '
          + '(account freezes after 5 consecutive failures for 15 minutes).',
        operationId: 'passwordGrant',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/x-www-form-urlencoded': {
              schema: {
                type: 'object',
                required: ['grant_type', 'username', 'password'],
                properties: {
                  grant_type: { type: 'string', enum: ['password'] },
                  username: { type: 'string', format: 'email', description: 'Merchant account e-mail.' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Token issued.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    access_token: { type: 'string' },
                    token_type: { type: 'string', enum: ['Bearer'] },
                    expires_in: { type: 'integer' },
                    scope: { type: 'string' },
                  },
                },
              },
            },
          },
          '400': { description: 'RFC 6749 §5.2 error codes (invalid_request, unsupported_grant_type, invalid_grant).' },
        },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Revoke the current session.',
        description: 'Accepts the session cookie or an `Authorization: Bearer` header.',
        operationId: 'logout',
        responses: { '200': { description: 'Revoked (or nothing to revoke — idempotent).' } },
      },
    },
    '/.well-known/oauth-authorization-server': {
      get: {
        tags: ['Discovery'],
        summary: 'RFC 8414 authorization-server metadata (incl. agent_auth block).',
        operationId: 'getAuthorizationServerMetadata',
        security: [],
        responses: { '200': { description: 'RFC 8414 metadata document.' } },
      },
    },
    '/.well-known/oauth-protected-resource': {
      get: {
        tags: ['Discovery'],
        summary: 'RFC 9728 protected-resource metadata.',
        operationId: 'getProtectedResourceMetadata',
        security: [],
        responses: { '200': { description: 'RFC 9728 metadata document.' } },
      },
    },
  },
};

/* ------------------------------------------------------------- */
/* API catalog — RFC 9727: linkset pointing at spec/doc/health.   */
/* ------------------------------------------------------------- */

const apiCatalog = {
  linkset: [
    {
      anchor: `${SITE_URL}/`,
      'service-desc': [
        { href: `${SITE_URL}/.well-known/openapi.json`, type: 'application/vnd.oai.openapi+json' },
      ],
      'service-doc': [
        { href: `${SITE_URL}/llms.txt`, type: 'text/plain' },
        { href: `${SITE_URL}/auth.md`, type: 'text/markdown' },
      ],
      status: [{ href: `${SITE_URL}/health`, type: 'application/json' }],
      describedby: [{ href: `${SITE_URL}/.well-known/oauth-authorization-server`, type: 'application/json' }],
    },
  ],
};

/* ---------------------------------------------------------------- */
/* OAuth Protected Resource Metadata — RFC 9728. The AS is this very */
/* origin (see routes/oauth.ts), so issuer advertised there matches. */
/* ----------------------------------------------------------------- */

const protectedResourceMetadata = {
  resource: `${SITE_URL}/`,
  authorization_servers: [SITE_URL],
  scopes_supported: ['api'],
  bearer_methods_supported: ['header'],
  resource_documentation: `${SITE_URL}/llms.txt`,
};

/* ------------------------------------------------------------------ */
/* MCP Server Card (SEP-2127, extension `io.modelcontextprotocol/`).   */
/* Primitives are deliberately NOT enumerated here: they are runtime  */
/* state; `capabilities.tools` only advertises the negotiated surface. */
/* ------------------------------------------------------------------- */

export const mcpServerCard = {
  $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
  name: 'tn.dawer/mcp',
  title: 'Dawer',
  version: '1.0.0',
  description:
    'Public Dawer MCP server: pricing plan lookup and product overview for the gamified '
    + 'customer-acquisition platform for Tunisian merchants. Unauthenticated read-only tools.',
  websiteUrl: `${SITE_URL}/`,
  remotes: [
    {
      type: 'streamable-http' as const,
      url: `${SITE_URL}/mcp`,
      supportedProtocolVersions: ['2025-11-25', '2025-06-18'],
    },
  ],
  capabilities: { tools: { listChanged: false } },
};

/* ------------------------------------------------------------------ */
/* ARD capability manifest (ai-catalog). Exactly one of url/data per   */
/* entry, IANA media types, urn:air identifiers; representativeQueries */
/* feed semantic-embedding registries.                                 */
/* ------------------------------------------------------------------- */

const SKILL_NAME = 'dawer-api';
const SKILL_URL = `${SITE_URL}/.well-known/agent-skills/${SKILL_NAME}/SKILL.md`;

/** Agent Skills SKILL.md served under /.well-known/agent-skills/. */
const SKILL_MD = `---
name: dawer-api
description: How automated agents sign up as a merchant on Dawer (gamified customer-acquisition platform for Tunisia), obtain a Bearer token with the OAuth 2.0 password grant, and call the public JSON API.
---

# Dawer API for agents

Dawer is a gamified customer-acquisition platform for shops, restaurants and cafés in
Tunisia: merchants install an in-store interactive fortune wheel; customers play,
share contact details and win a reward delivered by WhatsApp or e-mail. Paid plans,
free trial, no commitment.

This platform runs an autonomous-merchant model: the agent acts **on behalf of a real
merchant operator**, with the operator's own credentials and full responsibility for
their account.

## 1. Create a merchant account

\`\`\`
POST ${SITE_URL}/api/auth/register
Content-Type: application/json

{"email": "…", "password": "…", "firstName": "…", "lastName": "…", "businessName": "…"}
\`\`\`

- \`businessName\` is optional; when present a business (tenant) is created with a
  Starter free trial.
- The response sets an HttpOnly session cookie intended for browsers; automated
  clients should ignore it and rely on the machine token below.
- The e-mail address is **not** verified; unverified accounts send no campaign e-mail.

## 2. Obtain a token (OAuth 2.0 password grant, RFC 6749 §4.3)

\`\`\`
POST ${SITE_URL}/api/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=password&username=<email>&password=<password>
\`\`\`

Response: \`{"access_token": "cf_…", "token_type": "Bearer", "expires_in": 259200,
"scope": "api"}\`. Opaque token, 3-day lifetime, no CAPTCHA, no cookies. Five
consecutive wrong passwords freeze the account for 15 minutes.

## 3. Call the API

Send \`Authorization: Bearer <token>\` on the \`/api/*\` JSON endpoints. Public,
no-auth endpoints: \`GET ${SITE_URL}/api/public/plans\` (pricing),
\`GET ${SITE_URL}/api/public/partners\` (partner marquee), \`GET ${SITE_URL}/health\`.

## 4. Discovery documents

- OpenAPI description: ${SITE_URL}/.well-known/openapi.json
- API catalog (RFC 9727): ${SITE_URL}/.well-known/api-catalog
- Protected-resource metadata (RFC 9728): ${SITE_URL}/.well-known/oauth-protected-resource
- Authorization-server metadata (RFC 8414, incl. \`agent_auth\`): ${SITE_URL}/.well-known/oauth-authorization-server
- Full agent guide: ${SITE_URL}/auth.md
- MCP server (read-only public tools): ${SITE_URL}/mcp — see ${SITE_URL}/.well-known/mcp/server-card.json
`;

/** Agent Skills discovery index; the digest is computed per request so the */
/** hash can never drift from the served SKILL.md.                          */
async function buildSkillsIndex(): Promise<Record<string, unknown>> {
  return {
    $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
    skills: [
      {
        name: SKILL_NAME,
        type: 'skill-md',
        description:
          'Merchant sign-up, OAuth 2.0 password-grant token acquisition, and public API usage for Dawer.',
        url: SKILL_URL,
        digest: `sha256:${await sha256Hex(SKILL_MD)}`,
      },
    ],
  };
}

const aiCatalog = {
  specVersion: '1.0',
  host: {
    displayName: 'Dawer',
    identifier: 'did:web:dawer.tn',
  },
  entries: [
    {
      identifier: 'urn:air:dawer.tn:server:dawer-mcp',
      displayName: 'Dawer MCP server',
      type: 'application/json',
      url: `${SITE_URL}/.well-known/mcp/server-card.json`,
      representativeQueries: [
        'what are the Dawer pricing plans',
        'what does Dawer do for merchants',
        'how does an agent authenticate with Dawer',
      ],
    },
    {
      identifier: 'urn:air:dawer.tn:catalog:api-catalog',
      displayName: 'Dawer API catalog (RFC 9727)',
      type: 'application/linkset+json',
      url: `${SITE_URL}/.well-known/api-catalog`,
      representativeQueries: [
        'API documentation for Dawer merchant endpoints',
        'where is the Dawer OpenAPI specification',
      ],
    },
    {
      identifier: 'urn:air:dawer.tn:api:openapi',
      displayName: 'Dawer OpenAPI description',
      type: 'application/vnd.oai.openapi+json',
      url: `${SITE_URL}/.well-known/openapi.json`,
      representativeQueries: [
        'request schema for the Dawer password grant',
        'response fields of /api/public/plans',
      ],
    },
    {
      identifier: 'urn:air:dawer.tn:docs:llms-txt',
      displayName: 'Dawer llms.txt agent guide',
      type: 'text/plain',
      url: `${SITE_URL}/llms.txt`,
      representativeQueries: [
        'French/English description of the Dawer product',
        'contact details of the Dawer team',
      ],
    },
    {
      identifier: 'urn:air:dawer.tn:auth:auth-md',
      displayName: 'Dawer agent authentication guide (auth.md)',
      type: 'text/markdown',
      url: `${SITE_URL}/auth.md`,
      representativeQueries: [
        'how to register as a merchant via the API',
        'how to obtain a Bearer token for Dawer',
      ],
    },
    {
      identifier: 'urn:air:dawer.tn:skill:dawer-api',
      displayName: 'Dawer API agent skill',
      type: 'text/markdown',
      url: SKILL_URL,
      representativeQueries: [
        'install a skill that explains Dawer API authentication',
        'step-by-step recipe to automate a merchant account on Dawer',
      ],
    },
  ],
};

/**
 * Dispatch for every `.well-known` path the asset layer must not claim
 * (run_worker_first). The RFC 8414 document keeps its own handler in
 * routes/oauth.ts: it owns the secret-free issuer constants and the tests.
 */
export async function handleAgentDiscoveryRoute(request: Request, _env: Env): Promise<Response> {
  if (request.method !== 'GET') return errorResponse('Method not allowed.', 405);

  switch (new URL(request.url).pathname) {
    case '/.well-known/api-catalog':
      return typedJson(apiCatalog, 200, 'application/linkset+json; charset=utf-8');
    case '/.well-known/openapi.json':
      return typedJson(openApiDocument, 200, 'application/vnd.oai.openapi+json; charset=utf-8');
    case '/.well-known/oauth-protected-resource':
      return typedJson(protectedResourceMetadata, 200, 'application/json; charset=utf-8');
    case '/.well-known/mcp/server-card.json':
      return typedJson(mcpServerCard, 200, 'application/json; charset=utf-8');
    // Wide-open CORS is the ARD spec requirement and safe by design: the file
    // is public read-only metadata (same stance as the Server Card SEP).
    case '/.well-known/ai-catalog.json':
      return typedJson(aiCatalog, 200, 'application/json; charset=utf-8', {
        'access-control-allow-origin': '*',
      });
    case '/.well-known/agent-skills/index.json':
      return typedJson(await buildSkillsIndex(), 200, 'application/json; charset=utf-8');
    case `/.well-known/agent-skills/${SKILL_NAME}/SKILL.md`:
      return new Response(SKILL_MD, {
        status: 200,
        headers: { 'content-type': 'text/markdown; charset=utf-8' },
      });
    default:
      return errorResponse('Route not found.', 404);
  }
}

/**
 * Combined `/.well-known` mount: RFC 8414 first, then the agent-discovery
 * documents, then a plain 404 (the express 404 catch-all would answer
 * `<success:false>` JSON with the API envelope instead).
 */
export async function handleWellKnownRoute(request: Request, env: Env): Promise<Response> {
  if (new URL(request.url).pathname === '/.well-known/oauth-authorization-server') {
    return handleOauthDiscoveryRoute(request, env);
  }
  return handleAgentDiscoveryRoute(request, env);
}
