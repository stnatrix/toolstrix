---
name: toolstrix
description: Comprehensive knowledge base, architecture, and operational runbook for toolstrix 2.0 on Frankfurt VPS (tools.stnatrix.space, port 8098, cgroups v2, nginx, yt-dlp).
---

# Toolstrix 2.0 Development & Maintenance

## 1. Server Access and Port Invariants
* **SSH Connection**: `ssh vps` (Frankfurt VPS, Debian 12, 1 vCPU / 1GB RAM).
* **Port Safety**: VPN service **3x-ui** and **Hysteria2** protocol run on this host.
  * *Critical Rule*: **NEVER** interfere with their ports or certificates.
  * Our service `toolstrix` runs on internal port **`8098`** (proxied via Nginx to `tools.stnatrix.space`).
  * Legacy services `ytdlp-web` (port 8099) and `vps-watchdog` are decommissioned and disabled.
  * Instant rollback to port 8099 is preserved via `/opt/toolstrix/deploy/rollback.sh`.

## 2. Server Paths and Units
* Working directory: `/opt/toolstrix/`
* Systemd service: `/etc/systemd/system/toolstrix.service`
* Update service/timer: `/etc/systemd/system/toolstrix-update.service`, `/etc/systemd/system/toolstrix-update.timer` (runs daily at 04:00 UTC)
* Nginx virtualhost: `/etc/nginx/sites-available/toolstrix.conf` (symlinked into `sites-enabled/`)
* System user: `ytdlpweb` (unprivileged, `/usr/sbin/nologin`)
* Temporary download dir: `/tmp/toolstrix` (strictly owned by `ytdlpweb:ytdlpweb`)

## 3. Resource Constraints & Linux cgroups v2
* **Memory Limits**: `MemoryHigh=350M`, `MemoryMax=450M`, `CPUQuota=70%`.
  * *Important*: Linux cgroups v2 includes file Page Cache in `memory.current`. When ffmpeg/yt-dlp writes large remuxed video files to `/tmp`, page cache fills the limit. `MemoryHigh` forces kernel page cache reclamation without triggering swap or OOM kills.
* **yt-dlp Buffer Constraints**: Always pass `--buffer-size 16K`, `--http-chunk-size 10M`, and `-threads 1` to keep resident memory footprint under 150MB.

## 4. Architecture & Security Invariants
* **Single Responsibility**: Dedicated yt-dlp downloader. No extra modules, clutter, or tabs.
* **Subprocess Execution**: Downloads run strictly in an isolated subprocess (`asyncio.create_subprocess_exec`), never in a thread. Timeouts and aborts send `SIGKILL` to ensure ffmpeg terminates and the semaphore releases in `finally`.
* **Asynchronous Jobs**: `POST /api/jobs` -> poll `GET /api/jobs/{id}` -> download `GET /api/jobs/{id}/file` to eliminate Cloudflare 524 timeouts.
* **Zero Persistent Storage**: Media files stream to client and are deleted immediately in a FastAPI `BackgroundTask`.
* **Authentication**: Secret key in `config.toml`, HMAC comparison, IP rate limiting (via `CF-Connecting-IP`), session token bound to key hash.
* **Reverse Proxy Real IP**: Nginx trusts only Cloudflare CIDRs for `CF-Connecting-IP`. `/health` is blocked from public access (HTTP 403) and accessible only on `127.0.0.1`.
* **Concurrency**: Strictly 1 concurrent active download semaphore to prevent memory exhaustion on 1GB RAM.

## 5. Deployment & Local Shell Gotchas
* **PowerShell Binary Streaming**: Do not pipe binary tarballs through Windows PowerShell (`tar -czf - | ssh ...`) as PowerShell corrupts stdout byte streams. Always write a tarball to disk, transfer via `scp` or `rsync`, then extract.
* **Git Credential Manager & SOCKS5**: Git Credential Manager on Windows fails with `The ServicePointManager does not support proxies with the socks5 scheme`. If proxy is required, use HTTP scheme or personal access token URL.
