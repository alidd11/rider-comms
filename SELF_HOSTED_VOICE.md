# Self-hosted voice (LiveKit)

Rider Comms voice runs on [LiveKit](https://livekit.io). LiveKit's server is open source, so instead of paying for LiveKit Cloud you can run it on a small rented Linux server (VPS).

The apps never hardcode the voice server. The backend hands out its URL with every voice token. **Switching is a change to three backend settings** (plus one line in the PWA's security policy), and switching back is the same change in reverse.

Everything needed is in `infra/livekit/`:

| File | Purpose |
| --- | --- |
| `docker-compose.yml` | LiveKit server v1.13.7 plus Caddy (automatic HTTPS certificate) |
| `livekit.yaml` | Server config: media ports, TCP fallback, built-in TURN relay, room timeouts |
| `Caddyfile` | Serves `https://` / `wss://` on your domain and forwards to LiveKit |
| `.env.example` | The two values you set on the server |

`scripts/livekit-smoke-test.mjs` checks a server before you switch to it.

The config and smoke test were verified against a real LiveKit v1.13.7 server.

## When to switch

Stay on LiveKit Cloud while its free allowance covers testing: there is nothing to maintain. Switch when usage would start costing real money.

You take on:
- keeping the server up;
- applying updates (bump the image tag);
- watching bandwidth, which is the main cost as you grow.

## What you need

- **A Linux VPS with a public IPv4 address.** 2 vCPU and 2–4 GB RAM is plenty to start (for example Hetzner, DigitalOcean or Vultr). Voice is light: roughly 30–50 kbit/s per speaker per listener.
- **A domain name** you can add a DNS record to, for example `voice.yourdomain.com`.
- **Docker** with the compose plugin on the VPS.

**Railway will not work.** Voice media needs inbound UDP, which Railway only allows inside its private network.

## Setup

1. **DNS.** Create an `A` record pointing `voice.yourdomain.com` at the VPS's IP. Wait until it resolves (`ping voice.yourdomain.com`).

2. **Firewall.** Open these ports on the VPS, in the provider's firewall and in `ufw` if you use it:

   | Port | Protocol | Used for |
   | --- | --- | --- |
   | 80, 443 | TCP | HTTPS certificate and signalling (Caddy) |
   | 7881 | TCP | Media fallback when UDP is blocked |
   | 3478 | UDP | TURN relay |
   | 50000–60000 | UDP | Voice media |
   | 30000–40000 | UDP | TURN relay media |

3. **Copy the files** in `infra/livekit/` to the VPS, for example into `/opt/livekit`.

4. **Create `.env`** next to them from `.env.example`:
   - Set `LIVEKIT_DOMAIN` to your domain.
   - Set `LIVEKIT_KEYS` to a new key and secret. The example file shows a command that generates one.

   Never commit `.env`. The secret lets anyone create voice rooms on your server.

5. **Start it:** `docker compose up -d`, then `docker compose logs -f`. After a few seconds you should see:
   - `starting LiveKit server` from LiveKit;
   - `certificate obtained successfully` from Caddy.

6. **Smoke-test it** from your computer, in this repository:

   ```bash
   LIVEKIT_URL=wss://voice.yourdomain.com \
   LIVEKIT_API_KEY=<key from LIVEKIT_KEYS> \
   LIVEKIT_API_SECRET=<secret from LIVEKIT_KEYS> \
   node scripts/livekit-smoke-test.mjs
   ```

   All three lines must say `OK`. If a line says `FAIL`, it names what to check.

## Switching Rider Comms over

1. **PWA security policy.** In `docs/index.html`, add `https://voice.yourdomain.com` to the `connect-src` list of the Content-Security-Policy.
   - `wss:` is already allowed.
   - LiveKit's browser client also makes an HTTPS check to the server when a connection fails, and without this line the policy blocks it.
   - Merge this change before step 2.

2. **Backend settings.** In Railway, on the `backend` service, set:
   - `LIVEKIT_URL` = `wss://voice.yourdomain.com`
   - `LIVEKIT_API_KEY` = the key
   - `LIVEKIT_API_SECRET` = the secret

   Railway redeploys automatically. Voice calls already in progress on LiveKit Cloud drop, and riders reconnect to the new server on their next token refresh (within about 20 seconds).

3. **Test on two devices:**
   - a private ride with voice;
   - Nearby Voice between two riders in range;
   - one test on mobile data rather than Wi-Fi.

**To roll back,** put the old three values back in Railway.

## Keeping it healthy

- **Updates:** change the `livekit/livekit-server` tag in `docker-compose.yml` to a newer release, then run `docker compose pull && docker compose up -d`. Read LiveKit's release notes first. Caddy renews certificates on its own.
- **Restarts:** both containers restart automatically after a crash or reboot (`restart: unless-stopped`).
- **Bandwidth:** check the provider's bandwidth graph monthly; it's the cost that grows with riders.
- **Limits:**
  - This is one server. One VPS handles a lot of simultaneous small voice rooms, which is Rider Comms' pattern: one room per ride or per pair of nearby riders.
  - Going beyond one server needs Redis and several LiveKit nodes (see LiveKit's "distributed setup" docs).
  - TURN here runs over UDP. If riders on very locked-down networks (some corporate Wi-Fi) can't connect, add TURN over TLS on port 443. LiveKit's official config generator (`docker run --rm -it -v$PWD:/output livekit/generate`) produces that setup.
