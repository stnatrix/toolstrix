#!/usr/bin/env bash
set -euo pipefail

TARGET_HOST="vps"

echo "Rolling back Nginx to legacy ytdlp-web (port 8099)..."
ssh "$TARGET_HOST" bash <<'EOF'
set -euo pipefail

if [ -f "/etc/nginx/sites-available/ytdlp-web.conf" ]; then
    rm -f /etc/nginx/sites-enabled/toolstrix.conf
    ln -sf /etc/nginx/sites-available/ytdlp-web.conf /etc/nginx/sites-enabled/ytdlp-web.conf
    nginx -t
    systemctl reload nginx
    systemctl enable --now ytdlp-web 2>/dev/null || true
    echo "Rollback successful. tools.stnatrix.space restored to legacy ytdlp-web."
else
    echo "Legacy configuration /etc/nginx/sites-available/ytdlp-web.conf not found."
    exit 1
fi
EOF
