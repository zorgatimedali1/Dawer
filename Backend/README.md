# CampaignFlow Cloudflare API

The API is an Express.js REST application running on Cloudflare Workers, with D1 persistence and a React + TypeScript SPA served as static assets.

## Features

- Express.js REST API on Cloudflare Workers
- D1 persistence model
- Durable Object coordination for double-click prevention
- Cloudflare rate limiting for API requests
- Short-lived caching for public campaign details
- OAuth-ready Google auth flow
- Secure password hashing and session checks
- Public campaign participation endpoint
- Modular route structure

## Local development

```bash
npm install
npm run typecheck
npm test
npm run dev
```

`npm run dev` starts the React SPA and Worker API through Vite. The Worker uses the remote `campaignflow` D1 database, so API mutations are real Cloudflare data. The UI currently persists authentication against the API; other dashboard feature data is still under migration.

## Deployment

Build and deploy the SPA and API together from the repository root:

```bash
npm run deploy
```

Cloudflare secrets such as OAuth client credentials must be configured with Wrangler secrets before enabling those integrations.

## Google Places suggestions

The wheel editor uses Places API (New) Autocomplete, restricted to restaurants in Tunisia. Enable Places API (New) with billing in Google Cloud, create a server-side key restricted to Places API (New), then configure it without committing the key:

```bash
# Local development: put GOOGLE_MAPS_API_KEY in the root .dev.vars file
# Cloudflare deployment:
npx wrangler secret put GOOGLE_MAPS_API_KEY
```

`.dev.vars.example` shows the local variable name. The browser only calls this Worker's `/api/places/autocomplete` endpoint; the Google key stays server-side. Place suggestions are not cached. Without the secret, the editor displays an unavailable message and still allows a manual store-name or Maps URL.

## Cloudflare D1

The `campaignflow` D1 database is configured as the `DB` binding, and `Backend/src/db/schema.sql` has been applied to it. Apply future schema changes with versioned D1 migrations rather than editing production tables manually.

To apply the schema again or inspect the live database:

```bash
npx wrangler d1 execute campaignflow --remote --file=Backend/src/db/schema.sql
npx wrangler d1 execute campaignflow --remote --command="SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name"
```
