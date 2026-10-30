# Toolstrix 2.0 Project Rules & Invariants

## Context
* **Project**: toolstrix 2.0 — clean, personal media downloader powered by yt-dlp.
* **Server**: Frankfurt VPS (`ssh vps`, Debian 12, 1 vCPU / 1GB RAM).
* **Domain & Port**: `tools.stnatrix.space` -> Nginx reverse proxy -> `127.0.0.1:8098`.
* **Working Directory**: `/opt/toolstrix/`.
* **System User**: `ytdlpweb` (unprivileged).
* **Temp Storage**: `/tmp/toolstrix` (must strictly be owned by `ytdlpweb:ytdlpweb`).

## Strict Invariants
1. **Protected Services**: NEVER modify ports, configuration, or certificates of **3x-ui** or **Hysteria2**.
2. **Dedicated Port**: toolstrix runs strictly on internal port **`8098`**.
3. **Decommissioned Services**: `ytdlp-web` (port 8099) and `vps-watchdog` are disabled and inactive.
4. **Subprocess Isolation**: Downloads execute in an isolated subprocess (`asyncio.create_subprocess_exec`), never in-thread.
5. **Memory & cgroups v2**: Unit constraints are `MemoryHigh=350M` and `MemoryMax=450M`. Kernel page cache from `/tmp` is counted in memory. yt-dlp must always use `--buffer-size 16K`, `--http-chunk-size 10M`, and `-threads 1`.
6. **Network & Cloudflare**: Trust `CF-Connecting-IP` strictly from Cloudflare CIDRs. `/health` is blocked externally (HTTP 403) and accessible only via `127.0.0.1`.
7. **Concurrency**: Strictly 1 concurrent active download semaphore to prevent memory exhaustion.
