#!/usr/bin/env bash
set -euo pipefail

HEALTH_URL="http://127.0.0.1:8098/health"
STATUS_FILE="/opt/toolstrix/updater_status.json"
VENV_PYTHON="/opt/toolstrix/venv/bin/python"
VENV_PIP="/opt/toolstrix/venv/bin/pip"
VENV_YTDLP="/opt/toolstrix/venv/bin/yt-dlp"
CONFIG_FILE="/opt/toolstrix/config.toml"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

ACTIVE_JOBS=$($VENV_PYTHON -c "
import urllib.request, json
try:
    with urllib.request.urlopen('$HEALTH_URL', timeout=5) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        print(int(data.get('active_jobs', 0)))
except Exception:
    print(0)
" 2>/dev/null || echo "0")

if [ "$ACTIVE_JOBS" -gt 0 ]; then
    echo "Active downloads currently in progress ($ACTIVE_JOBS). Skipping update."
    exit 0
fi

BEFORE=$($VENV_YTDLP --version 2>/dev/null || echo "unknown")

COOKIES_ARG=()
if [ -f "$CONFIG_FILE" ]; then
    COOKIE_PATH=$($VENV_PYTHON -c "
import tomllib
try:
    with open('$CONFIG_FILE', 'rb') as f:
        cfg = tomllib.load(f)
        print(cfg.get('download', {}).get('cookies_file', ''))
except Exception:
    print('')
" 2>/dev/null || echo "")

    if [ -n "$COOKIE_PATH" ] && [ -f "$COOKIE_PATH" ]; then
        COOKIES_ARG=("--cookies" "$COOKIE_PATH")
    fi
fi

$VENV_PIP install --no-cache-dir -U --pre "yt-dlp[default]"
AFTER=$($VENV_YTDLP --version 2>/dev/null || echo "unknown")

if "$VENV_YTDLP" "${COOKIES_ARG[@]}" --dump-single-json --skip-download "https://www.youtube.com/watch?v=aqz-KE-bpKQ" > /dev/null 2>&1; then
    cat <<EOF > "$STATUS_FILE"
{
  "last_updated": "$NOW",
  "version": "$AFTER",
  "status": "ok",
  "previous_version": "$BEFORE"
}
EOF
    systemctl restart toolstrix
    echo "yt-dlp updated successfully ($BEFORE -> $AFTER) and toolstrix restarted."
else
    echo "Smoke test failed for yt-dlp $AFTER. Rolling back to $BEFORE..."
    if [ "$BEFORE" != "unknown" ]; then
        $VENV_PIP install --no-cache-dir "yt-dlp==$BEFORE"
    fi
    cat <<EOF > "$STATUS_FILE"
{
  "last_updated": "$NOW",
  "version": "$BEFORE",
  "status": "failed",
  "attempted_version": "$AFTER",
  "error": "Smoke test failed"
}
EOF
    exit 1
fi
