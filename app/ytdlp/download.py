import re
import sys
from pathlib import Path
from app.core.config import config

def clean_filename(name: str) -> str:
    cleaned = re.sub(r'[\\/*?:"<>|]', "_", name)
    cleaned = cleaned.strip(" .")
    return (cleaned or "media")[:150]

def ascii_fallback_filename(filename: str, fallback: str = "media") -> str:
    path = Path(filename)
    raw_stem = path.stem
    raw_ext = path.suffix
    clean_stem = re.sub(r"[^a-zA-Z0-9_\-]", "", raw_stem).strip(" .-_")
    clean_ext = re.sub(r"[^a-zA-Z0-9_.]", "", raw_ext).strip(" .")
    if clean_ext and not clean_ext.startswith("."):
        clean_ext = f".{clean_ext}"
    if not clean_stem:
        clean_stem = fallback
    result = f"{clean_stem}{clean_ext}" if clean_ext else clean_stem
    try:
        result.encode("ascii")
        return result
    except UnicodeEncodeError:
        return f"{fallback}.mp4"

def build_download_command(
    url: str,
    video_format_id: str,
    audio_format_id: str,
    output_template: str,
) -> list[str]:
    cmd = [
        sys.executable,
        "-m",
        "yt_dlp",
        "--newline",
        "--no-playlist",
        "--progress",
        "--postprocessor-args",
        "ffmpeg:-threads 1",
        "--buffer-size",
        "16K",
        "--http-chunk-size",
        "10M",
        "--remote-components",
        "ejs:github",
        "-o",
        output_template,
    ]

    if config.download.cookies_file:
        cookie_path = Path(config.download.cookies_file)
        if cookie_path.exists() and cookie_path.is_file():
            cmd.extend(["--cookies", str(cookie_path)])

    is_no_video = video_format_id in ("__none__", "none", "", None)
    is_no_audio = audio_format_id in ("__none__", "none", "", None)

    if is_no_video and is_no_audio:
        raise ValueError("Cannot select both no video and no audio")

    if is_no_video:
        if audio_format_id == "__mp3__":
            cmd.extend([
                "-f", "bestaudio/best",
                "--extract-audio",
                "--audio-format", "mp3",
                "--audio-quality", "192k",
            ])
        else:
            clean_audio = re.sub(r"[^a-zA-Z0-9_\-]", "", audio_format_id)
            cmd.extend(["-f", f"{clean_audio}/bestaudio/best"])
    elif is_no_audio:
        clean_video = re.sub(r"[^a-zA-Z0-9_\-]", "", video_format_id)
        cmd.extend(["-f", f"{clean_video}/bestvideo/best"])
    else:
        clean_video = re.sub(r"[^a-zA-Z0-9_\-]", "", video_format_id)
        if audio_format_id == "__mp3__":
            cmd.extend([
                "-f", f"{clean_video}+bestaudio/best",
                "--merge-output-format", "mp4",
            ])
        else:
            clean_audio = re.sub(r"[^a-zA-Z0-9_\-]", "", audio_format_id)
            cmd.extend([
                "-f", f"{clean_video}+{clean_audio}/{clean_video}+bestaudio/best",
                "--merge-output-format", "mp4",
            ])

    cmd.append(url)
    return cmd

def find_completed_file(directory: Path) -> Path | None:
    excluded = {".part", ".ytdl", ".temp", ".tmp"}
    files = [
        f for f in directory.iterdir()
        if f.is_file() and f.suffix.lower() not in excluded and not f.name.startswith(".")
    ]
    if not files:
        return None
    return max(files, key=lambda f: f.stat().st_size)
