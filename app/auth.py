import base64
import hashlib
import hmac
import json
import time
from collections import defaultdict
from fastapi import Request, HTTPException, status
from fastapi.responses import RedirectResponse
from itsdangerous import TimestampSigner, BadSignature
from app.core.config import config
from app.core.logging import logger

COOKIE_NAME = "toolstrix_session"

class RateLimiter:
    def __init__(self, limit: int = 5, window_seconds: int = 60) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self.attempts: dict[str, list[float]] = defaultdict(list)

    def is_blocked(self, ip: str) -> bool:
        now = time.time()
        self._prune(ip, now)
        return len(self.attempts[ip]) >= self.limit

    def record_failure(self, ip: str) -> None:
        now = time.time()
        self._prune(ip, now)
        self.attempts[ip].append(now)

    def reset(self, ip: str) -> None:
        if ip in self.attempts:
            del self.attempts[ip]

    def _prune(self, ip: str, now: float) -> None:
        cutoff = now - self.window_seconds
        self.attempts[ip] = [t for t in self.attempts[ip] if t > cutoff]

rate_limiter = RateLimiter(
    limit=config.auth.rate_limit_per_minute,
    window_seconds=60,
)

def get_client_ip(request: Request) -> str:
    real_ip = request.headers.get("X-Real-IP")
    if real_ip and real_ip.strip():
        return real_ip.strip()
    if request.client and request.client.host:
        return request.client.host
    return "127.0.0.1"

def compute_key_hash(secret_key: str) -> str:
    return hashlib.sha256(secret_key.strip().encode("utf-8")).hexdigest()[:16]

def create_session_token() -> str:
    signer = TimestampSigner(config.auth.session_secret, salt="toolstrix-auth")
    payload = {
        "key_hash": compute_key_hash(config.auth.secret_key),
        "exp": int(time.time() + (config.auth.session_ttl_days * 86400)),
    }
    raw_bytes = json.dumps(payload).encode("utf-8")
    b64_payload = base64.urlsafe_b64encode(raw_bytes).decode("ascii")
    signed = signer.sign(b64_payload.encode("ascii"))
    return signed.decode("ascii")

def verify_session_token(token: str | None) -> bool:
    if not token:
        return False
    signer = TimestampSigner(config.auth.session_secret, salt="toolstrix-auth")
    try:
        unsigned = signer.unsign(token.encode("ascii"), max_age=config.auth.session_ttl_days * 86400)
        raw_bytes = base64.urlsafe_b64decode(unsigned)
        payload = json.loads(raw_bytes.decode("utf-8"))
        if not isinstance(payload, dict):
            return False
        if payload.get("exp", 0) < time.time():
            return False
        current_hash = compute_key_hash(config.auth.secret_key)
        if not hmac.compare_digest(payload.get("key_hash", ""), current_hash):
            return False
        return True
    except (BadSignature, Exception):
        return False

def verify_access_key(candidate: str) -> bool:
    if not candidate:
        return False
    return hmac.compare_digest(candidate.strip(), config.auth.secret_key.strip())

def is_authenticated(request: Request) -> bool:
    token = request.cookies.get(COOKIE_NAME)
    return verify_session_token(token)

async def require_auth(request: Request) -> bool:
    if is_authenticated(request):
        return True
    accept = request.headers.get("accept", "")
    if "text/html" in accept or request.url.path in ("/", "/index.html"):
        raise HTTPException(
            status_code=status.HTTP_303_SEE_OTHER,
            headers={"Location": "/login"},
        )
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required",
    )
