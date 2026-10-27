import asyncio
import json
import shutil
from pathlib import Path
from urllib.parse import quote
from fastapi import FastAPI, Request, HTTPException, status
from fastapi.responses import HTMLResponse, FileResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.background import BackgroundTask
import yt_dlp
from app.core.config import config
from app.core.logging import logger
from app.core.temp import cleanup_stale_temp
from app.auth import (
    COOKIE_NAME,
    get_client_ip,
    rate_limiter,
    verify_access_key,
    create_session_token,
    is_authenticated,
    require_auth,
)
from app.ytdlp.probe import probe_url, validate_url
from app.ytdlp.jobs import job_manager
from app.ytdlp.download import ascii_fallback_filename

BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR / "web"

app = FastAPI(title="toolstrix", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")

@app.middleware("http")
async def security_and_sweep_middleware(request: Request, call_next):
    cleanup_stale_temp(max_age_seconds=7200)
    job_manager.sweep_stale_jobs(max_age_seconds=1800)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    return response

@app.get("/health")
def health(request: Request):
    client_ip = get_client_ip(request)
    updater_info = {}
    updater_path = Path("/opt/toolstrix/updater_status.json")
    if updater_path.exists():
        try:
            with open(updater_path, "r", encoding="utf-8") as f:
                updater_info = json.load(f)
        except Exception:
            pass

    version_str = "unknown"
    if hasattr(yt_dlp, "version") and hasattr(yt_dlp.version, "__version__"):
        version_str = str(yt_dlp.version.__version__)

    return {
        "status": "ok",
        "ytdlp_version": version_str,
        "ffmpeg": bool(shutil.which("ffmpeg")),
        "active_jobs": job_manager.active_count,
        "updater": updater_info,
    }

@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    if is_authenticated(request):
        return RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)
    html_file = WEB_DIR / "login.html"
    return HTMLResponse(content=html_file.read_text(encoding="utf-8"))

@app.post("/login")
async def login_submit(request: Request):
    ip = get_client_ip(request)
    if rate_limiter.is_blocked(ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed attempts. Please wait a minute before trying again.",
        )

    try:
        data = await request.json()
    except Exception:
        data = {}

    key = (data.get("key") or "").strip()
    if not verify_access_key(key):
        rate_limiter.record_failure(ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid access key.",
        )

    rate_limiter.reset(ip)
    token = create_session_token()
    response = JSONResponse({"status": "ok"})
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=config.auth.session_ttl_days * 86400,
    )
    return response

@app.post("/logout")
def logout_submit():
    response = JSONResponse({"status": "ok"})
    response.delete_cookie(key=COOKIE_NAME)
    return response

@app.get("/", response_class=HTMLResponse)
@app.get("/index.html", response_class=HTMLResponse)
async def index_page(request: Request):
    await require_auth(request)
    html_file = WEB_DIR / "index.html"
    return HTMLResponse(content=html_file.read_text(encoding="utf-8"))

@app.post("/api/probe")
async def api_probe(request: Request):
    await require_auth(request)
    try:
        data = await request.json()
    except Exception:
        data = {}
    url = (data.get("url") or "").strip()
    return probe_url(url)

@app.post("/api/jobs")
async def api_create_job(request: Request):
    await require_auth(request)
    if job_manager.is_server_busy():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Server is busy with another download. Please wait for it to finish.",
        )

    try:
        data = await request.json()
    except Exception:
        data = {}

    url = (data.get("url") or "").strip()
    validate_url(url)

    video_fmt = data.get("video_format_id") or "__none__"
    audio_fmt = data.get("audio_format_id") or "__none__"

    if video_fmt == "__none__" and audio_fmt == "__none__":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot select both no video and no audio.",
        )

    job = job_manager.create_job(
        url=url,
        video_format_id=video_fmt,
        audio_format_id=audio_fmt,
    )
    asyncio.create_task(job_manager.execute_job(job))
    return {"job_id": job.id, "status": job.status}

@app.get("/api/jobs/{job_id}")
async def api_get_job(job_id: str, request: Request):
    await require_auth(request)
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "job_id": job.id,
        "status": job.status,
        "progress": job.progress,
        "speed": job.speed,
        "eta": job.eta,
        "error": job.error,
        "filename": job.filename,
    }

@app.get("/api/jobs/{job_id}/file")
async def api_download_job_file(job_id: str, request: Request):
    await require_auth(request)
    job = job_manager.get_job(job_id)
    if not job or job.status != "ready" or not job.file_path or not job.file_path.exists():
        raise HTTPException(status_code=404, detail="Requested file is not ready or has expired")

    filename = job.filename or job.file_path.name
    fallback = ascii_fallback_filename(filename, "media")
    utf8_encoded = quote(filename)

    headers = {
        "Content-Disposition": f'attachment; filename="{fallback}"; filename*=UTF-8\'\'{utf8_encoded}',
    }

    return FileResponse(
        path=job.file_path,
        media_type="application/octet-stream",
        headers=headers,
        background=BackgroundTask(job_manager.cleanup_job, job.id),
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=config.server.host, port=config.server.port, reload=False)
