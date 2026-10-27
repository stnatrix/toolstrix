import os
import tomllib
from dataclasses import dataclass
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent

@dataclass(frozen=True)
class ServerConfig:
    host: str = "127.0.0.1"
    port: int = 8098

@dataclass(frozen=True)
class AuthConfig:
    secret_key: str = "change_me_secret_key"
    session_secret: str = "change_me_session_secret"
    session_ttl_days: int = 30
    rate_limit_per_minute: int = 5

@dataclass(frozen=True)
class DownloadConfig:
    max_concurrent_downloads: int = 1
    download_timeout_seconds: int = 900
    cookies_file: str = ""
    temp_dir: str = ""

@dataclass(frozen=True)
class AppConfig:
    server: ServerConfig
    auth: AuthConfig
    download: DownloadConfig

def load_config(config_path: Path | None = None) -> AppConfig:
    target_path = config_path or (BASE_DIR / "config.toml")
    if not target_path.exists():
        fallback_path = BASE_DIR / "config.example.toml"
        if fallback_path.exists():
            target_path = fallback_path

    raw_data: dict = {}
    if target_path.exists():
        with open(target_path, "rb") as f:
            raw_data = tomllib.load(f)

    srv = raw_data.get("server", {})
    ath = raw_data.get("auth", {})
    dlp = raw_data.get("download", {})

    server_cfg = ServerConfig(
        host=srv.get("host", "127.0.0.1"),
        port=int(srv.get("port", 8098)),
    )
    auth_cfg = AuthConfig(
        secret_key=ath.get("secret_key", "change_me_secret_key"),
        session_secret=ath.get("session_secret", "change_me_session_secret"),
        session_ttl_days=int(ath.get("session_ttl_days", 30)),
        rate_limit_per_minute=int(ath.get("rate_limit_per_minute", 5)),
    )
    download_cfg = DownloadConfig(
        max_concurrent_downloads=int(dlp.get("max_concurrent_downloads", 1)),
        download_timeout_seconds=int(dlp.get("download_timeout_seconds", 900)),
        cookies_file=dlp.get("cookies_file", ""),
        temp_dir=dlp.get("temp_dir", ""),
    )
    return AppConfig(server=server_cfg, auth=auth_cfg, download=download_cfg)

config = load_config()
