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


_last_clean_time = 0.0


def _clean_stale_temp(max_age_sec: int = 7200):
    import time
    now = time.time()
    try:
        for item in TMP_DIR.iterdir():
            try:
                if now - item.stat().st_mtime > max_age_sec:
                    if item.is_dir():
                        shutil.rmtree(item, ignore_errors=True)
                    else:
                        item.unlink(missing_ok=True)
            except Exception:
                pass
    except Exception:
        pass


def _maybe_clean_stale_temp(max_age_sec: int = 7200):
    global _last_clean_time
    import time
    now = time.time()
    if now - _last_clean_time < 3600:
        return
    _last_clean_time = now
    _clean_stale_temp(max_age_sec)


def _ascii_filename(filename: str, fallback_base: str = "download") -> str:
    path = Path(filename)
    raw_stem = path.stem
    raw_ext = path.suffix
    clean_stem = re.sub(r"[^a-zA-Z0-9_\-]", "", raw_stem).strip(" .-_")
    clean_ext = re.sub(r"[^a-zA-Z0-9_.]", "", raw_ext).strip(" .")
    if clean_ext and not clean_ext.startswith("."):
        clean_ext = f".{clean_ext}"
    if not clean_stem:
        clean_stem = fallback_base
    result = f"{clean_stem}{clean_ext}" if clean_ext else clean_stem
    try:
        result.encode("ascii")
        return result
    except UnicodeEncodeError:
        return f"{fallback_base}.mp4"


def _get_video_duration(filepath: Path) -> float | None:
    try:
        res = subprocess.run(
            [
                "ffprobe",
                "-v", "error",
                "-show_entries", "format=duration:stream=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(filepath),
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if res.returncode == 0 and res.stdout.strip():
            for line in res.stdout.strip().splitlines():
                line = line.strip()
                if line and line != "N/A":
                    try:
                        val = float(line)
                        if val > 0:
                            return val
                    except ValueError:
                        continue
    except Exception:
        pass
    return None


_clean_stale_temp()
STATIC_DIR = Path(__file__).parent / "static"

MAX_UPLOAD_BYTES = int(os.environ.get("YTDLP_MAX_UPLOAD_MB", "512")) * 1024 * 1024

app = FastAPI(title="natrix tools")


@app.middleware("http")
async def cross_origin_isolation(request, call_next):
    _maybe_clean_stale_temp()
    response = await call_next(request)
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Embedder-Policy"] = "require-corp"
    response.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")

    if request.url.path in ("/sw.js", "/static/sw.js"):
        response.headers["Service-Worker-Allowed"] = "/"
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    elif request.url.path.startswith("/static/"):
        response.headers.setdefault("Cache-Control", "no-cache")
    return response


@app.api_route("/", methods=["GET", "HEAD"], response_class=HTMLResponse)
@app.api_route("/index.html", methods=["GET", "HEAD"], response_class=HTMLResponse)
def index():
    html = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    return HTMLResponse(html, headers={"Cache-Control": "no-cache"})


@app.api_route("/sw.js", methods=["GET", "HEAD"])
def service_worker():
    sw_file = STATIC_DIR / "sw.js"
    if not sw_file.exists():
        raise HTTPException(404, "Service Worker not found")
    return FileResponse(
        path=sw_file,
        media_type="application/javascript",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Service-Worker-Allowed": "/",
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp",
        },
    )


@app.api_route("/manifest.webmanifest", methods=["GET", "HEAD"])
def manifest():
    manifest_file = STATIC_DIR / "manifest.webmanifest"
    if not manifest_file.exists():
        raise HTTPException(404, "Manifest not found")
    return FileResponse(
        path=manifest_file,
        media_type="application/manifest+json",
        headers={
            "Cache-Control": "no-cache",
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp",
        },
    )


@app.api_route("/favicon.ico", methods=["GET", "HEAD"])
def favicon():
    fav_file = STATIC_DIR / "favicon.ico"
    if not fav_file.exists():
        raise HTTPException(404, "Favicon not found")
    return FileResponse(
        path=fav_file,
        media_type="image/x-icon",
        headers={
            "Cache-Control": "public, max-age=86400",
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp",
        },
    )


@app.api_route("/favicon.svg", methods=["GET", "HEAD"])
def favicon_svg():
    svg_file = STATIC_DIR / "favicon.svg"
    if not svg_file.exists():
        raise HTTPException(404, "Favicon SVG not found")
    return FileResponse(
        path=svg_file,
        media_type="image/svg+xml",
        headers={
            "Cache-Control": "public, max-age=86400",
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp",
        },
    )


@app.api_route("/apple-touch-icon.png", methods=["GET", "HEAD"])
@app.api_route("/apple-touch-icon-precomposed.png", methods=["GET", "HEAD"])
def apple_touch_icon():
    icon_file = STATIC_DIR / "icon-192.png"
    if not icon_file.exists():
        raise HTTPException(404, "Apple Touch Icon not found")
    return FileResponse(
        path=icon_file,
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=86400",
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp",
        },
    )


def _format_score(f: dict) -> tuple:
    ext_score = 2 if f.get("ext") == "mp4" else (1 if f.get("ext") == "webm" else 0)
    has_size = 1 if (f.get("filesize") or f.get("filesize_approx")) else 0
    vcodec = (f.get("vcodec") or "").lower()
    codec_score = 2 if vcodec.startswith(("avc1", "h264")) else (1 if vcodec.startswith(("vp9", "vp09", "av01")) else 0)
    fps = f.get("fps") or 0
    size_or_bitrate = f.get("filesize") or f.get("filesize_approx") or (f.get("tbr") or 0) * 1000 or (f.get("vbr") or 0) * 1000
    return (has_size, ext_score, codec_score, fps, size_or_bitrate)


