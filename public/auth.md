# auth.md

You are an agent. Dawer supports **agentic registration**: discover → register → exchange for an access_token → call API → revoke when done. Follow the steps in order.

Dawer is a gamified customer-acquisition platform for shops, restaurants and cafés in Tunisia: merchants install an interactive fortune wheel in their venue, customers play, share contact details and win a reward delivered by WhatsApp or e-mail, and the merchant markets to every participant later from the same console.

An agent acting here ALWAYS represents a real merchant operator: Dawer will not mint credentials to a principal without a human behind it. The supported archetype is **anonymous claim-ceremony registration**: the agent stages an UNOWNED machine identity, the human merchant claims ownership by signing in once with the issued credentials.

## Step 1 — Discover

```http
GET /.well-known/oauth-protected-resource
```

```json
{
  "resource": "https://dawer.tn/",
  "authorization_servers": ["https://dawer.tn"],
  "scopes_supported": ["api"],
  "bearer_methods_supported": ["header"],
  "resource_documentation": "https://dawer.tn/llms.txt"
}
```

`authorization_servers` points at this very origin — the RFC 8414 metadata there lists the `agent_auth` block (`register_uri`, `identity_endpoint`, `identity_types_supported: ["anonymous"]`, `claim_uri`, `revocation_uri`).

## Step 2 — Pick a method

| Identity type | Credential type | Status |
| --- | --- | --- |
| anonymous claim ceremony (`{"type": "anonymous"}` → `email_password_pair`) | `email_password_pair` | **supported** |

No third-party ID-JAG / verified-email assertion acceptance exists (Dawer does not trust external provider signatures yet).

## Step 3 — Register (anonymous)

```http
POST /api/agent/identity
Content-Type: application/json

{"type": "anonymous"}
```

- `200` → an UNOWNED machine identity is created: no business, no plan, e-mail campaigns disabled until the owner verifies an e-mail. The body contains a one-time credential pair:

```json
{
  "registration_id": "reg_…",
  "registration_type": "anonymous",
  "credentials": { "username": "agent-<id>@agents.dawer.tn", "password": "Anon_…" },
  "pre_claim_scopes": ["api"],
  "post_claim_scopes": ["api"],
  "token_endpoint": "https://dawer.tn/api/oauth/token",
  "claim_url": "https://dawer.tn/auth/login",
  "revocation_uri": "https://dawer.tn/api/auth/logout"
}
```

The credentials are disclosed exactly once — store them; a repeat call stages a NEW identity.

- Rate limit: the same tight auth bucket as `/api/auth` (20 requests/min/IP, fail-closed).

Alternative for an agent ALREADY holding real merchant credentials (operator-managed onboarding, browser-assisted signup endpoint):

```json
POST /api/auth/register {"email": "...", "password": "...", "firstName": "...", "lastName": "...", "businessName": "(optional)"}
```

That route creates an OWNED account (and optionally a business tenant starting the Starter trial).

## Step 4 — Exchange credentials for an access token

RFC 6749 §4.3 password grant — form-encoded, no cookies, no CAPTCHA, token in the JSON body:

```http
POST /api/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=password&username=agent-<id>@agents.dawer.tn&password=Anon_…
```

```json
{ "access_token": "cf_…", "token_type": "Bearer", "expires_in": 259200, "scope": "api" }
```

- Opaque token, 3-day lifetime, single `api` scope = the account's full access (flat scope model).
- Five consecutive wrong passwords freeze the account for 15 minutes. Do not retry-loop.

## Step 5 — Call the API

```http
GET /api/settings/…
Authorization: Bearer <access_token>
```

Protected endpoints consume the bearer header (full route list: `/.well-known/openapi.json`, cataloged at `/.well-known/api-catalog`). Public endpoints needing NO token: `GET /api/public/plans`, `GET /api/public/partners`, `GET /health`.

## Step 6 — Claim (human step) and revoke

- **Claim:** surface `claim_url` to the merchant with the credentials; they sign in once at `https://dawer.tn/auth/login`, land on the claim surface, and the account becomes theirs (the first sign-in starts the Starter trial; the operator can then change the e-mail/password from dashboard settings).
- **Revoke:** `POST /api/auth/logout` with the bearer header — idempotent `revocation_uri`.

## Errors

| Code | Where | What to do |
| --- | --- | --- |
| `invalid_request` | `/api/oauth/token` | Fix the form-encoded body. |
| `unsupported_grant_type` | `/api/oauth/token` | Only `grant_type=password`. |
| `invalid_grant` | `/api/oauth/token` | Wrong credentials or frozen account (429). Stop; contact the operator. |
| `Validation failed.` / `Route not found.` | `/api/agent/identity` | Check `type` is the literal string `anonymous`. |

Retry policy: 5xx → back off and retry; 4xx → do not retry the same payload.

## Discovery index

| Document | URL |
| --- | --- |
| Protected-resource metadata (RFC 9728) | `/.well-known/oauth-protected-resource` |
| Authorization-server metadata (RFC 8414, with `agent_auth`) | `/.well-known/oauth-authorization-server` |
| API catalog (RFC 9727) | `/.well-known/api-catalog` |
| OpenAPI description | `/.well-known/openapi.json` |
| Agent skills index | `/.well-known/agent-skills/index.json` |
| ARD capability manifest | `/.well-known/ai-catalog.json` |
| MCP server (public read-only tools) | `/mcp` (card: `/.well-known/mcp/server-card.json`) |
| Agent guide | `/llms.txt` |
