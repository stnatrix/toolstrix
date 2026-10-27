# toolstrix 2.0

A dedicated, personal media downloader powered by yt-dlp.

---

## Highlights

- **Single Purpose**: Focused exclusively on clean, fast media downloads without extraneous tool modules.
- **Asynchronous Job Engine**: Download requests spawn tracked background jobs (`POST /api/jobs` → poll `GET /api/jobs/{id}` → stream `GET /api/jobs/{id}/file`), preventing Cloudflare 524 gateway timeouts.
- **Strict Concurrency Control**: Fixed to 1 concurrent active download semaphore on the server to prevent out-of-memory errors on 1 vCPU / 1GB RAM instances.
- **Access Protection**: Single-key authentication verified via `hmac.compare_digest`, IP-based rate limiting via `CF-Connecting-IP`, and cryptographically signed `HttpOnly`, `SameSite=Lax` session cookies bound to the access key hash.
- **Zero Persistent Storage**: Files are streamed directly and deleted immediately upon transfer completion or after timeout sweeps.
- **Calm Warm Obsidian Design**: Dark-mode palette with self-hosted Nunito typography and synthesized Web Audio feedback.

---

## Architecture

```
toolstrix/
├── main.py                     # Entry point and route mounting
├── config.example.toml         # Configuration template
├── config.toml                 # Active server configuration (ignored in git)
├── requirements.txt            # Pinned dependencies
├── app/
│   ├── auth.py                 # Key validation, session cookies, rate limiting
│   ├── core/
│   │   ├── config.py           # Typed TOML configuration
│   │   ├── logging.py          # Structured logging without URL/filename leakage
│   │   └── temp.py             # Session tmp directories and cleanup
│   └── ytdlp/
│       ├── probe.py            # SSRF validation, format tiering and deduplication
│       ├── jobs.py             # In-memory JobManager, concurrency semaphore, progress hooks
│       ├── download.py         # Subprocess command builder and completed file resolver
│       └── errors.py           # Human-friendly error translation
├── web/
│   ├── login.html              # Minimal authentication page
│   ├── index.html              # Single-card downloader interface
│   ├── css/main.css            # Warm Obsidian styling and Nunito font rules
│   ├── js/
│   │   ├── app.js              # Client logic, paste detection, job polling
│   │   └── sfx.js              # Synthesized Web Audio clicks with mute toggle
│   └── fonts/nunito/           # Self-hosted Nunito fonts
├── deploy/
│   ├── nginx.conf              # Reverse proxy configuration (port 8098)
│   ├── toolstrix.service       # systemd unit
│   ├── update-ytdlp.sh         # Isolated daily updater with smoke test and rollback
│   ├── deploy.sh               # Staging deploy and atomic swap script
│   └── rollback.sh             # Instant rollback script to port 8099
└── tests/
    ├── test_auth.py            # Key verification, session binding, rate limits
    ├── test_probe.py           # SSRF protection, format sorting, error mapping
    ├── test_jobs.py            # Subprocess commands, progress tracking, job lifecycle
    └── test_main.py            # FastAPI integration tests
```

---

## Local Development

```powershell
# 1. Create virtual environment
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt

# 2. Configure environment
copy config.example.toml config.toml

# 3. Run automated tests
.\.venv\Scripts\python -m pytest tests/ -v

# 4. Start local server
.\.venv\Scripts\python main.py
```

Access the application at `http://127.0.0.1:8098/` and authenticate using the key defined in `config.toml`.
