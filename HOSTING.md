# Precedent hosting

Current published app: https://precedent.vikhas.com/login

The hosted app accepts username `admin` or the existing administrator email. Its memorable word-based password is in Git-ignored `.data/local-login.env`. Open the HTTPS address for sign-in; production cookies are Secure and the public hostname is configured as the Modelence site URL.

The app uses a persistent Node.js 24 API, a private eve worker, and MongoDB. Cloudflare Tunnel can forward HTTPS traffic to the API without moving these services to Workers. The origin computer must stay online.

## Local account login

For local development, set `NODE_ENV=development`, `AUTH_MODE=modelence` and `MODELENCE_SITE_URL=http://127.0.0.1:4311` in Git-ignored `.env.local`. MongoDB must be configured and available. Run `npm run build`, `npm run server` and the existing private eve worker. Open http://127.0.0.1:4311/login (or the Vite dashboard on port 5173).

Provision accounts with `npm run setup:user` using `PRECEDENT_SETUP_EMAIL`, `PRECEDENT_SETUP_PASSWORD`, `PRECEDENT_SETUP_ROLE=admin` or `employee`, and `PRECEDENT_SETUP_URL=http://127.0.0.1:4311` in ignored environment storage. Remove temporary setup variables after provisioning. Role assignment uses database access and is not a public endpoint. Accounts without assigned roles cannot access the workspace. There is no public signup interface.

For this configured local demo, administrator credentials are saved in `.data/local-login.env` (ignored, owner-readable). Read that file locally; do not commit or share it. Both comparison panes and admin controls use the signed-in account. Existing policy and audit records are retained.

## Cloudflare domain preparation

1. Add your existing domain to Cloudflare and confirm its status is Active.
2. Choose a hostname such as `precedent.example.com`.
3. In Cloudflare Networking → Tunnels, create a remotely managed tunnel and install its connector on the origin computer. Keep its token in ignored secret storage.
4. Before publishing, configure `NODE_ENV=production`, `AUTH_MODE=modelence`, `MODELENCE_SITE_URL=https://precedent.example.com`, MongoDB and live planner settings. Disable `ALLOW_FIXTURE_PLANNER`. Verify account login and administrator access. Secure session cookies require HTTPS in production.
5. After approval to publish, add a Published application route from that hostname to `http://127.0.0.1:4311`. Cloudflare creates the DNS record automatically. The eve worker on port 2000 stays private.
6. Verify HTTPS sign-in, rejected anonymous `/api/state` requests, administrator access, logout, session recovery and a real-model governed prompt. Verify the paired baseline flow too.

Cloudflare skill installation, MCP registration and OAuth authorization are complete. After explicit approval for `precedent.vikhas.com`, created a dedicated remotely managed tunnel named `precedent-app`, its public route and a proxied CNAME. API read-back reports a healthy tunnel with four connections. The existing unrelated tunnel and main-domain DNS were not changed. The new tunnel token is in owner-readable ignored `.data/cloudflare-precedent.token`.

To unpublish, remove the application route/DNS record and stop the tunnel connector. Preserve application data. No service is deployed automatically by building this repository.

Official setup: https://developers.cloudflare.com/tunnel/get-started/

## Running services on this Linux host

The app, private eve worker and tunnel are installed as user systemd services. They are enabled for startup and restart on failure. User lingering is enabled so they continue after logout. The API and worker listen on loopback ports 4311 and 2000; the public route points only to 4311. The worker retains its existing private local runtime; no eve routes are exposed publicly. The server must remain powered on and connected to the Internet.

```sh
systemctl --user status precedent-api precedent-worker precedent-tunnel
journalctl --user -u precedent-api -u precedent-worker -u precedent-tunnel --since "10 minutes ago"
```

Repository templates are in `ops/systemd/`. To reinstall on this host, render the project location before installing them:

```sh
mkdir -p ~/.config/systemd/user
for service in ops/systemd/*.service; do
  sed "s|@PROJECT_ROOT@|$PWD|g" "$service" > ~/.config/systemd/user/"$(basename "$service")"
done
systemctl --user daemon-reload
systemctl --user enable --now precedent-api precedent-worker precedent-tunnel
loginctl enable-linger "$USER"
```

These templates use this checkout's Node 24 at `.tools/node/bin/node` and `/usr/local/bin/cloudflared`. Adjust these paths if moving the repository to another server. Build the web app and eve worker before starting services on a fresh host; retain `.eve/.workflow-data`, `.data`, MongoDB and ignored environment secrets. Configure Atlas network access for a new origin server before switching hosts.

To take the public app offline locally, stop `precedent-tunnel`. To remove publication, remove only the `precedent.vikhas.com` DNS record and this dedicated tunnel route from Cloudflare. Keep other DNS/tunnel resources and persisted policy/audit records intact. A saved local environment backup is in ignored `.data/pre-cloudflare.env.backup`; restoring it is a deliberate switch back to local development, not a requirement for public operation.

Public verification passed: HTTPS sign-in, administrator access, session recovery, logout, anonymous API rejection, Secure/HttpOnly/SameSite=Lax cookies and both real-model internal log search workflows. No fixture planner was available. Policy v9 was retained. Evidence is in ignored `.data/public-host-proof.json`.

Optional `PRECEDENT_LOGIN_ALIASES` maps simple login names to existing account emails, for example `{"admin":"local-demo-admin@precedent.local"}`. The configured mappings are published in `/api/config`; they are convenience identifiers, not secrets or role assignments. Every alias still requires the actual Modelence account password and assigned role. Password rotation was performed through the native reset flow with a short-lived one-use token; prior sessions were revoked and the old password no longer works. No public password-reset interface or email provider was added.
