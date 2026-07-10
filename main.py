"""
yt-dlp web — личный сервис для скачивания видео/аудио с любых площадок.
Лёгкий FastAPI backend, без хранения файлов на сервере (стримим клиенту напрямую).
"""

import os
import re
import shutil
import tempfile
import subprocess
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, Query, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import yt_dlp

APP_TOKEN = os.environ.get("YTDLP_TOKEN", "")  # секретный токен, задаётся в systemd unit
TMP_DIR = Path(tempfile.gettempdir()) / "ytdlp-web"
TMP_DIR.mkdir(exist_ok=True)

app = FastAPI(title="yt-dlp web")


# ---------- Авторизация по токену в URL/заголовке ----------
def check_token(token: str | None):
    if not APP_TOKEN:
        # если токен не задан в окружении — считаем это ошибкой конфигурации, а не "открыто для всех"
        raise HTTPException(500, "Server misconfigured: token not set")
    if token != APP_TOKEN:
        raise HTTPException(403, "Forbidden")


# ---------- Отдача фронтенда ----------
@app.get("/", response_class=HTMLResponse)
def index(t: str = Query(default="")):
    check_token(t)
    html = (Path(__file__).parent / "static" / "index.html").read_text(encoding="utf-8")
    return HTMLResponse(html)


# ---------- Получить список доступных форматов (для ПК-режима) ----------
@app.get("/api/formats")
def get_formats(url: str, t: str = Query(default="")):
    check_token(t)
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

    files = list(session_dir.iterdir())
    if not files:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise HTTPException(500, "Файл не найден после скачивания")
    return files[0]


@app.get("/api/download")
def download(
    url: str,
    t: str = Query(default=""),
    mode: str = Query(default="quick"),  # quick | video | audio
    format_id: str | None = Query(default=None),
):
    check_token(t)

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


app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")
