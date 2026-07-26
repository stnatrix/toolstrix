# natrix — stnatrix.space

Личная панель из четырёх инструментов. Бэкенд — FastAPI, фронтенд — статика без сборки и без единого внешнего запроса.

| Модуль | Что делает | Где считает |
|---|---|---|
| **natrix.dlp** | Скачивание видео/аудио с любых площадок через yt-dlp | сервер |
| **natrix.mpeg** | Обрезка, громкость, фильтры, конвертация, ресайз/кроп картинок | браузер (ffmpeg.wasm) |
| **natrix.compress** | Сжатие видео под заданный размер в МБ | браузер, с fallback на сервер |
| **natrix.pass** | Генератор паролей и парольных фраз | браузер |

---

## Как зайти

Весь доступ — по токену в URL. Без него сервер отдаёт `403` даже на главную страницу.

```
https://yt.stnatrix.space/?t=ТОКЕН
```

Токен лежит в `Environment="YTDLP_TOKEN=..."` внутри `ytdlp-web.service` (на сервере — `/etc/systemd/system/ytdlp-web.service`). Ссылку целиком имеет смысл сохранить закладкой или на главный экран телефона.

Поменять токен:

```bash
sudo systemctl edit --full ytdlp-web    # правим YTDLP_TOKEN
sudo systemctl daemon-reload && sudo systemctl restart ytdlp-web
```

> Текущий токен закоммичен в репозиторий в `ytdlp-web.service` и `deploy_vps.md`. Пока репозиторий приватный — это терпимо; если он станет публичным, токен надо считать скомпрометированным и заменить.

## Локальный запуск

```bash
python -m venv venv && venv/bin/pip install -r requirements.txt
YTDLP_TOKEN=devtoken venv/bin/uvicorn main:app --host 127.0.0.1 --port 8099
```

Windows (PowerShell):

```powershell
python -m venv venv; .\venv\Scripts\pip install -r requirements.txt; $env:YTDLP_TOKEN='devtoken'; .\venv\Scripts\python -m uvicorn main:app --host 127.0.0.1 --port 8099
```

Открывать `http://127.0.0.1:8099/?t=devtoken`. Для natrix.dlp дополнительно нужен `ffmpeg` в PATH (склейка видео+аудио и конвертация в mp3).

Деплой на VPS — [DEPLOY.md](DEPLOY.md).

---

## Что нельзя ломать

Четыре инварианта, каждый из которых уже один раз убивал natrix.mpeg целиком.

**1. Cross-origin isolation.** `ffmpeg-core` собран в multi-thread варианте и требует `SharedArrayBuffer`, а тот доступен только на cross-origin isolated странице. Заголовки ставит middleware `cross_origin_isolation` в [main.py](main.py) — `COOP: same-origin` + `COEP: require-corp`. Убрать middleware = `SharedArrayBuffer is not defined` и мёртвые вкладки mpeg и compress. Дублировать эти же заголовки в nginx **нельзя**.

**2. Никаких внешних ресурсов на странице.** `require-corp` блокирует всё стороннее. Поэтому шрифты лежат в `static/fonts/`, ffmpeg — в `static/ffmpeg/`, словарь EFF — в `static/wordlist-en.js`. Вернуть `<link>` на fonts.googleapis.com — сломать и шрифты, и ffmpeg.

**3. `Cache-Control: no-cache` на `/static/`.** Воркер ffmpeg подтягивает свой чанк `814.ffmpeg.js` по фиксированному URL, `?v=` к нему не приделать. Ответ, закэшированный браузером до появления COEP-заголовков, потом отдаётся как `ERR_BLOCKED_BY_RESPONSE`, и ffmpeg молча виснет навсегда. `no-cache` (не `no-store`) заставляет браузер каждый раз проверять ETag.

**4. Явный `-threads` перед именем выходного файла.** Без него libx264 в wasm запрашивает потоков по числу ядер, в пуле pthread'ов их столько нет, и кодирование встаёт намертво после первого кадра — без ошибки, навсегда. Подставляется централизованно в `natrixSharedFFmpeg.exec()` ([ffmpeg-helper.js](static/ffmpeg-helper.js)); все вызовы ffmpeg идут только через него. Перед `-i` этот флаг не помогает — там он ограничивает декодер, а не энкодер.

## Обслуживание

**yt-dlp надо обновлять.** Это единственная регулярная задача: YouTube ломает извлечение раз в несколько месяцев, и старый yt-dlp начинает отвечать `Requested format is not available`. Версия в `requirements.txt` намеренно не закреплена.

```bash
sudo -u ytdlpweb /opt/ytdlp-web/venv/bin/pip install -U yt-dlp
sudo systemctl restart ytdlp-web
```

**Кэш после обновления фронтенда.** Все локальные скрипты версионированы через `?v=`. Поднял версию файла — подними и `?v=` в [static/index.html](static/index.html), иначе у браузера останется старый.

## Ограничения сервера

VPS слабый (1 CPU / 1 GB RAM), сервис ограничен в systemd: `MemoryMax=350M`, `CPUQuota=70%`. Поэтому:

* `natrix.mpeg` и `natrix.compress` считают в браузере — сервер не участвует вообще;
* серверное сжатие (`POST /api/compress`) — только аварийный fallback, когда браузерный ffmpeg не осилил кодек (AV1/HEVC). Оно ограничено `-threads 1`, таймаутом `YTDLP_COMPRESS_TIMEOUT` (600 с) и размером загрузки `YTDLP_MAX_UPLOAD_MB` (512 МБ);
* временные файлы пишутся в `/tmp/ytdlp-web` и удаляются после отдачи клиенту.

На том же сервере живут 3x-ui и Hysteria2. Их конфиги, порты и сертификаты не трогать; nginx перезапускать только через `reload`.
