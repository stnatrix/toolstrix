import ipaddress
import re
import socket
from urllib.parse import urlparse
from fastapi import HTTPException
import yt_dlp
from app.core.config import config
from app.ytdlp.errors import translate_ytdlp_error

def validate_url(url: str) -> str:
    if not url:
        raise HTTPException(status_code=400, detail="URL cannot be empty")
    clean_url = url.strip()
    parsed = urlparse(clean_url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Only HTTP and HTTPS URLs are allowed")
    hostname = parsed.hostname
    if not hostname:
        raise HTTPException(status_code=400, detail="Invalid host in URL")

    low_host = hostname.lower()
    if low_host == "localhost" or low_host.endswith(".local") or low_host.endswith(".internal"):
        raise HTTPException(status_code=400, detail="Access to local hosts is prohibited")

    try:
        addr_info = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        raise HTTPException(status_code=400, detail="Could not resolve host")

    for item in addr_info:
        ip_str = item[4][0]
        try:
            ip_obj = ipaddress.ip_address(ip_str)
            if (
                ip_obj.is_loopback
                or ip_obj.is_private
                or ip_obj.is_link_local
                or ip_obj.is_multicast
                or ip_obj.is_reserved
                or ip_obj.is_unspecified
            ):
                raise HTTPException(status_code=400, detail="Access to private or local IP ranges is prohibited")
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid IP address resolved")

    return clean_url

def _format_video_score(fmt: dict) -> tuple:
    ext_score = 2 if fmt.get("ext") == "mp4" else (1 if fmt.get("ext") == "webm" else 0)
    has_size = 1 if (fmt.get("filesize") or fmt.get("filesize_approx")) else 0
    vcodec = (fmt.get("vcodec") or "").lower()
    codec_score = 2 if vcodec.startswith(("avc1", "h264")) else (1 if vcodec.startswith(("vp9", "vp09", "av01")) else 0)
    fps = fmt.get("fps") or 0
    size_or_bitrate = fmt.get("filesize") or fmt.get("filesize_approx") or (fmt.get("tbr") or 0) * 1000
    return (has_size, ext_score, codec_score, fps, size_or_bitrate)

def probe_url(url: str) -> dict:
    valid_url = validate_url(url)
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "remote_components": ["ejs:github"],
    }
    if config.download.cookies_file:
        from pathlib import Path
        cookie_path = Path(config.download.cookies_file)
        if cookie_path.exists() and cookie_path.is_file():
            ydl_opts["cookiefile"] = str(cookie_path)

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(valid_url, download=False)
    except Exception as exc:
        translated = translate_ytdlp_error(str(exc))
        raise HTTPException(status_code=400, detail=translated)

    raw_formats = info.get("formats", [])
    valid_formats = [
        f for f in raw_formats
        if not (f.get("vcodec") == "none" and f.get("acodec") == "none")
    ]

    video_candidates = [f for f in valid_formats if f.get("vcodec") != "none"]
    audio_candidates = [f for f in valid_formats if f.get("acodec") != "none"]

    by_height: dict[int, dict] = {}
    for f in video_candidates:
        height = f.get("height")
        if not height and f.get("resolution"):
            m = re.search(r"x(\d+)", f.get("resolution"))
            if m:
                try:
                    height = int(m.group(1))
                except ValueError:
                    pass
        if not height:
            continue

        if height not in by_height or _format_video_score(f) > _format_video_score(by_height[height]):
            by_height[height] = f

    video_formats = []
    for height, f in sorted(by_height.items(), key=lambda x: -x[0]):
        ext = f.get("ext") or "mp4"
        vcodec = (f.get("vcodec") or "").split(".")[0]
        filesize = f.get("filesize") or f.get("filesize_approx")
        size_str = f" · {round(filesize / (1024 * 1024), 1)} MB" if filesize else ""
        codec_str = f" ({vcodec})" if vcodec and vcodec != "none" else ""
        label = f"{height}p{codec_str}{size_str}"
        video_formats.append({
            "format_id": f.get("format_id"),
            "height": height,
            "ext": ext,
            "label": label,
        })

    audio_formats = [
        {
            "format_id": "__mp3__",
            "ext": "mp3",
            "label": "MP3 (192 kbps, universal)",
        }
    ]

    by_acodec: dict[str, dict] = {}
    for f in audio_candidates:
        ext = f.get("ext") or "audio"
        abr = f.get("abr") or 0
        current_best = by_acodec.get(ext)
        if not current_best or abr > (current_best.get("abr") or 0):
            by_acodec[ext] = f

    for ext, f in sorted(by_acodec.items(), key=lambda x: -(x[1].get("abr") or 0)):
        abr = round(f.get("abr") or 0)
        abr_str = f", {abr} kbps" if abr else ""
        filesize = f.get("filesize") or f.get("filesize_approx")
        size_str = f" · {round(filesize / (1024 * 1024), 1)} MB" if filesize else ""
        audio_formats.append({
            "format_id": f.get("format_id"),
            "ext": ext,
            "label": f"Original ({ext}{abr_str}){size_str}",
        })

    return {
        "title": info.get("title") or "Untitled",
        "duration": info.get("duration") or 0,
        "thumbnail": info.get("thumbnail") or "",
        "video_formats": video_formats,
        "audio_formats": audio_formats,
    }
