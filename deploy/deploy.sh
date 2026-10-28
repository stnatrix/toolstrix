#!/usr/bin/env bash
set -euo pipefail

TARGET_HOST="vps"
TARGET_DIR="/opt/toolstrix"
ACTION="${1:-staging}"

if [ "$ACTION" = "swap" ]; then
    echo "Swapping Nginx configuration to toolstrix 2.0 (port 8098)..."
    ssh "$TARGET_HOST" bash <<'EOF'
set -euo pipefail

echo "Verifying toolstrix health before cutover..."
curl -fsS http://127.0.0.1:8098/health > /dev/null

cp /opt/toolstrix/deploy/nginx.conf /etc/nginx/sites-available/toolstrix.conf
rm -f /etc/nginx/sites-enabled/ytdlp-web.conf
ln -sf /etc/nginx/sites-available/toolstrix.conf /etc/nginx/sites-enabled/toolstrix.conf

nginx -t
systemctl reload nginx

echo "Disabling legacy ytdlp-web service and updater..."
systemctl stop ytdlp-web 2>/dev/null || true
systemctl disable ytdlp-web 2>/dev/null || true
systemctl stop ytdlp-update.timer 2>/dev/null || true
systemctl disable ytdlp-update.timer 2>/dev/null || true

echo "Cutover complete. tools.stnatrix.space is now serving toolstrix 2.0."
EOF
    exit 0
fi

echo "Deploying toolstrix to staging ($TARGET_DIR on $TARGET_HOST)..."

ssh "$TARGET_HOST" "
id -u ytdlpweb >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -d /opt/toolstrix ytdlpweb
mkdir -p $TARGET_DIR
"

rsync -avz \
    --exclude="config.toml" \
    --exclude=".venv" \
    --exclude="venv" \
    --exclude="ytdlp-env" \
    --exclude="ytdlp-env-prev" \
    --exclude=".git" \
    --exclude="__pycache__" \
    --exclude=".pytest_cache" \
    ./ "$TARGET_HOST:$TARGET_DIR/"

ssh "$TARGET_HOST" bash <<'EOF'
set -euo pipefail

cd /opt/toolstrix

if [ ! -d "venv" ]; then
    python3 -m venv venv
fi

./venv/bin/pip install --no-cache-dir -r requirements.txt

chmod +x deploy/*.sh
chown -R ytdlpweb:ytdlpweb /opt/toolstrix

cp deploy/toolstrix.service /etc/systemd/system/toolstrix.service
cp deploy/toolstrix-update.service /etc/systemd/system/toolstrix-update.service
cp deploy/toolstrix-update.timer /etc/systemd/system/toolstrix-update.timer

systemctl daemon-reload

if [ ! -f "config.toml" ]; then
    echo "================================================================="
    echo "NOTICE: /opt/toolstrix/config.toml does not exist yet."
    echo "Base files and virtual environment are ready."
    echo "Please create /opt/toolstrix/config.toml from config.example.toml:"
    echo "  cp /opt/toolstrix/config.example.toml /opt/toolstrix/config.toml"
    echo "  chown ytdlpweb:ytdlpweb /opt/toolstrix/config.toml"
    echo "  chmod 600 /opt/toolstrix/config.toml"
    echo "Then start the service with:"
    echo "  systemctl enable --now toolstrix"
    echo "  systemctl enable --now toolstrix-update.timer"
    echo "================================================================="
    exit 0
fi

chown ytdlpweb:ytdlpweb config.toml
chmod 600 config.toml

systemctl enable --now toolstrix
systemctl enable --now toolstrix-update.timer
systemctl restart toolstrix

sleep 1
echo "Checking staging health..."
curl -fsS http://127.0.0.1:8098/health
echo ""
echo "Staging is healthy and running on 127.0.0.1:8098."
echo "To test via SSH tunnel: ssh -L 8098:127.0.0.1:8098 vps"
echo "To execute atomic swap to production: ./deploy/deploy.sh swap"
EOF
