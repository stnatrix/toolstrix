"""
yt-dlp web — личный сервис для скачивания видео/аудио с любых площадок.
Лёгкий FastAPI backend, без хранения файлов на сервере (стримим клиенту напрямую).
"""

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

TMP_DIR = Path(tempfile.gettempdir()) / "ytdlp-web"
TMP_DIR.mkdir(parents=True, exist_ok=True)
STATIC_DIR = Path(__file__).parent / "static"

# максимальный размер загружаемого на сервер файла для /api/compress
MAX_UPLOAD_BYTES = int(os.environ.get("YTDLP_MAX_UPLOAD_MB", "512")) * 1024 * 1024

app = FastAPI(title="natrix tools")


# ---------- Cross-origin isolation ----------
# ffmpeg.wasm собран в multi-thread варианте (ffmpeg-core.worker.js) и требует
# SharedArrayBuffer. SharedArrayBuffer доступен только на cross-origin isolated
# странице, то есть при COOP: same-origin + COEP: require-corp. Без этих
# заголовков natrix.mpeg и natrix.compress падают с
# "SharedArrayBuffer is not defined" ещё на этапе загрузки ядра.
#
# Заголовки ставит само приложение, а не nginx — так проект остаётся рабочим
# при любом способе развёртывания (напрямую uvicorn, через прокси, локально).
# require-corp безопасен, потому что все ресурсы страницы (шрифты, ffmpeg)
# самохостятся — внешних запросов у фронтенда нет.
@app.middleware("http")
async def cross_origin_isolation(request, call_next):
    response = await call_next(request)
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Embedder-Policy"] = "require-corp"
    response.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")

    # Статика обязана ревалидироваться. Ответ, закэшированный браузером ДО того,
    # как появились заголовки выше, под require-corp отдаётся как
    # ERR_BLOCKED_BY_RESPONSE — и ffmpeg.wasm намертво отказывается стартовать,
    # хотя сервер уже отвечает правильно. Воркер-чанк ffmpeg тянет сам себя по
    # фиксированному URL, ?v= к нему не приделать, поэтому единственная надёжная
    # страховка — no-cache (кэш остаётся, но каждый раз проверяется через ETag).
    if request.url.path.startswith("/static/"):
        response.headers.setdefault("Cache-Control", "no-cache")
    return response


# ---------- Отдача фронтенда ----------
@app.get("/", response_class=HTMLResponse)
def index():
    html = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    return HTMLResponse(html, headers={"Cache-Control": "no-cache"})


# ---------- Получить список доступных форматов (для ПК-режима) ----------
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
        # пропускаем форматы без видео и без аудио (например, storyboard-превью)
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

    # сортировка: сначала видео по убыванию качества, потом аудио
    formats.sort(key=lambda x: (-x["height"], not x["has_audio"]))

    return {
        "title": info.get("title"),
        "duration": info.get("duration"),
        "thumbnail": info.get("thumbnail"),
        "formats": formats,
    }


# ---------- Скачивание ----------
def _safe_filename(name: str) -> str:
    name = re.sub(r'[\\/*?:"<>|]', "_", name)
    name = name.strip(" .")  # ".." и хвостовые точки/пробелы недопустимы как имя файла
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
        # гарантируем итоговый mp4-контейнер, если видео+аудио отдельно
        ydl_opts["merge_output_format"] = "mp4"

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
    except Exception as e:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise HTTPException(400, f"Ошибка скачивания: {e}")

    # yt-dlp может оставить в папке служебные огрызки (.part, .ytdl, отдельные
    # дорожки до merge) — берём самый большой готовый файл, а не первый попавшийся
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
    mode: str = Query(default="quick"),  # quick | video | audio
    format_id: str | None = Query(default=None),
):
    if mode == "audio":
        format_selector = "bestaudio/best"
        audio_only = True
    elif mode == "video" and format_id:
        # выбранный конкретный формат + лучшее аудио, либо сам формат если уже с аудио
        format_selector = f"{format_id}+bestaudio/{format_id}/best"
        audio_only = False
    else:
        # quick-режим: среднее-хорошее качество, не самое тяжёлое
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


# ---------- Серверное сжатие (fallback, когда ffmpeg.wasm в браузере не справился) ----------
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

    # имя приходит от клиента — нельзя подставлять его в путь как есть
    # (".." или "/" увели бы запись за пределы session_dir)
    safe_name = _safe_filename(Path(file.filename or "upload").name) or "upload"

    session_dir = Path(tempfile.mkdtemp(dir=TMP_DIR))
    input_filepath = session_dir / safe_name
    output_filepath = session_dir / f"compressed_{Path(safe_name).stem}.mp4"

    try:
        # Save uploaded file, обрывая заведомо неподъёмные для VPS загрузки
        written = 0
        with open(input_filepath, "wb") as buffer:
            while chunk := await file.read(1024 * 1024):
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        413, f"Файл больше лимита {MAX_UPLOAD_BYTES // (1024 * 1024)} МБ"
                    )
                buffer.write(chunk)

        # Build command
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
            
        # -threads именно здесь, как выходная опция: перед -i он ограничил бы
        # только декодер, а держать в узде надо энкодер — на VPS одно ядро и
        # CPUQuota=70%, иначе x264 разведёт потоков по числу ядер хоста.
        cmd.extend(["-threads", "1", "-y", str(output_filepath)])

        res = subprocess.run(cmd, capture_output=True, text=True, timeout=COMPRESS_TIMEOUT_SEC)
        if res.returncode != 0:
            # в stderr ffmpeg пишет мегабайты лога — клиенту нужен только хвост
            raise HTTPException(500, f"FFmpeg failed: {res.stderr[-800:]}")

        if not output_filepath.exists() or output_filepath.stat().st_size == 0:
            raise HTTPException(500, "Output file is empty or missing after conversion")

    except subprocess.TimeoutExpired:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise HTTPException(504, "FFmpeg conversion timed out")
    except HTTPException:
        # осмысленный код/текст уже сформирован выше — не заворачиваем его в 500
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
