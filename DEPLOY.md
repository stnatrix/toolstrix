# Deployment Guide — toolstrix 2.0

Target: Frankfurt VPS (Debian 12, 1 vCPU / 1GB RAM) behind Cloudflare.

---

## Port Invariants

- **Do NOT touch**:
  - `3x-ui` and `Hysteria2` listening ports or SSL certificates.
  - Existing configurations in `/etc/nginx/sites-enabled/` unrelated to this project.
- **toolstrix 2.0 is assigned to internal port `8098`**.
  - Legacy `ytdlp-web` runs on `8099` and remains untouched during staging.

---

## 1. Staging Deployment

From your local machine or terminal:

```bash
chmod +x deploy/*.sh
./deploy/deploy.sh staging
```

This performs the following actions on `vps`:
1. Synchronizes project files to `/opt/toolstrix/` (excluding local `.venv`, `config.toml`, `.git`).
2. Configures the dedicated virtualenv `/opt/toolstrix/venv/` and installs requirements.
3. Generates `/opt/toolstrix/config.toml` with random secrets if it does not yet exist.
4. Installs and starts `toolstrix.service` on internal port `8098`.
5. Installs the daily updater timer `toolstrix-update.timer` (runs at 04:00 UTC).
6. Verifies service health via `curl http://127.0.0.1:8098/health`.

---

## 2. Testing Staging via SSH Tunnel

Before switching public traffic, test toolstrix 2.0 in your local browser through an SSH tunnel:

```bash
ssh -L 8098:127.0.0.1:8098 vps
```

Open `http://127.0.0.1:8098/` in your browser.
Log in using the `secret_key` generated in `/opt/toolstrix/config.toml`.
Verify URL probing, format selection, and a test download.

---

## 3. Atomic Production Cutover

When verified, execute the cutover:

```bash
./deploy/deploy.sh swap
```

This will:
1. Re-check the health of the staging service on port `8098`.
2. Copy `deploy/nginx.conf` to `/etc/nginx/sites-available/toolstrix.conf`.
3. Atomically remove `/etc/nginx/sites-enabled/ytdlp-web.conf` and create the `toolstrix.conf` symlink.
4. Run `nginx -t` to validate configuration syntax.
5. Reload Nginx (`systemctl reload nginx`) without interrupting other services.
6. Stop and disable the legacy `ytdlp-web` service.

---

## 4. Rollback (Instant)

If an unforeseen issue occurs after cutover:

```bash
./deploy/rollback.sh
```

This immediately restores the Nginx symlink to `/etc/nginx/sites-available/ytdlp-web.conf` (port 8099), validates syntax, reloads Nginx, and restarts `ytdlp-web`.

---

## 5. Automated Updates

The systemd timer `/etc/systemd/system/toolstrix-update.timer` runs `/opt/toolstrix/deploy/update-ytdlp.sh` daily at 04:00.

The script:
1. Verifies that `active_jobs == 0` via `/health`. If a download is running, the update is deferred.
2. Updates yt-dlp to the latest release (`pip install -U --pre "yt-dlp[default]"`).
3. Executes a smoke test on a known test link.
4. If the smoke test passes: records status to `/opt/toolstrix/updater_status.json` and restarts `toolstrix`.
5. If the smoke test fails: automatically rolls back to the previous version and logs the error.
