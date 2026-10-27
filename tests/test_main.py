import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from main import app
from app.core.config import config
from app.auth import COOKIE_NAME, create_session_token

client = TestClient(app)

def test_health_endpoint():
    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert "ytdlp_version" in data
    assert "active_jobs" in data

def test_static_accessible_without_auth():
    res = client.get("/static/css/main.css")
    assert res.status_code == 200
    assert "Nunito" in res.text

def test_login_flow():
    res_page = client.get("/login")
    assert res_page.status_code == 200
    assert "toolstrix" in res_page.text

    res_fail = client.post("/login", json={"key": "wrong_key"})
    assert res_fail.status_code == 401

    res_ok = client.post("/login", json={"key": config.auth.secret_key})
    assert res_ok.status_code == 200
    assert COOKIE_NAME in res_ok.cookies

def test_index_auth_enforcement():
    res_unauth = client.get("/", follow_redirects=False)
    assert res_unauth.status_code == 303
    assert res_unauth.headers.get("Location") == "/login"

    token = create_session_token()
    client.cookies.set(COOKIE_NAME, token)
    res_auth = client.get("/")
    assert res_auth.status_code == 200
    assert "toolstrix" in res_auth.text
    client.cookies.clear()

def test_logout():
    token = create_session_token()
    client.cookies.set(COOKIE_NAME, token)
    res = client.post("/logout")
    assert res.status_code == 200
    client.cookies.clear()

def test_api_probe_requires_auth():
    res = client.post("/api/probe", json={"url": "https://example.com/test"})
    assert res.status_code == 401

def test_api_jobs_validation():
    token = create_session_token()
    client.cookies.set(COOKIE_NAME, token)

    res_invalid = client.post("/api/jobs", json={
        "url": "https://example.com/test",
        "video_format_id": "__none__",
        "audio_format_id": "__none__",
    })
    assert res_invalid.status_code == 400

    with patch("app.ytdlp.jobs.job_manager.is_server_busy", return_value=True):
        res_busy = client.post("/api/jobs", json={
            "url": "https://example.com/test",
            "video_format_id": "137",
            "audio_format_id": "140",
        })
        assert res_busy.status_code == 503

    client.cookies.clear()

def test_api_jobs_not_found():
    token = create_session_token()
    client.cookies.set(COOKIE_NAME, token)
    res = client.get("/api/jobs/nonexistent12")
    assert res.status_code == 404
    client.cookies.clear()
