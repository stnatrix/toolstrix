import os
import time
import tempfile
from pathlib import Path
from fastapi.testclient import TestClient

from main import app, _safe_filename, _clean_stale_temp, TMP_DIR

client = TestClient(app)

def test_index_headers():
    response = client.get("/")
    assert response.status_code == 200
    assert response.headers.get("Cross-Origin-Opener-Policy") == "same-origin"
    assert response.headers.get("Cross-Origin-Embedder-Policy") == "require-corp"
    assert response.headers.get("Cache-Control") == "no-cache"

def test_static_headers():
    response = client.get("/static/app.js")
    assert response.status_code == 200
    assert response.headers.get("Cross-Origin-Opener-Policy") == "same-origin"
    assert response.headers.get("Cross-Origin-Embedder-Policy") == "require-corp"
    assert response.headers.get("Cache-Control") == "no-cache"

def test_sw_headers():
    response = client.get("/sw.js")
    assert response.status_code == 200
    assert response.headers.get("Cross-Origin-Opener-Policy") == "same-origin"
    assert response.headers.get("Cross-Origin-Embedder-Policy") == "require-corp"
    assert response.headers.get("Service-Worker-Allowed") == "/"
    assert response.headers.get("Cache-Control") == "no-cache"
    assert "javascript" in response.headers.get("content-type", "")

    # Also verify /static/sw.js carries Service-Worker-Allowed header
    res_static_sw = client.get("/static/sw.js")
    assert res_static_sw.status_code == 200
    assert res_static_sw.headers.get("Service-Worker-Allowed") == "/"

def test_manifest_headers():
    response = client.get("/manifest.webmanifest")
    assert response.status_code == 200
    assert response.headers.get("Cross-Origin-Opener-Policy") == "same-origin"
    assert response.headers.get("Cross-Origin-Embedder-Policy") == "require-corp"
    assert "manifest" in response.headers.get("content-type", "")

def test_favicon_headers():
    response = client.get("/favicon.ico")
    assert response.status_code == 200
    assert response.headers.get("Cross-Origin-Opener-Policy") == "same-origin"
    assert response.headers.get("Cross-Origin-Embedder-Policy") == "require-corp"

def test_safe_filename():
    assert _safe_filename("simple.mp4") == "simple.mp4"
    assert _safe_filename("hello/world:video?.mkv") == "hello_world_video_.mkv"
    assert _safe_filename("   ...   ") == "media"
    assert _safe_filename("") == "media"
    assert _safe_filename("русское_название_видео.mp4") == "русское_название_видео.mp4"
    long_name = "a" * 200 + ".mp4"
    assert len(_safe_filename(long_name)) <= 150

def test_clean_stale_temp():
    old_dir = TMP_DIR / "test_old_session"
    old_dir.mkdir(parents=True, exist_ok=True)
    
    three_hours_ago = time.time() - 11000
    os.utime(old_dir, (three_hours_ago, three_hours_ago))
    
    recent_dir = TMP_DIR / "test_recent_session"
    recent_dir.mkdir(parents=True, exist_ok=True)
    
    _clean_stale_temp(max_age_sec=7200)
    
    assert not old_dir.exists(), "Old session directory should be cleaned up"
    assert recent_dir.exists(), "Recent session directory should remain"
    
    import shutil
    shutil.rmtree(recent_dir, ignore_errors=True)

def test_api_compress_validation():
    res = client.post(
        "/api/compress",
        data={
            "video_bitrate_kbps": 1000,
            "target_height": 720,
            "audio_mode": "keep",
            "preset": "invalid_preset",
        },
        files={"file": ("test.mp4", b"dummy video content", "video/mp4")}
    )
    assert res.status_code == 400
    assert "Недопустимый preset" in res.json()["detail"]

    res = client.post(
        "/api/compress",
        data={
            "video_bitrate_kbps": 1000,
            "target_height": 720,
            "audio_mode": "unknown_mode",
            "preset": "medium",
        },
        files={"file": ("test.mp4", b"dummy video content", "video/mp4")}
    )
    assert res.status_code == 400
    assert "Недопустимый audio_mode" in res.json()["detail"]

    res = client.post(
        "/api/compress",
        data={
            "video_bitrate_kbps": 10,
            "target_height": 720,
            "audio_mode": "keep",
            "preset": "medium",
        },
        files={"file": ("test.mp4", b"dummy video content", "video/mp4")}
    )
    assert res.status_code == 400
    assert "video_bitrate_kbps" in res.json()["detail"]

def test_api_compress_empty_file():
    res = client.post(
        "/api/compress",
        data={
            "video_bitrate_kbps": 1000,
            "target_height": 720,
            "audio_mode": "keep",
            "preset": "medium",
        },
        files={"file": ("empty.mp4", b"", "video/mp4")}
    )
    assert res.status_code == 400
    assert "пустой" in res.json()["detail"].lower()

def test_api_compress_negative_target_size():
    res = client.post(
        "/api/compress",
        data={
            "video_bitrate_kbps": 1000,
            "target_height": 720,
            "audio_mode": "keep",
            "preset": "medium",
            "target_size_mb": -5,
        },
        files={"file": ("test.mp4", b"dummy video content", "video/mp4")}
    )
    assert res.status_code == 400
    assert "target_size_mb" in res.json()["detail"]

def test_url_scheme_validation():
    res = client.get("/api/formats?url=file:///etc/passwd")
    assert res.status_code == 400
    assert "http" in res.json()["detail"]

    res = client.get("/api/download?url=ftp://test.com/video.mp4")
    assert res.status_code == 400
    assert "http" in res.json()["detail"]

