# stnatrix.space — Лог изменений

## [2026-07-10] — Сессия разработки

### Ребрендинг и UI

- Переименование проекта: natrix → natrix.hub → stnatrix.space
  - Логотип в хедере обновлён, заголовок вкладки браузера исправлен (убрана лишняя точка)
  - Суффикс активной вкладки теперь отображается как '/ dlp', '/ mpeg', '/ pass'
- Точки в подзаголовках разделов: 'natrix dlp' → 'natrix.dlp', аналогично для mpeg и pass
  - Точки стилизованы цветом соответствующей секции (бирюзовый / коралловый / лавандовый)
- Версия в футере: добавлен лейбл v0.8 в правый нижний угол, opacity 0.35, адаптивный

---

### Багфиксы

#### natrix.dlp — 403 Forbidden на YouTube Shorts
- Проблема: yt-dlp использовал web-клиент, который для Shorts требует JS-челленджа через deno.
- Фикс: добавлены extractor_args player_client android+web в оба ydl_opts.
  Android-клиент отдаёт медиаданные напрямую без антибот-защиты.

#### natrix.pass — сломанная шкала сложности в режиме «Фраза»
- Проблема: энтропия для фразы считалась по размеру словаря (max 59 бит).
- Фикс: унифицирован расчёт на посимвольный анализ пула для обоих режимов.

#### natrix.mpeg — ffmpeg.wasm не загружается
- Проблема цепочка:
  1. Nginx COEP: require-corp → браузер блокировал скрипты с unpkg.com (нет CORP заголовка)
  2. После смены на credentialless — ffmpeg.js грузил чанк 814.ffmpeg.js с unpkg, Security Error
  3. @ffmpeg/util@0.12.2 падал с 'exports is not defined' в браузерном контексте
- Финальный фикс: полный self-hosting всех ffmpeg-файлов в /static/ffmpeg/:
  * ffmpeg.js, 814.ffmpeg.js
  * ffmpeg-core.js, ffmpeg-core.wasm (~32МБ), ffmpeg-core.worker.js (core-mt)
  * @ffmpeg/util выброшен, _fetchFile и _toBlobURL инлайн в mpeg.js
  * Правильная загрузка core-mt с workerURL
  * Защита от параллельных вызовов ensureFfmpeg() через shared promise

---

### Инфраструктура

- nginx COEP: require-corp → credentialless
- Cache busting: все локальные JS-скрипты версионированы ?v=1.0.x

---

### Текущее состояние

- Версия: v0.8
- Домен: https://yt.stnatrix.space
- Бэкенд: FastAPI + yt-dlp, порт 8099, сервис systemd ytdlp-web.service
- Модули: natrix.dlp (OK) | natrix.mpeg (в процессе) | natrix.pass (OK)
