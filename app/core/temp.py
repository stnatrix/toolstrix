import shutil
import tempfile
import time
from pathlib import Path
from app.core.config import config
from app.core.logging import logger

def get_temp_root() -> Path:
    if config.download.temp_dir:
        root = Path(config.download.temp_dir)
    else:
        root = Path(tempfile.gettempdir()) / "toolstrix"
    root.mkdir(parents=True, exist_ok=True)
    return root

def create_session_dir(session_id: str) -> Path:
    root = get_temp_root()
    session_dir = root / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    return session_dir

def cleanup_session_dir(session_dir: Path | str | None) -> None:
    if not session_dir:
        return
    path = Path(session_dir)
    try:
        if path.exists() and path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
    except Exception as exc:
        logger.warning(f"Failed to remove session dir: {exc}")

def cleanup_stale_temp(max_age_seconds: int = 7200) -> None:
    root = get_temp_root()
    now = time.time()
    try:
        for item in root.iterdir():
            try:
                if item.is_dir() and (now - item.stat().st_mtime > max_age_seconds):
                    shutil.rmtree(item, ignore_errors=True)
                elif item.is_file() and (now - item.stat().st_mtime > max_age_seconds):
                    item.unlink(missing_ok=True)
            except Exception:
                pass
    except Exception:
        pass
