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

def test_api_formats_error():
    res = client.get("/api/formats?url=invalid-url-not-a-video")
    assert res.status_code == 400

if __name__ == "__main__":
    test_index_headers()
    test_static_headers()
    test_safe_filename()
    test_clean_stale_temp()
    test_api_compress_validation()
    test_api_formats_error()
    print("All backend tests PASSED!")
