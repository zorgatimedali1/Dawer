# WhatsApp Web Broadcast Gateway

Standalone Node.js service that holds the active **WhatsApp Web** session and
slowly drips broadcast messages in the background (12–25 s random delay per
message) so the Cloudflare Worker can instantly release the dashboard.

It is intentionally **separate from the main app**: no workspace links, no
shared dependencies, no customer-facing QR codes touched (the wheel/scan-to-win
QR feature lives entirely in the main app).

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | — | Liveness for uptime monitors |
| GET | `/pair?key=GATEWAY_SECRET` | secret in URL | Shows the WhatsApp pairing QR (operator only) |
| POST | `/api/broadcast-pool` | `Authorization: Bearer GATEWAY_SECRET` | Queue a broadcast `{campaignId, recipients:[{name?, phone, prize?}], message?}` → `202` immediately |
| POST | `/api/broadcast-pool/:campaignId/cancel` | bearer | Cancel a queued/running campaign |
| GET | `/api/status` | bearer | `{state, qr, queueDepth, currentJob}` |

Progress is pushed back to the Worker (`POST {WORKER_URL}/api/whatsapp-web/internal/progress`
with `X-Callback-Secret: WHATSAPP_WEB_CALLBACK_SECRET`) after every message and
at job completion. Callback failures never stop the send loop.

## Local run

```bash
cd whatsapp-saas-backend
npm install
cp .env.example .env        # fill in the three secrets
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # generate secrets
npm start                   # then open http://localhost:3000/pair?key=<GATEWAY_SECRET>
```

Scan the QR with WhatsApp → Linked devices → Link a device. The session is
stored under `./data` (`LocalAuth`) and survives restarts when `./data` is on a
persistent volume.

## Deploy (free tier)

### Render
1. New → Blueprint → point at this folder (`render.yaml` included).
2. Set `GATEWAY_SECRET`, `WORKER_URL`, `WHATSAPP_WEB_CALLBACK_SECRET` (Render env vars).
3. Deploy, then open `https://<your-service>.onrender.com/pair?key=<GATEWAY_SECRET>` and scan.
4. **Free plan has no persistent disk** — the session is lost on redeploy, so
   re-scan the QR after every deploy. On a Starter plan, uncomment the `disk`
   block in `render.yaml` to keep the session (`/app/data`).

### Railway
1. New project → Deploy from GitHub/local → Dockerfile detected.
2. Add a **volume** mounted at `/app/data` (keeps the session).
3. Set the three env vars; after deploy open `/pair?key=…` and scan.

### VPS (most reliable)
```bash
sudo apt install docker.io && git clone <this folder>
docker build -t whatsapp-gateway .
docker run -d --restart unless-stopped -p 3000:3000 \
  -v $PWD/data:/app/data \
  -e GATEWAY_SECRET=... -e WORKER_URL=... -e WHATSAPP_WEB_CALLBACK_SECRET=... \
  whatsapp-gateway
```

**Resources:** headless Chromium needs ~512 MB–1 GB RAM. Render free (512 MB)
can OOM under load; Railway or a 1 GB VPS is safer.

## Wire it to the Worker

In the Cloudflare dashboard (or `wrangler secret put`, one per secret):

- `GATEWAY_URL` = `https://<your-service>.onrender.com`
- `GATEWAY_SECRET` = same value as here
- `WHATSAPP_WEB_CALLBACK_SECRET` = same value as here

## Operational requirements (keep the number alive)

1. **Two-way activity warmup** — pair the owner's *main* business number (not a
   blank burner SIM) that already has human incoming/outgoing chat history.
   Ramp up: first week max 20–30 messages/day before any bulk broadcast.
2. **Space out campaigns** — never dump the monthly quota in one click on the
   last day of the month. Push broadcasts weekly (e.g. 50 every Friday night).
   The drizzler already randomizes 12–25 s between messages; respect it.
3. **Business hours** — schedule sends for daytime in the customers' timezone.
4. **Unofficial client risk** — `whatsapp-web.js` automates WhatsApp Web outside
   Meta's official API; bulk misuse can get the number banned. The warmup and
   spacing rules above exist for exactly that reason. Use one session at a time
   and stop immediately if WhatsApp shows a "this phone number is banned"
   message.
