import os
import re
import secrets
import shutil
import tempfile
import subprocess
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, Query, HTTPException, UploadFile, Form
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
import yt_dlp

# Fix for yt-dlp / curl_cffi upstream issue (#17604):
# Deprioritize fictitious/unrealistic browser versions (Chrome >= 133 on macOS 26/15)
# which cause TikTok/Akamai WAF to return 537b Site Maintenance error.
try:
    import itertools
    from yt_dlp.networking.impersonate import ImpersonateTarget
    import yt_dlp.networking._curlcffi as cffi_mod

    for _v in ["133", "136", "142", "145", "146", "150"]:
        for _os_name, _os_ver in [("macos", "26"), ("macos", "15")]:
            cffi_mod._DEPRIORITIZED_TARGETS.add(ImpersonateTarget("chrome", _v, _os_name, _os_ver))
    for _os_name, _os_ver in [("macos", "26")]:
        cffi_mod._DEPRIORITIZED_TARGETS.add(ImpersonateTarget("firefox", "144", _os_name, _os_ver))
        cffi_mod._DEPRIORITIZED_TARGETS.add(ImpersonateTarget("firefox", "147", _os_name, _os_ver))
        cffi_mod._DEPRIORITIZED_TARGETS.add(ImpersonateTarget("safari", "26.0", _os_name, _os_ver))
        cffi_mod._DEPRIORITIZED_TARGETS.add(ImpersonateTarget("safari", "26.0.1", _os_name, _os_ver))

    _chain_items = list(itertools.chain.from_iterable(tgts.items() for tgts in cffi_mod.BROWSER_TARGETS.values()))
    cffi_mod.CurlCFFIRH._SUPPORTED_IMPERSONATE_TARGET_MAP = {
        target: name for name, target in dict(sorted(
            _chain_items,
            key=lambda x: (
                x[1] not in cffi_mod._DEPRIORITIZED_TARGETS,
                x[1].os not in ("ios", "android"),
                ("tor", "edge", "firefox", "safari", "chrome").index(x[1].client),
                yt_dlp.utils.version_tuple(x[1].version or "0"),
                x[1].os,
            ), reverse=True)).items()
    }
except Exception:
    pass

TMP_DIR = Path(tempfile.gettempdir()) / "ytdlp-web"
TMP_DIR.mkdir(parents=True, exist_ok=True)
STATIC_DIR = Path(__file__).parent / "static"

MAX_UPLOAD_BYTES = int(os.environ.get("YTDLP_MAX_UPLOAD_MB", "512")) * 1024 * 1024

app = FastAPI(title="natrix tools")


@app.middleware("http")
async def cross_origin_isolation(request, call_next):
    response = await call_next(request)
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Embedder-Policy"] = "require-corp"
    response.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")

    if request.url.path.startswith("/static/"):
        response.headers.setdefault("Cache-Control", "no-cache")
    return response


@app.get("/", response_class=HTMLResponse)
def index():
    html = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    return HTMLResponse(html, headers={"Cache-Control": "no-cache"})


@app.get("/api/formats")
def get_formats(url: str):
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "remote_components": ["ejs:github"],
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        raise HTTPException(400, f"Не удалось получить информацию: {e}")

    formats = []
    for f in info.get("formats", []):
        if f.get("vcodec") == "none" and f.get("acodec") == "none":
            continue
        height = f.get("height")
        note = f.get("format_note") or ""
        ext = f.get("ext")
        vcodec = f.get("vcodec")
        acodec = f.get("acodec")
        filesize = f.get("filesize") or f.get("filesize_approx")
        label_parts = []
        if height:
            label_parts.append(f"{height}p")
        elif note:
            label_parts.append(note)
        if vcodec == "none":
            label_parts.append("аудио")
        if filesize:
            label_parts.append(f"{round(filesize / 1024 / 1024, 1)}MB")
        formats.append({
            "format_id": f.get("format_id"),
            "ext": ext,
            "label": " · ".join(label_parts) or f.get("format_id"),
            "has_video": vcodec != "none",
            "has_audio": acodec != "none",
            "height": height or 0,
        })

    formats.sort(key=lambda x: (-x["height"], not x["has_audio"]))

    return {
        "title": info.get("title"),
        "duration": info.get("duration"),
        "thumbnail": info.get("thumbnail"),
        "formats": formats,
    }


def _safe_filename(name: str) -> str:
    name = re.sub(r'[\\/*?:"<>|]', "_", name)
    name = name.strip(" .")
    return name[:150]


def _download(url: str, format_selector: str, audio_only: bool) -> Path:
    session_dir = Path(tempfile.mkdtemp(dir=TMP_DIR))
    outtmpl = str(session_dir / "%(title)s.%(ext)s")

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "outtmpl": outtmpl,
        "format": format_selector,
        "restrictfilenames": False,
        "remote_components": ["ejs:github"],
    }

    if audio_only:
        ydl_opts["postprocessors"] = [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }]
    else:
        ydl_opts["merge_output_format"] = "mp4"

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
    except Exception as e:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise HTTPException(400, f"Ошибка скачивания: {e}")

    files = [
        f for f in session_dir.iterdir()
        if f.is_file() and f.suffix.lower() not in {".part", ".ytdl", ".temp"}
    ]
    if not files:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise HTTPException(500, "Файл не найден после скачивания")
    return max(files, key=lambda f: f.stat().st_size)


