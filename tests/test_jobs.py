import asyncio
import pytest
from pathlib import Path
from urllib.parse import quote
from unittest.mock import AsyncMock, patch, MagicMock
from app.ytdlp.download import clean_filename, ascii_fallback_filename, build_download_command
from app.ytdlp.jobs import JobManager, Job

def test_clean_filename():
    assert clean_filename("simple_name.mp4") == "simple_name.mp4"
    assert clean_filename('video/with:illegal*chars?.mp4') == "video_with_illegal_chars_.mp4"
    assert clean_filename("   ...   ") == "media"
    assert clean_filename("") == "media"

def test_ascii_fallback_filename():
    assert ascii_fallback_filename("video_test.mp4") == "video_test.mp4"
    assert ascii_fallback_filename("русское_название.mp4") == "media.mp4"
    safe_utf8 = quote("русское.mp4")
    disp = f'attachment; filename="{ascii_fallback_filename("русское.mp4")}"; filename*=UTF-8\'\'{safe_utf8}'
    disp.encode("ascii")
    disp.encode("latin-1")

def test_build_download_command_variations():
    cmd_both = build_download_command("https://example.com/v", "137", "140", "/tmp/%(title)s.%(ext)s")
    assert "-f" in cmd_both
    assert "137+140/137+bestaudio/best" in cmd_both
    assert "--merge-output-format" in cmd_both

    cmd_video_only = build_download_command("https://example.com/v", "137", "__none__", "/tmp/%(title)s.%(ext)s")
    assert "137/bestvideo/best" in cmd_video_only

    cmd_audio_only = build_download_command("https://example.com/v", "__none__", "140", "/tmp/%(title)s.%(ext)s")
    assert "140/bestaudio/best" in cmd_audio_only

    cmd_mp3 = build_download_command("https://example.com/v", "__none__", "__mp3__", "/tmp/%(title)s.%(ext)s")
    assert "--extract-audio" in cmd_mp3
    assert "mp3" in cmd_mp3

    with pytest.raises(ValueError):
        build_download_command("https://example.com/v", "__none__", "__none__", "/tmp/%(title)s.%(ext)s")

def test_job_manager_lifecycle():
    manager = JobManager()
    job = manager.create_job("https://example.com/v", "137", "140")
    assert job.id in manager.jobs
    assert manager.get_job(job.id) is job
    assert job.status == "queued"

    manager.cleanup_job(job.id)
    assert job.file_path is None

def test_job_manager_busy():
    manager = JobManager()
    assert manager.is_server_busy() is False
    manager.active_count = 1
    assert manager.is_server_busy() is True

def test_job_execution_success(tmp_path):
    manager = JobManager()
    job = manager.create_job("https://example.com/v", "137", "140")
    job.session_dir = tmp_path

    dummy_out = tmp_path / "result.mp4"
    dummy_out.write_bytes(b"dummy_video_bytes")

    mock_proc = MagicMock()
    mock_proc.returncode = 0
    mock_proc.stdout = AsyncMock()
    mock_proc.stdout.readline = AsyncMock(side_effect=[
        b"[download]  50.0% of ~ 10.00MiB at 2.00MiB/s ETA 00:05\n",
        b"[Merger] Merging formats into result.mp4\n",
        b"",
    ])
    mock_proc.stderr = AsyncMock()
    mock_proc.stderr.readline = AsyncMock(return_value=b"")
    mock_proc.wait = AsyncMock(return_value=0)

    with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
        asyncio.run(manager.execute_job(job))

    assert job.status == "ready"
    assert job.progress == 100.0
    assert job.filename == "result.mp4"
    assert job.file_path == dummy_out
