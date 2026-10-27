import pytest
from unittest.mock import MagicMock, patch
from fastapi import HTTPException
from app.ytdlp.probe import validate_url, probe_url
from app.ytdlp.errors import translate_ytdlp_error

def test_validate_url_ssrf_loopback():
    with pytest.raises(HTTPException) as exc_info:
        validate_url("http://127.0.0.1:8098/test")
    assert exc_info.value.status_code == 400
    assert "private or local" in exc_info.value.detail.lower()

def test_validate_url_ssrf_localhost():
    with pytest.raises(HTTPException) as exc_info:
        validate_url("http://localhost:2097/admin")
    assert exc_info.value.status_code == 400
    assert "local hosts" in exc_info.value.detail.lower()

def test_validate_url_invalid_scheme():
    with pytest.raises(HTTPException) as exc_info:
        validate_url("ftp://example.com/video.mp4")
    assert exc_info.value.status_code == 400
    assert "only http and https" in exc_info.value.detail.lower()

def test_translate_ytdlp_error():
    assert "bot verification" in translate_ytdlp_error("Sign in to confirm you’re not a bot").lower()
    assert "private" in translate_ytdlp_error("ERROR: This video is private").lower()
    assert "server region" in translate_ytdlp_error("Video is not available in your country").lower()
    assert "rate limit" in translate_ytdlp_error("HTTP Error 429: Too Many Requests").lower()

def test_probe_url_format_tiering():
    mock_info = {
        "title": "Sample Video",
        "duration": 120,
        "thumbnail": "https://example.com/thumb.jpg",
        "formats": [
            {"format_id": "sb0", "vcodec": "none", "acodec": "none", "height": 180},
            {"format_id": "137", "ext": "mp4", "vcodec": "avc1.640028", "acodec": "none", "height": 1080, "filesize": 50000000},
            {"format_id": "248", "ext": "webm", "vcodec": "vp9", "acodec": "none", "height": 1080, "filesize": 40000000},
            {"format_id": "136", "ext": "mp4", "vcodec": "avc1.4d401f", "acodec": "none", "height": 720, "filesize": 25000000},
            {"format_id": "140", "ext": "m4a", "vcodec": "none", "acodec": "mp4a.40.2", "abr": 128, "filesize": 2000000},
            {"format_id": "251", "ext": "opus", "vcodec": "none", "acodec": "opus", "abr": 160, "filesize": 2200000},
        ],
    }

    with patch("app.ytdlp.probe.validate_url", return_value="https://example.com/watch?v=123"):
        mock_ydl = MagicMock()
        mock_ydl.__enter__.return_value.extract_info.return_value = mock_info
        with patch("yt_dlp.YoutubeDL", return_value=mock_ydl):
            result = probe_url("https://example.com/watch?v=123")

    assert result["title"] == "Sample Video"
    assert result["duration"] == 120
    assert len(result["video_formats"]) == 2

    fmt_1080 = result["video_formats"][0]
    assert fmt_1080["height"] == 1080
    assert fmt_1080["format_id"] == "137"
    assert "1080p" in fmt_1080["label"]
    assert "47.7 MB" in fmt_1080["label"]

    assert any(a["format_id"] == "__mp3__" for a in result["audio_formats"])
    assert any("m4a" in a["label"] for a in result["audio_formats"])
    assert any("opus" in a["label"] for a in result["audio_formats"])