def test_real_server_compress_with_ffprobe():
    import subprocess
    test_video = TMP_DIR / "sample_test_video.mp4"
    gen_cmd = [
        "ffmpeg", "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=10",
        "-f", "lavfi", "-i", "sine=frequency=1000:duration=1",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", str(test_video)
    ]
    subprocess.run(gen_cmd, capture_output=True, check=True)
    
    from main import _get_video_duration
    duration = _get_video_duration(test_video)
    assert duration is not None and duration > 0.5, f"Expected duration ~1.0s, got {duration}"

    with open(test_video, "rb") as f:
        res = client.post(
            "/api/compress",
            data={
                "video_bitrate_kbps": 500,
                "target_height": 240,
                "audio_mode": "keep",
                "preset": "ultrafast",
                "target_size_mb": 1.0,
            },
            files={"file": ("sample.mp4", f, "video/mp4")}
        )
    assert res.status_code == 200
    assert res.headers["content-type"] == "video/mp4"
    assert len(res.content) > 0

    test_video.unlink(missing_ok=True)

def test_cyrillic_filename_and_audio_only_error():
    import subprocess
    test_video = TMP_DIR / "sample_cyrillic_test.mp4"
    gen_cmd = [
        "ffmpeg", "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=10",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", str(test_video)
    ]
    subprocess.run(gen_cmd, capture_output=True, check=True)

    with open(test_video, "rb") as f:
        res = client.post(
            "/api/compress",
            data={
                "video_bitrate_kbps": 500,
                "target_height": 240,
                "audio_mode": "keep",
                "preset": "ultrafast",
            },
            files={"file": ("привет_видео.mp4", f, "video/mp4")}
        )
    assert res.status_code == 200
    disp = res.headers.get("content-disposition", "")
    assert "filename=\"compressed.mp4\"" in disp
    assert "filename*=UTF-8''" in disp
    # Ensure header does not trigger UnicodeEncodeError when encoded to latin-1 / ascii
    disp.encode("latin-1")
    disp.encode("ascii")

    # Test audio-only file upload is rejected with 400 Bad Request
    test_audio = TMP_DIR / "sample_test_audio.mp3"
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=1000:duration=1", str(test_audio)], check=True, capture_output=True)

    with open(test_audio, "rb") as f:
        res_audio = client.post(
            "/api/compress",
            data={
                "video_bitrate_kbps": 500,
                "target_height": 240,
                "audio_mode": "keep",
                "preset": "ultrafast",
            },
            files={"file": ("audio_only.mp3", f, "audio/mpeg")}
        )
    assert res_audio.status_code == 400
    assert "видеопоток" in res_audio.json()["detail"].lower()

    test_video.unlink(missing_ok=True)
    test_audio.unlink(missing_ok=True)

def test_api_formats_deduplication():
    from unittest.mock import patch, MagicMock

    mock_info = {
        "title": "Test Video",
        "duration": 60,
        "thumbnail": "https://example.com/thumb.jpg",
        "formats": [
            # Storyboards
            {"format_id": "sb0", "vcodec": "none", "acodec": "none", "height": 180},
            # 2160p duplicates
            {"format_id": "625", "ext": "mp4", "vcodec": "vp09", "acodec": "none", "height": 2160, "filesize": None},
            {"format_id": "313", "ext": "webm", "vcodec": "vp9", "acodec": "none", "height": 2160, "filesize": 350000000},
            {"format_id": "401", "ext": "mp4", "vcodec": "av01", "acodec": "none", "height": 2160, "filesize": 240000000},
            # 1440p duplicates
            {"format_id": "620", "ext": "mp4", "vcodec": "vp09", "acodec": "none", "height": 1440, "filesize": None},
            {"format_id": "271", "ext": "webm", "vcodec": "vp9", "acodec": "none", "height": 1440, "filesize": 150000000},
            # 1080p duplicates
            {"format_id": "270", "ext": "mp4", "vcodec": "avc1", "acodec": "none", "height": 1080, "filesize": None},
            {"format_id": "137", "ext": "mp4", "vcodec": "avc1", "acodec": "none", "height": 1080, "filesize": 80000000},
            {"format_id": "248", "ext": "webm", "vcodec": "vp9", "acodec": "none", "height": 1080, "filesize": 30000000},
            # Audio-only
            {"format_id": "140", "ext": "m4a", "vcodec": "none", "acodec": "mp4a", "height": None, "filesize": 3000000},
        ],
    }

    mock_ydl = MagicMock()
    mock_ydl.__enter__.return_value.extract_info.return_value = mock_info

    with patch("yt_dlp.YoutubeDL", return_value=mock_ydl):
        res = client.get("/api/formats?url=https://youtube.com/watch?v=123")
        assert res.status_code == 200
        data = res.json()
        formats = data["formats"]

        heights = [f["height"] for f in formats]
        assert len(heights) == len(set(heights)), f"Duplicate heights found: {heights}"
        assert heights == [2160, 1440, 1080]

        fmt_1080 = next(f for f in formats if f["height"] == 1080)
        assert fmt_1080["format_id"] == "137"
        assert "76.3MB" in fmt_1080["label"]

def test_api_formats_error():
    res = client.get("/api/formats?url=invalid-url-not-a-video")
    assert res.status_code == 400

if __name__ == "__main__":
    test_index_headers()
    test_static_headers()
    test_sw_headers()
    test_manifest_headers()
    test_favicon_headers()
    test_safe_filename()
    test_clean_stale_temp()
    test_api_compress_validation()
    test_api_compress_empty_file()
    test_api_compress_negative_target_size()
    test_url_scheme_validation()
    test_real_server_compress_with_ffprobe()
    test_cyrillic_filename_and_audio_only_error()
    test_api_formats_error()
    test_api_formats_deduplication()
    print("All backend tests PASSED!")