@app.get("/api/formats")
def get_formats(url: str):
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(400, "Разрешены только ссылки http:// и https://")
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

    raw_formats = info.get("formats", [])
    valid_formats = [
        f for f in raw_formats
        if not (f.get("vcodec") == "none" and f.get("acodec") == "none")
    ]

    video_candidates = [f for f in valid_formats if f.get("vcodec") != "none"]
    candidates = video_candidates if video_candidates else [f for f in valid_formats if f.get("acodec") != "none"]

    by_tier = {}
    for f in candidates:
        height = f.get("height")
        if not height and f.get("resolution"):
            m = re.search(r"x(\d+)", f.get("resolution"))
            if m:
                try:
                    height = int(m.group(1))
                except ValueError:
                    pass

        if height:
            tier_key = f"{height}p"
        elif f.get("format_note"):
            tier_key = f.get("format_note").strip()
        elif f.get("resolution"):
            tier_key = f.get("resolution").strip()
        else:
            tier_key = str(f.get("format_id"))

        if tier_key not in by_tier or _format_score(f) > _format_score(by_tier[tier_key]):
            by_tier[tier_key] = f

    formats = []
    for f in by_tier.values():
        height = f.get("height") or 0
        if not height and f.get("resolution"):
            m = re.search(r"x(\d+)", f.get("resolution"))
            if m:
                try:
                    height = int(m.group(1))
                except ValueError:
                    pass

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
            "height": height,
        })

    formats.sort(key=lambda x: (-x["height"], not x["has_audio"]))

    # Additional deduplication safeguard by final label and extension
    seen_labels = set()
    deduped_formats = []
    for fmt in formats:
        key = (fmt["label"], fmt.get("ext"))
        if key not in seen_labels:
            seen_labels.add(key)
            deduped_formats.append(fmt)

    return {
        "title": info.get("title"),
        "duration": info.get("duration"),
        "thumbnail": info.get("thumbnail"),
        "formats": deduped_formats,
    }


def _safe_filename(name: str) -> str:
    name = re.sub(r'[\\/*?:"<>|]', "_", name)
    name = name.strip(" .")
    return (name or "media")[:150]


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
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(400, "Разрешены только ссылки http:// и https://")

    if mode == "audio":
        format_selector = "bestaudio/best"
        audio_only = True
    elif mode == "video" and format_id:
        clean_format_id = re.sub(r"[^a-zA-Z0-9_\-]", "", format_id)
        if clean_format_id:
            format_selector = f"{clean_format_id}+bestaudio/{clean_format_id}/best"
        else:
            format_selector = "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best"
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
    ascii_fallback = _ascii_filename(filename, "download")
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
    target_size_mb: float | None = Form(None),
):

    if preset not in ALLOWED_PRESETS:
        raise HTTPException(400, f"Недопустимый preset: {preset}")
    if audio_mode not in ALLOWED_AUDIO_MODES:
        raise HTTPException(400, f"Недопустимый audio_mode: {audio_mode}")
    if not 50 <= video_bitrate_kbps <= 100_000:
        raise HTTPException(400, "video_bitrate_kbps вне допустимого диапазона")
    if target_height and not 0 < target_height <= 4320:
        raise HTTPException(400, "target_height вне допустимого диапазона")
    if target_size_mb is not None and target_size_mb <= 0:
        raise HTTPException(400, "target_size_mb должен быть больше 0")

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

        if written == 0:
            raise HTTPException(400, "Загружен пустой файл")

        if target_size_mb and target_size_mb > 0:
            duration = _get_video_duration(input_filepath)
            if duration and duration > 0:
                audio_bps = 64_000 if audio_mode == "mono64" else (0 if audio_mode == "mute" else 128_000)
                file_size_bytes = input_filepath.stat().st_size
                orig_calc_kbps = max(50, int(((file_size_bytes * 8) / duration - audio_bps) / 1000))

                target_bits = max(0.5, target_size_mb) * 8 * 1024 * 1024 * 0.93
                calc_kbps = int((target_bits / duration - audio_bps) / 1000)
                calc_kbps = max(50, min(50_000, calc_kbps))

                if target_size_mb * 1024 * 1024 >= file_size_bytes:
                    video_bitrate_kbps = min(calc_kbps, orig_calc_kbps)
                else:
                    video_bitrate_kbps = calc_kbps

        cmd = [
            "ffmpeg",
            "-i", str(input_filepath),
            "-map", "0:v:0",
            "-sn"
        ]

        if audio_mode != "mute":
            cmd.extend(["-map", "0:a?"])
            
        if target_height > 0:
            cmd.extend(["-vf", f"scale=-2:trunc(min(ih\\,{target_height})/2)*2"])
        else:
            cmd.extend(["-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2"])
            
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
            
        cpu_threads = str(min(4, os.cpu_count() or 2))
        cmd.extend(["-threads", cpu_threads, "-y", str(output_filepath)])

        res = subprocess.run(cmd, capture_output=True, text=True, timeout=COMPRESS_TIMEOUT_SEC)
        if res.returncode != 0:
            err_low = res.stderr.lower()
            if "matches no streams" in err_low or "invalid data found" in err_low or "does not contain any stream" in err_low:
                raise HTTPException(400, "Файл не содержит допустимого видеопотока для сжатия")
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
    ascii_fallback = _ascii_filename(filename, "compressed")
    response.headers["Content-Disposition"] = (
        f'attachment; filename="{ascii_fallback}"; '
        f"filename*=UTF-8''{quote(filename)}"
    )
    return response


app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")
