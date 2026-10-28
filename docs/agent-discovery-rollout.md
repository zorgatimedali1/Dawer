# Agent-discovery rollout — items that live outside the code

This repo ships the code-side half of the agent-discovery checklist (RFC 8288 Link
headers, RFC 9727 API catalog, RFC 9728 protected-resource metadata, `/auth.md`,
MCP server + Server Card, Agent Skills index, ARD manifest, WebMCP browser tools).
Two checks can only be fixed in the **Cloudflare zone / DNS**, not in the Workers
codebase. Do these once per zone in the dashboard (or via the API), then re-run the
`isitagentready` scan against `https://dawer.tn`.

## 1. Markdown for Agents (Content-Type: text/markdown on HTML pages)

This is a Cloudflare edge feature (`content_converter` zone setting). It converts
the served HTML to Markdown on the fly when the client sends `Accept: text/markdown`
— no code change needed, and `Vary: Accept` is handled by the network.

Requirements: a **Pro, Business or Enterprise** plan on zone `dawer.tn`.

Dashboard: zone `dawer.tn` → **AI Crawl Control** → toggle **Markdown for Agents**.

API equivalent (create a token with *Zone Settings: Edit*):

```
curl -X PATCH 'https://api.cloudflare.com/client/v4/zones/<zone_tag>/settings/content_converter' \
  --header 'Content-Type: application/json' \
  --header "Authorization: Bearer <api_token>" \
  --data-raw '{"value": "on"}'
```

Scoping it to just `dawer.tn` pages (e.g. skip admin.dawer.tn) is unnecessary —
`admin.dawer.tn` is a separate zone/zhost? (it is a dashboard-attached custom domain
on the same account zone, so the zone toggle covers the merchant site only if the
zones are separate; verify in the dashboard). Local checks before/after:

```
curl -H "Accept: text/markdown" https://dawer.tn/ | head
# expect: HTTP 200, content-type: text/markdown; charset=utf-8
```

## 2. DNS for AI Discovery (DNS-AID) — SVCB records under `_agents.dawer.tn`

Publish these records in the Cloudflare DNS panel for `dawer.tn` (proxied DNS API
records are named-record type `SVCB` as plain records — created **unproxied**,
"DNS only", because discovery resolvers must see raw record data):

- Entrypoint index advertising the discovery tree:

```
_index._agents.dawer.tn  3600  IN  HTTPS  1  .  alpn="https" port=443 mandatory=alpn,port key9999=...?   (see variant below)
```

The `isitagentready` scanner accepts either of the two shapes below:

Shape A — index record pointing at the ARD/agent-discovery namespace:

```
_index._agents.dawer.tn.  3600 IN SVCB 1 takeme._agents.dawer.tn. alpn="https" port=443
```

Shape B — per-protocol records (MCP carried via the experimental `keyNNNNN`
parameter until the DNS-AID draft registers them):

```
_mcp._agents.dawer.tn.  3600 IN SVCB 1 dawer.tn. alpn="https" port=443 mandatory=alpn,port key0001=https://dawer.tn/mcp
_a2a._agents.dawer.tn.  3600 IN SVCB 1 dawer.tn. alpn="https" port=443 mandatory=alpn,port key0002=https://dawer.tn/.well-known/ai-catalog.json
```

Minimum viable answer to the scanner check — the index entry point:

```
_index._agents.dawer.tn.  3600 IN SVCB 1 dawer.tn. alpn="https" port=443
```

Notes:

- The zone MUST also be signed: enable **DNSSEC** for `dawer.tn` (Cloudflare
  DNS panel → DNS → Settings → Enable (yellow cloud off records stay raw);
  signed responses let validating resolvers return authenticated data, which is
  the DNS-AID VISIBLY REQUIRED part of the check).
- Use `HTTPS` instead of `SVCB` when the target is an HTTPS endpoint — the
  above `SVCB` records carry `alpn="https"` so both are accepted.
- Verify with DoH (what the scanner uses):

```
curl 'https://cloudflare-dns.com/dns-query?name=_index._agents.dawer.tn&type=SVCB' \
  -H 'accept: application/dns-json'
```

Optional extras the scanner reports on (never fails on): `Agentmap:` robots.txt
directive (already shipped) and `<link rel="ai-catalog">` in HTML (already shipped
in `index.html`). The `_catalog._agents` TXT record and `_search._agents` SRV
record are nice-to-haves once the ARD manifest goes live.

## Checklist after wiring the zone

1. DNSSEC enabled for `dawer.tn` (green "signed" in the DNS panel).
2. `_index._agents.dawer.tn` SVCB record returns via DoH with `AD` flag.
3. `curl -H "Accept: text/markdown" https://dawer.tn/` returns markdown.
4. Re-scan: `POST https://isitagentready.com/api/scan {"url": "https://dawer.tn"}` —
   expect `checks.discovery.*` and `checks.discovery.dnsAid`/`markdown` passes.
