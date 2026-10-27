import asyncio
import pytest
from unittest.mock import MagicMock, patch
from fastapi import Request, HTTPException
from app.core.config import AppConfig, ServerConfig, AuthConfig, DownloadConfig
from app.auth import (
    RateLimiter,
    get_client_ip,
    compute_key_hash,
    create_session_token,
    verify_session_token,
    verify_access_key,
    require_auth,
    COOKIE_NAME,
)

def test_key_hash():
    h1 = compute_key_hash("my_secret_key")
    h2 = compute_key_hash("my_secret_key")
    h3 = compute_key_hash("another_key")
    assert h1 == h2
    assert h1 != h3
    assert len(h1) == 16

def test_session_token_lifecycle():
    token = create_session_token()
    assert verify_session_token(token) is True
    assert verify_session_token(None) is False
    assert verify_session_token("") is False
    assert verify_session_token("invalid.token.signature") is False

def test_session_invalidated_on_key_change():
    token = create_session_token()
    assert verify_session_token(token) is True

    alt_config = AppConfig(
        server=ServerConfig(),
        auth=AuthConfig(secret_key="completely_different_key"),
        download=DownloadConfig(),
    )
    with patch("app.auth.config", alt_config):
        assert verify_session_token(token) is False

def test_rate_limiter():
    limiter = RateLimiter(limit=3, window_seconds=60)
    ip = "203.0.113.195"
    assert limiter.is_blocked(ip) is False
    limiter.record_failure(ip)
    limiter.record_failure(ip)
    assert limiter.is_blocked(ip) is False
    limiter.record_failure(ip)
    assert limiter.is_blocked(ip) is True
    limiter.reset(ip)
    assert limiter.is_blocked(ip) is False

def test_get_client_ip():
    req1 = MagicMock(spec=Request)
    req1.headers = {"X-Real-IP": "198.51.100.10", "X-Forwarded-For": "1.2.3.4"}
    req1.client = MagicMock(host="10.0.0.1")
    assert get_client_ip(req1) == "198.51.100.10"

    req2 = MagicMock(spec=Request)
    req2.headers = {"X-Forwarded-For": "1.2.3.4"}
    req2.client = MagicMock(host="10.0.0.2")
    assert get_client_ip(req2) == "10.0.0.2"

def test_verify_access_key():
    from app.core.config import config
    assert verify_access_key(config.auth.secret_key) is True
    assert verify_access_key(f"  {config.auth.secret_key}  ") is True
    assert verify_access_key("wrong_key") is False
    assert verify_access_key("") is False

def test_require_auth_redirect_for_html():
    req = MagicMock(spec=Request)
    req.cookies = {}
    req.headers = {"accept": "text/html,application/xhtml+xml"}
    req.url = MagicMock(path="/")
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(require_auth(req))
    assert exc_info.value.status_code == 303
    assert exc_info.value.headers.get("Location") == "/login"

def test_require_auth_401_for_api():
    req = MagicMock(spec=Request)
    req.cookies = {}
    req.headers = {"accept": "application/json"}
    req.url = MagicMock(path="/api/formats")
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(require_auth(req))
    assert exc_info.value.status_code == 401

def test_require_auth_success():
    token = create_session_token()
    req = MagicMock(spec=Request)
    req.cookies = {COOKIE_NAME: token}
    req.headers = {}
    req.url = MagicMock(path="/api/formats")
    assert asyncio.run(require_auth(req)) is True
