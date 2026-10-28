# auth.md — Dawer merchant API authentication

Authors should use this file to let automated agents register on Dawer. Dawer is a
gamified customer-acquisition platform for shops, restaurants and cafés in Tunisia:
merchants install an in-store interactive fortune wheel, customers play and win a
reward delivered by WhatsApp or e-mail, and every participant becomes a dashboard
lead the merchant can market to later.

**Agent audience:** platforms acting *on behalf of a real merchant operator*
(personal representatives of the merchant, their credentials and responsibilities).
Dawer does not sell to a machine account without a human principal behind it.

**Self-selection of plans:** authentication is user-managed, no invitation or
manual provisioning process is required.

## 1. Register a merchant account

```
POST https://dawer.tn/api/auth/register
Content-Type: application/json

{
  "email": "merchant@example.tn",
  "password": "at-least-8-chars",
  "firstName": "First",
  "lastName": "Last",
  "businessName": "My shop (optional)"
}
```

- Response `200`: `{"success": true, "user": {...}}` (plus an HttpOnly session
  cookie for browsers — non-browser clients can ignore it).
- `businessName` with ≥ 2 and ≤ 120 characters creates a business (tenant) and
  starts a free Starter trial. Multi-tenant operators use this per shop.
- The e-mail is NOT verified on registration; e-mail campaigns are restricted
  until verification. Registered e-mail + password stay the credential pair.
- Rate limits: 20 requests/min/IP in the dedicated `AUTH_RATE_LIMITER` bucket.

## 2. Exchange credentials for an access token

`POST /api/oauth/token` with the RFC 6749 §4.3 password grant — form-encoded,
no cookies, no CAPTCHA, and the token lands in the JSON body (deliberate
reversal of the P1-1 cookie-only rule for the interactive login):

```
POST https://dawer.tn/api/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=password&username=merchant@example.tn&password=at-least-8-chars
```

Response `200`:

```json
{
  "access_token": "cf_<random>.<random>",
  "token_type": "Bearer",
  "expires_in": 259200,
  "scope": "api"
}
```

- Opaque token, 3-day lifetime, single `api` scope (full operator access, flat
  scope model — there is no reduced/agent sub-scope; no JWT is issued, so no
  jwks_uri exists).
- Five consecutive wrong passwords freeze the account for 15 minutes: prefer
  reading this document again over retry loops.

## 3. Call the API

```
Authorization: Bearer <access_token>
```

on every `/api/*` JSON endpoint. No-auth public endpoints: `GET /api/public/plans`
(pricing), `GET /api/public/partners` (partner marquee), `GET /health`.

Revoke a token when you are done: `POST /api/auth/logout` with the bearer header.

## 4. Discovery surface

| Document | URL |
| --- | --- |
| Protected-resource metadata (RFC 9728) | `/.well-known/oauth-protected-resource` |
| Authorization-server metadata (RFC 8414, with `agent_auth`) | `/.well-known/oauth-authorization-server` |
| API catalog (RFC 9727) | `/.well-known/api-catalog` |
| OpenAPI description | `/.well-known/openapi.json` |
| Agent guides | `/llms.txt`, `/.well-known/agent-skills/index.json` |
| MCP server (public read-only tools) | `/mcp` (see `/.well-known/mcp/server-card.json`) |

Every token follows an operator-owned merchant account: an agent acting for a
merchant uses that merchant's credentials, and acts with the merchant's full
rights and responsibility.
