---
name: stnatrix.space
description: Instructions for developing, deploying, and maintaining toolstrix 2.0 on Frankfurt VPS
---

# Toolstrix 2.0 Development & Maintenance

## 1. Server Access and Port Invariants
* **SSH Connection**: `ssh vps` (Frankfurt VPS, Debian 12, 1 vCPU / 1GB RAM).
* **Port Safety**: VPN service **3x-ui** and **Hysteria2** protocol run on this host.
  * *Critical Rule*: **NEVER** interfere with their ports or certificates.
  * Our service `toolstrix` runs on internal port **`8098`** (proxied via Nginx to `tools.stnatrix.space`).
  * Staging and atomic cutover: `toolstrix.service` (8098) operates independently from legacy `ytdlp-web` (8099).

## 2. Server Paths and Units
* Working directory: `/opt/toolstrix/`
* Systemd service: `/etc/systemd/system/toolstrix.service`
* Update service/timer: `/etc/systemd/system/toolstrix-update.service`, `/etc/systemd/system/toolstrix-update.timer`
* Nginx virtualhost: `/etc/nginx/sites-available/toolstrix.conf` (symlinked into `sites-enabled/`)
* System user: `ytdlpweb` (unprivileged, `/usr/sbin/nologin`)
* Resource constraints: `MemoryMax=350M`, `CPUQuota=70%`, `PrivateTmp=true`, `ProtectSystem=strict`

## 3. Architecture & Invariants
* **Single Responsibility**: Dedicated yt-dlp downloader. No extra modules or tabs.
* **Asynchronous Jobs**: Downloads use `POST /api/jobs` -> poll `GET /api/jobs/{id}` -> download `GET /api/jobs/{id}/file` to eliminate Cloudflare 524 timeouts.
* **No File Storage**: Temporary session files are strictly deleted immediately after client streaming (`BackgroundTask`) and through hourly stale sweep.
* **Authentication**: Secret key in `config.toml`, HMAC comparison, IP rate limiting (via `CF-Connecting-IP`), signed session cookie bound to key hash.
* **Concurrency**: Strictly 1 concurrent active download semaphore on the server to prevent OOM on 1GB RAM.