@app.get("/api/download")
def download(
    url: str,
    mode: str = Query(default="quick"),
    format_id: str | None = Query(default=None),
):
    if mode == "audio":
        format_selector = "bestaudio/best"
        audio_only = True
    elif mode == "video" and format_id:
        format_selector = f"{format_id}+bestaudio/{format_id}/best"
        audio_only = False
    else:
        format_selector = "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best"
        audio_only = False

    filepath = _download(url, format_selector, audio_only)
    filename = _safe_filename(filepath.name)

    def cleanup():
        shutil.rmtree(filepath.parent, ignore_errors=True)

    from starlette.background import BackgroundTask

    response = FileResponse(
        path=filepath,
        media_type="application/octet-stream",
        background=BackgroundTask(cleanup),
    )
    ascii_fallback = filename.encode("ascii", "ignore").decode() or "download"
    response.headers["Content-Disposition"] = (
        f'attachment; filename="{ascii_fallback}"; '
        f"filename*=UTF-8''{quote(filename)}"
    )
    return response


ALLOWED_PRESETS = {"ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow"}
ALLOWED_AUDIO_MODES = {"keep", "mono64", "mute"}
COMPRESS_TIMEOUT_SEC = int(os.environ.get("YTDLP_COMPRESS_TIMEOUT", "600"))


@app.post("/api/compress")
async def api_compress(
    file: UploadFile,
    video_bitrate_kbps: int = Form(...),
    target_height: int = Form(...),
    audio_mode: str = Form(...),
    preset: str = Form(...),
):

    if preset not in ALLOWED_PRESETS:
        raise HTTPException(400, f"Недопустимый preset: {preset}")
    if audio_mode not in ALLOWED_AUDIO_MODES:
        raise HTTPException(400, f"Недопустимый audio_mode: {audio_mode}")
    if not 50 <= video_bitrate_kbps <= 100_000:
        raise HTTPException(400, "video_bitrate_kbps вне допустимого диапазона")
    if target_height and not 0 < target_height <= 4320:
        raise HTTPException(400, "target_height вне допустимого диапазона")

    safe_name = _safe_filename(Path(file.filename or "upload").name) or "upload"

    session_dir = Path(tempfile.mkdtemp(dir=TMP_DIR))
    input_filepath = session_dir / safe_name
    output_filepath = session_dir / f"compressed_{Path(safe_name).stem}.mp4"

    try:
        written = 0
        with open(input_filepath, "wb") as buffer:
            while chunk := await file.read(1024 * 1024):
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        413, f"Файл больше лимита {MAX_UPLOAD_BYTES // (1024 * 1024)} МБ"
                    )
                buffer.write(chunk)

        cmd = [
            "ffmpeg",
            "-i", str(input_filepath),
            "-map", "0:v"
        ]

        if audio_mode != "mute":
            cmd.extend(["-map", "0:a?"])
            
        if target_height > 0:
            cmd.extend(["-vf", f"scale=-2:{target_height}"])
            
        cmd.extend([
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-b:v", f"{video_bitrate_kbps}k",
            "-maxrate", f"{video_bitrate_kbps}k",
            "-bufsize", f"{video_bitrate_kbps * 2}k",
            "-preset", preset
        ])
        
        if audio_mode == "mute":
            cmd.extend(["-an"])
        elif audio_mode == "mono64":
            cmd.extend(["-c:a", "aac", "-b:a", "64k", "-ac", "1"])
        else:
            cmd.extend(["-c:a", "aac", "-b:a", "128k"])
            
        cmd.extend(["-threads", "1", "-y", str(output_filepath)])

        res = subprocess.run(cmd, capture_output=True, text=True, timeout=COMPRESS_TIMEOUT_SEC)
        if res.returncode != 0:
            raise HTTPException(500, f"FFmpeg failed: {res.stderr[-800:]}")

        if not output_filepath.exists() or output_filepath.stat().st_size == 0:
            raise HTTPException(500, "Output file is empty or missing after conversion")

    except subprocess.TimeoutExpired:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise HTTPException(504, "FFmpeg conversion timed out")
    except HTTPException:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise
    except Exception as e:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise HTTPException(500, f"Conversion error: {e}")


    def cleanup():
        shutil.rmtree(session_dir, ignore_errors=True)
        
    from starlette.background import BackgroundTask
    
    response = FileResponse(
        path=output_filepath,
        media_type="video/mp4",
        background=BackgroundTask(cleanup),
    )
    
    filename = output_filepath.name
    ascii_fallback = filename.encode("ascii", "ignore").decode() or "compressed"
    response.headers["Content-Disposition"] = (
        f'attachment; filename="{ascii_fallback}"; '
        f"filename*=UTF-8''{quote(filename)}"
    )
    return response


app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")
