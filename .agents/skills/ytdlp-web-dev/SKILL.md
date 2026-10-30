---
name: toolstrix
description: Comprehensive knowledge base, architecture, and operational runbook for toolstrix 2.0 on Frankfurt VPS (tools.stnatrix.space, port 8098, cgroups v2, nginx, yt-dlp).
---

# Toolstrix 2.0 & VPS Ecosystem Runbook

## 0. Current Project Status
* **toolstrix 2.0**: Live and fully operational at `https://tools.stnatrix.space` (port 8098, cgroups v2 memory bounds 350M/450M, isolated subprocess downloader).
* **stnatrix.space Portfolio**: Live at `https://stnatrix.space` (and `www.stnatrix.space`), central hub linking to all active projects (`toolstrix` and `ahktrix`), served directly by Nginx from `/var/www/sites/stnatrix`.
* **ahktrix Passport**: Co-hosted static landing page at `https://ahk.stnatrix.space` served by Nginx from `/var/www/sites/ahktrix` with zero runtime memory footprint.
* **Local Workspace Structure**:
  * `vps/`: Core toolstrix backend, frontend (`web/`), systemd services, and deploy configs (`stnatrix/toolstrix.git`).
  * `vps/sites/`: Local staging directory for satellite static sites:
    * `sites/stnatrix-space/`: Portfolio hub (`stnatrix.space`)
    * `sites/ahktrix-passport/`: ahktrix landing page (`ahk.stnatrix.space`)
  Strictly ignored in `vps/.gitignore` (`/sites/`) to keep toolstrix repository clean.
* **Design System Invariant**: 1:1 visual identity across apps — compact 480px cards, dark theme (`#141312` page, `#1d1b19` card, `#25221f` tiles, `#d49b6a` accent), local Nunito fonts (no Google trackers), and low muffled clicks via Web Audio API.
* **Git Status**: Fully cleaned history with verified identity `stnatrix <natrix852@gmail.com>`. All commits properly linked to GitHub avatar.

## 1. Server Access and Port Invariants
* **SSH Connection**: `ssh vps` (Frankfurt VPS, Debian 12, 1 vCPU / 1GB RAM).
* **Default SSH User**: Directly logs in as `root`. Do not prepend `sudo` in scripts or automated commands (command not found).
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
* Static sites root: `/var/www/sites/` (e.g. `/var/www/sites/stnatrix`, `/var/www/sites/ahktrix`, owned by `www-data:www-data`, permissions `755`)

## 2.1 Co-Hosted Static Sites Architecture
* Static sites (`stnatrix.space`, `ahk.stnatrix.space`) run purely via Nginx without background backend daemons to conserve RAM on the 1GB VPS.
* Nginx vhosts:
  * `/etc/nginx/sites-available/stnatrix.conf` -> `/etc/nginx/sites-enabled/stnatrix.conf`
  * `/etc/nginx/sites-available/ahk.stnatrix.conf` -> `/etc/nginx/sites-enabled/ahk.stnatrix.conf`
* Traffic is proxied through Cloudflare with gzip compression, 7-day asset caching, and security headers enabled.

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
* **PowerShell String Interpolation in Nginx Configs**: When generating Nginx configs from PowerShell, `$uri` evaluates to an empty string in double quotes or standard here-docs (`try_files $uri =404` becomes `try_files =404`). Always write Nginx configs to local `.conf` files and transfer via `scp`, or escape variables as `` `$uri ``.
* **SSH User Execution**: Since `ssh vps` logs in as `root`, invoke commands directly without `sudo`.
* **Git Credential Manager & SOCKS5**: Git Credential Manager on Windows fails with `The ServicePointManager does not support proxies with the socks5 scheme`. If proxy is required, use HTTP scheme or personal access token URL.
* **Git Author & Config Invariant**:
  * Global identity: `user.name=stnatrix`, `user.email=natrix852@gmail.com`.
  * Never set local `[user]` sections in `.git/config` with dummy addresses (like `@example.com`).
  * Never include tokens in `remote.origin.url`.
