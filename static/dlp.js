(function () {
  const ENDPOINTS = {
    formats: '/api/formats',
    download: '/api/download',
  };

  const el = {
    modeToggle: document.getElementById('dlp-mode-toggle'),
    url: document.getElementById('dlp-url'),
    hint: document.getElementById('dlp-hint'),
    formatsBox: document.getElementById('dlp-formats'),
    progressWrap: document.getElementById('dlp-progress-wrap'),
    progressBar: document.getElementById('dlp-progress-bar'),
    status: document.getElementById('dlp-status'),
    fetchBtn: document.getElementById('dlp-fetch-btn'),
  };

  let mode = 'quick';
  let chosenFormatId = null;
  let chosenIsAudio = false;
  let formatsLoadedForUrl = null;

  function setStatus(msg, isError) {
    el.status.textContent = msg;
    el.status.className = 'status-line' + (isError ? ' error' : msg ? ' ok' : '');
  }

  function setBusy(busy) {
    el.fetchBtn.disabled = busy;
  }

  el.modeToggle.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (window.natrixSFX) window.natrixSFX.playClick();
      mode = btn.dataset.mode;
      el.modeToggle.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
      el.hint.textContent = mode === 'quick'
        ? 'Скачает видео в 1080p автоматически (video+audio).'
        : 'Покажем доступные форматы и превью ролика — выберешь вручную, включая режим «только аудио».';
      el.formatsBox.style.display = 'none';
      chosenFormatId = null;
      chosenIsAudio = false;
      formatsLoadedForUrl = null;
    });
  });

  async function loadFormats(url) {
    setStatus('Получаю список форматов...', false);
    const qs = new URLSearchParams({ url });
    const resp = await fetch(`${ENDPOINTS.formats}?${qs.toString()}`);
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.detail || `Сервер ответил ${resp.status}`);
    }
    const data = await resp.json();
    renderFormats(data);
    formatsLoadedForUrl = url;
  }

  function renderFormats(data) {
    const formats = data.formats || [];
    if (!formats.length) {
      el.formatsBox.innerHTML = '<div class="status-line error">Форматы не найдены.</div>';
      el.formatsBox.style.display = 'block';
      return;
    }

    const durationStr = data.duration
      ? new Date(data.duration * 1000).toISOString().substr(11, 8).replace(/^00:/, '')
      : '';

    el.formatsBox.innerHTML = `
      ${data.thumbnail ? `<img class="preview" src="${data.thumbnail}" style="max-height:160px;">` : ''}
      ${data.title ? `<div style="font-size:14px;margin-bottom:12px;">${escapeHtml(data.title)} ${durationStr ? `<span class="badge">${durationStr}</span>` : ''}</div>` : ''}
      <label class="field-label">Формат</label>
      <select id="dlp-format-select">
        <option value="__audio__">🎵 Только аудио (mp3)</option>
        ${formats.map((f) => `<option value="${f.format_id}">${escapeHtml(f.label)}${f.ext ? ' · ' + f.ext : ''}</option>`).join('')}
      </select>
    `;
    el.formatsBox.style.display = 'block';

    const select = document.getElementById('dlp-format-select');
    syncChoiceFromSelect(select.value);
    select.addEventListener('change', () => syncChoiceFromSelect(select.value));
    setStatus('', false);
  }

  function syncChoiceFromSelect(value) {
    if (value === '__audio__') {
      chosenIsAudio = true;
      chosenFormatId = null;
    } else {
      chosenIsAudio = false;
      chosenFormatId = value;
    }
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  async function startDownload() {
    const url = el.url.value.trim();
    if (!url) {
      setStatus('Вставь ссылку.', true);
      return;
    }

    if (mode === 'advanced' && formatsLoadedForUrl !== url) {
      setBusy(true);
      el.progressWrap.classList.add('active');
      el.progressBar.style.width = '30%';
      try {
        await loadFormats(url);
      } catch (err) {
        setStatus('Ошибка: ' + (err.message || err), true);
      } finally {
        setBusy(false);
        el.progressWrap.classList.remove('active');
        el.progressBar.style.width = '0%';
      }
      return;
    }

    if (window.natrixSFX) window.natrixSFX.playClick();
    setBusy(true);
    el.progressWrap.classList.add('active');
    el.progressBar.style.width = '60%';
    setStatus('Скачиваю (это может занять время)...', false);

    try {
      const qs = new URLSearchParams({ url });

      if (mode === 'advanced' && chosenIsAudio) {
        qs.set('mode', 'audio');
      } else if (mode === 'advanced' && chosenFormatId) {
        qs.set('mode', 'video');
        qs.set('format_id', chosenFormatId);
      } else {
        qs.set('mode', 'quick');
      }

      const resp = await fetch(`${ENDPOINTS.download}?${qs.toString()}`);
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.detail || `Сервер ответил ${resp.status}`);
      }

      const blob = await resp.blob();
      el.progressBar.style.width = '100%';

      const disposition = resp.headers.get('Content-Disposition') || '';
      const starMatch = disposition.match(/filename\*=UTF-8''([^;]+)/);
      const plainMatch = disposition.match(/filename="?([^";]+)"?/);
      const filename = starMatch
        ? decodeURIComponent(starMatch[1])
        : (plainMatch ? plainMatch[1] : 'download');

      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = dlUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(dlUrl);

      setStatus('Готово: ' + filename, false);
      if (window.natrixSFX) window.natrixSFX.playSuccess();
    } catch (err) {
      console.error(err);
      setStatus('Ошибка: ' + (err.message || err), true);
    } finally {
      setBusy(false);
      setTimeout(() => {
        el.progressWrap.classList.remove('active');
        el.progressBar.style.width = '0%';
      }, 800);
    }
  }

  el.fetchBtn.addEventListener('click', startDownload);
})();
