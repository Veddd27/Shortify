# Stage 8 — Cloud Deployment

**Date:** 2026-08-23
**Live at:** http://16.171.239.92:3000

## Architecture

Everything — Postgres, Redis, and the Node app — runs on a single **EC2 `t3.micro`** instance (Amazon Linux 2023, `eu-north-1`/Stockholm), the same shape as the local development setup, just moved onto a rented server instead of a laptop.

This was a deliberate simplification, not the original plan. Initial work went down the path of separate managed services — RDS (Postgres) and ElastiCache (Redis) — which is the more "production-realistic" pattern and was even partially built (an RDS instance and an ElastiCache cluster were both created). Mid-setup, the number of AWS concepts stacking up (VPCs, multiple security groups, subnet groups, cross-service linking) started outweighing the value for a first-ever cloud deployment, so the decision was made to simplify: one server, everything self-hosted, same as local. The RDS/ElastiCache resources were deleted. Splitting the database and cache back out into managed services is a legitimate future step, deferred deliberately rather than abandoned.

## What's running

| Component | Version | How |
|---|---|---|
| Node.js | 22.23.2 | `dnf install nodejs22` |
| PostgreSQL | 15.18 | `dnf install postgresql15-server`, self-hosted |
| Redis | 6.2.20 | `dnf install redis6`, self-hosted |
| App process | — | `pm2`, auto-restarts on crash, auto-starts on reboot (`pm2 startup systemd`) |

## Security groups

- **SSH (22)**: restricted to the developer's own IP.
- **HTTP/app (3000)**: open to the public (`0.0.0.0/0`) — this is the actual app traffic.
- Database and Redis are not exposed at all — both only accept connections from `localhost`, since they run on the same machine as the app and nothing else needs to reach them.

## Real problems hit during deployment (and the actual fixes)

1. **Windows SSH key permissions**: Git Bash's `chmod 400` on the `.pem` key doesn't affect the real Windows ACLs that PowerShell's native OpenSSH client checks. Fixed with:
   ```powershell
   icacls key.pem /inheritance:r
   icacls key.pem /grant:r "$env:USERNAME:(R)"
   ```
2. **Postgres auth rejected with "Ident authentication failed"**: Amazon Linux's Postgres package defaults `pg_hba.conf` to `ident` auth for host (TCP) connections — checks your OS username instead of a password, which breaks a normal app connection. Fixed by changing those lines to `scram-sha-256` (password auth) and restarting the service.
3. **Private GitHub repo couldn't be cloned onto the server**: `git clone` over HTTPS needs credentials for a private repo. Since this is a public resume project anyway, made the repo public rather than setting up a deploy key — removes the need for any credentials on the server entirely.

## What's deliberately not done yet

- No reverse proxy / port 80 — the app is reached directly on port 3000. Adding nginx (or similar) to front it on port 80 with a real domain is a reasonable future polish step.
- No HTTPS/TLS.
- No managed database/cache (see Architecture above) — planned as a later, explicit refinement.
- No CI/CD — deployment so far is manual (`git pull` + `pm2 restart` on the server). Automating this (GitHub Actions) is natural follow-up work.

These aren't oversights — they're the next honest layer of "what would make this more production-like," left for when it's time to add them deliberately.
