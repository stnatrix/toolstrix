# Деплой на Frankfurt VPS

⚠️ **НЕ трогаем**: nginx-конфиги 3x-ui, сертификаты Hysteria2, существующие sites-enabled.
Всё что ниже — новые файлы, новый порт (8099), новый systemd-сервис, новый nginx-конфиг.

## 1. Подготовка сервера

```bash
# создаём отдельного непривилегированного пользователя — сервис не должен работать от root
sudo useradd -r -s /usr/sbin/nologin -d /opt/ytdlp-web ytdlpweb

sudo mkdir -p /opt/ytdlp-web
sudo apt update && sudo apt install -y python3-venv python3-pip ffmpeg
```

## 2. Заливаем проект

Скопируй файлы (main.py, static/, requirements.txt) в `/opt/ytdlp-web` любым способом (scp, git, rsync):

```bash
scp -r ./ytdlp-web/* user@frankfurt-vps:/tmp/ytdlp-web-upload/
ssh user@frankfurt-vps
sudo mv /tmp/ytdlp-web-upload/* /opt/ytdlp-web/
sudo chown -R ytdlpweb:ytdlpweb /opt/ytdlp-web
```

## 3. Виртуальное окружение

```bash
cd /opt/ytdlp-web
sudo -u ytdlpweb python3 -m venv venv
sudo -u ytdlpweb ./venv/bin/pip install -r requirements.txt
```

## 4. Токен доступа

Сгенерируй длинный случайный токен:

```bash
openssl rand -hex 24
```

Впиши его в `ytdlp-web.service` вместо `ЗАМЕНИ_МЕНЯ_НА_СВОЙ_ТОКЕН`.
**Сохрани этот токен себе** (менеджер паролей) — он же будет частью твоей закладки в браузере.

## 5. systemd

```bash
sudo cp ytdlp-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable ytdlp-web
sudo systemctl start ytdlp-web
sudo systemctl status ytdlp-web   # проверяем что запустился (active: running)
```

## 6. Nginx — только новый конфиг, существующие не трогаем

```bash
# замени yt.ТВОЙДОМЕН.com на реальный поддомен внутри файла
sudo cp nginx-ytdlp.conf /etc/nginx/sites-available/ytdlp-web.conf
sudo ln -s /etc/nginx/sites-available/ytdlp-web.conf /etc/nginx/sites-enabled/

sudo nginx -t          # ОБЯЗАТЕЛЬНО проверить конфиг перед reload
sudo systemctl reload nginx   # именно reload, не restart — не роняет существующие соединения (в т.ч. VPN)
```

## 7. Cloudflare

1. Добавь A-запись: `yt` → IP твоего Frankfurt VPS, статус **Proxied** (оранжевое облачко) — это скроет реальный IP.
2. SSL/TLS режим для домена (Overview → SSL/TLS): поставь **Flexible** (Cloudflare↔сервер по http, сервер слушает 80 — это ок для личного проекта) либо, если хочешь строже — **Full** с self-signed сертификатом на nginx.
3. Не включай "Always Use HTTPS" глобально, если это может зацепить существующие домены/порты для VPN — проверь, что Hysteria2 использует свой отдельный порт/протокол (UDP обычно), тогда конфликта не будет.

## 8. Проверка

Открой на телефоне или ПК:

```
https://yt.ТВОЙДОМЕН.com/?t=ТВОЙ_ТОКЕН
```

Сохрани эту ссылку как закладку/на главный экран телефона.

## 9. Автоочистка временных файлов (на случай обрывов)

Файлы сами удаляются после отправки клиенту, но если скачивание оборвётся на середине —
папка в /tmp может остаться. Добавь cron на всякий случай:

```bash
sudo crontab -e
# добавить строку:
0 * * * * find /tmp/ytdlp-web -mmin +120 -exec rm -rf {} + 2>/dev/null
```

## Обновление в будущем

```bash
sudo systemctl stop ytdlp-web
# заливаешь новые файлы в /opt/ytdlp-web
sudo systemctl start ytdlp-web
```

## Откат / удаление (если что-то пошло не так)

```bash
sudo systemctl stop ytdlp-web
sudo systemctl disable ytdlp-web
sudo rm /etc/systemd/system/ytdlp-web.service
sudo rm /etc/nginx/sites-enabled/ytdlp-web.conf
sudo rm /etc/nginx/sites-available/ytdlp-web.conf
sudo nginx -t && sudo systemctl reload nginx
```

Всё это не затрагивает существующий 3x-ui/Hysteria2 — там свои конфиги и порты.
