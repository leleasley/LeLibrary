---
name: Self-Hosted Issue/Request
about: Report a problem or request a feature for a self-hosted LeLibrary instance
title: '[Self-Hosted] '
labels: self-hosted
assignees: ''

---

**Deployment setup**
- **Method:** [e.g., Docker Compose / bare Node / VPS / NAS]
- **Reverse proxy:** [e.g., Caddy / Nginx / Cloudflare Tunnel / none]
- **TLS:** [e.g., HTTPS via Caddy / HTTP only]
- **Install source:** [e.g., latest `main` from GitHub / `docker pull` / custom build]
- **Database:** [e.g., Postgres via compose db service / token-only mode (no DB)]
- **Accounts enabled:** [e.g., No / Yes (sign-in, saved keys)]

**Describe the issue or request**
A clear and concise description of what you're experiencing or want.

**What have you already checked?**
- [ ] Port 7860 is reachable and `/health` responds
- [ ] Outbound internet works from the container/host (e.g., `wget https://api.torbox.app`)
- [ ] Reverse proxy routes the full app, not just the configure page (all `/api/*` and `/:token/*` paths)
- [ ] No conflicting environment variables in `.env`
- [ ] Checked `docker compose logs` / server logs for errors

**Relevant logs**
```
Paste any error logs from the server or Docker logs here. Redact API keys/tokens first.
```

**Additional context**
Add any other context or screenshots about the issue/request here.
