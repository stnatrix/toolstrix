// ============================================================
// natrix mpeg — client-side video/image editing via ffmpeg.wasm
// Nothing is ever uploaded anywhere. Everything happens in-tab.
// ============================================================

const MPEG = (() => {


  let ffmpeg = null;
  let currentFile = null;      // { name, ext, kind: 'video'|'image', blob, url }
  let selectedTool = null;
  let resultBlob = null;

  const el = {
    dropzone: document.getElementById('mpeg-dropzone'),
    dropzoneText: document.getElementById('mpeg-dropzone-text'),
    fileInput: document.getElementById('mpeg-file-input'),
    loadStatus: document.getElementById('mpeg-load-status'),
    uploadCard: document.getElementById('mpeg-upload-card'),
    workspace: document.getElementById('mpeg-workspace'),
    previewWrap: document.getElementById('mpeg-preview-wrap'),
    fileInfo: document.getElementById('mpeg-file-info'),
    toolGrid: document.getElementById('mpeg-tool-grid'),
    toolOptions: document.getElementById('mpeg-tool-options'),
    progressWrap: document.getElementById('mpeg-progress-wrap'),
    progressBar: document.getElementById('mpeg-progress-bar'),
    status: document.getElementById('mpeg-status'),
    runBtn: document.getElementById('mpeg-run-btn'),
    resetBtn: document.getElementById('mpeg-reset-btn'),
    resultCard: document.getElementById('mpeg-result-card'),
    resultPreview: document.getElementById('mpeg-result-preview'),
    downloadBtn: document.getElementById('mpeg-download-btn'),
  };

  // ---------------------------------------------------------
  // ffmpeg loading (lazy — only when user opens mpeg & picks a file)
  // ---------------------------------------------------------
  async function ensureFfmpeg() {
    ffmpeg = await window.natrixSharedFFmpeg.ensure((msg, isError) => {
      setStatus(msg, isError);
    });

    window.natrixSharedFFmpeg.setProgressListener((progress) => {
      const pct = Math.min(100, Math.max(0, Math.round(progress * 100)));
      setProgress(pct);
    });
  }

  // Конвертирует File/Blob в Uint8Array для ffmpeg.writeFile()
  async function _fetchFile(file) {
    return window.natrixSharedFFmpeg.fetchFile(file);
  }


  // ---------------------------------------------------------
  // file handling
  // ---------------------------------------------------------
  function kindFromMime(type) {
    if (type.startsWith('video/')) return 'video';
    if (type.startsWith('image/')) return 'image';
    return null;
  }

  function extFromName(name) {
    const m = name.match(/\.([a-zA-Z0-9]+)$/);
    return m ? m[1].toLowerCase() : 'bin';
  }

  async function handleFile(file) {
    const kind = kindFromMime(file.type);
    if (!kind) {
      setLoadStatus('Формат не распознан. Нужно видео или картинка.', true);
      return;
    }

    currentFile = {
      name: file.name,
      ext: extFromName(file.name),
      kind,
      blob: file,
      url: URL.createObjectURL(file),
    };

    resultBlob = null;
    el.resultCard.style.display = 'none';
    selectedTool = null;

    renderPreview();
    renderToolGrid();
    el.uploadCard.style.display = 'none';
    el.workspace.style.display = 'block';

    // pre-warm ffmpeg in background so the first "Apply" feels instant
    ensureFfmpeg().catch((e) => {
      console.error(e);
    });
  }

  function renderPreview() {
    el.previewWrap.innerHTML = '';
    if (currentFile.kind === 'video') {
      const v = document.createElement('video');
      v.src = currentFile.url;
      v.controls = true;
      el.previewWrap.appendChild(v);
    } else {
      const img = document.createElement('img');
      img.src = currentFile.url;
      img.className = 'preview';
      el.previewWrap.appendChild(img);
    }
    const sizeMB = (currentFile.blob.size / (1024 * 1024)).toFixed(2);
    el.fileInfo.textContent = `${currentFile.name} · ${sizeMB} МБ · ${currentFile.kind}`;
  }

  function resetToUpload() {
    if (currentFile) URL.revokeObjectURL(currentFile.url);
    currentFile = null;
    resultBlob = null;
    el.fileInput.value = '';
    el.uploadCard.style.display = 'block';
    el.workspace.style.display = 'none';
    el.resultCard.style.display = 'none';
    setLoadStatus('', false);
  }

  // ---------------------------------------------------------
  // UI helpers
  // ---------------------------------------------------------
  function setStatus(msg, isError) {
    el.status.textContent = msg;
    el.status.className = 'status-line' + (isError ? ' error' : msg && !isError ? '' : '');
  }
  function setLoadStatus(msg, isError) {
    el.loadStatus.textContent = msg;
    el.loadStatus.className = 'status-line' + (isError ? ' error' : '');
  }
  function setProgress(pct) {
    if (pct <= 0) {
      el.progressWrap.classList.remove('active');
      return;
    }
    el.progressWrap.classList.add('active');
    el.progressBar.style.width = pct + '%';
  }
  function setBusy(busy) {
    el.runBtn.disabled = busy;
    el.resetBtn.disabled = busy;
  }

  // ---------------------------------------------------------
  // drag & drop / picker wiring
  // ---------------------------------------------------------
  el.dropzone.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });
  ['dragenter', 'dragover'].forEach((evt) =>
    el.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      el.dropzone.classList.add('drag-over');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    el.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      el.dropzone.classList.remove('drag-over');
    })
  );
  el.dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  el.resetBtn.addEventListener('click', resetToUpload);

  // ===========================================================
  // TOOL REGISTRY
  // Each tool defines: applicable kind, options UI, and a
  // buildCommand(opts) -> { args: [...], outExt } function.
  // ===========================================================
  const TOOLS = {
    trim: {
      label: 'Обрезка',
      desc: 'Вырезать участок по времени',
      kind: 'video',
      optionsHTML: () => `
        <div class="row-2">
          <div>
            <label class="field-label">Начало (сек)</label>
            <input type="number" id="opt-trim-start" min="0" step="0.1" value="0">
          </div>
          <div>
            <label class="field-label">Конец (сек, пусто = до конца)</label>
            <input type="number" id="opt-trim-end" min="0" step="0.1" placeholder="">
          </div>
        </div>
        <div class="hint">Копирует потоки без перекодирования — быстро, но точность реза ограничена ключевыми кадрами. Для точного реза включи «Перекодировать точно».</div>
        <label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:13px;">
          <input type="checkbox" id="opt-trim-exact" style="width:auto;"> Перекодировать точно (медленнее)
        </label>
      `,
      buildArgs: (inputName, outputName) => {
        const start = document.getElementById('opt-trim-start').value || '0';
        const endRaw = document.getElementById('opt-trim-end').value;
        const exact = document.getElementById('opt-trim-exact').checked;
        const args = ['-i', inputName, '-ss', start];
        if (endRaw) {
          const dur = (parseFloat(endRaw) - parseFloat(start)).toFixed(2);
          args.push('-t', dur);
        }
        if (exact) {
          args.push('-c:v', 'libx264', '-c:a', 'aac');
        } else {
          args.push('-c', 'copy');
        }
        args.push(outputName);
        return args;
      },
    },

    volume: {
      label: 'Громкость',
      desc: 'Изменить уровень звука',
      kind: 'video',
      optionsHTML: () => `
        <label class="field-label">Уровень (1.0 = без изменений, 0 = mute)</label>
        <input type="number" id="opt-vol" min="0" max="5" step="0.1" value="1.0">
        <div class="hint">2.0 — вдвое громче, 0.5 — вдвое тише, 0 — полностью беззвучно.</div>
      `,
      buildArgs: (inputName, outputName) => {
        const vol = document.getElementById('opt-vol').value || '1.0';
        return ['-i', inputName, '-af', `volume=${vol}`, '-c:v', 'copy', outputName];
      },
    },

    removeAudio: {
      label: 'Удалить звук',
      desc: 'Полностью убрать аудиодорожку',
      kind: 'video',
      optionsHTML: () => `<div class="hint">Видео останется, звуковая дорожка будет удалена целиком.</div>`,
      buildArgs: (inputName, outputName) => ['-i', inputName, '-an', '-c:v', 'copy', outputName],
    },

    filter: {
      label: 'Фильтр',
      desc: 'Ч/б, яркость, блюр и др.',
      kind: 'video',
      optionsHTML: () => `
        <label class="field-label">Фильтр</label>
        <select id="opt-filter-type">
          <option value="grayscale">Чёрно-белый</option>
          <option value="sepia">Сепия</option>
          <option value="brightness">Яркость/контраст</option>
          <option value="blur">Блюр</option>
          <option value="sharpen">Резкость</option>
          <option value="mirror">Зеркало (по горизонтали)</option>
        </select>
        <div id="opt-filter-extra" style="margin-top:12px;"></div>
      `,
      onOptionsRendered: () => {
        const sel = document.getElementById('opt-filter-type');
        const extra = document.getElementById('opt-filter-extra');
        function renderExtra() {
          if (sel.value === 'brightness') {
            extra.innerHTML = `
              <div class="row-2">
                <div><label class="field-label">Яркость (-1..1)</label><input type="number" id="opt-bright" min="-1" max="1" step="0.05" value="0.1"></div>
                <div><label class="field-label">Контраст (0..2)</label><input type="number" id="opt-contrast" min="0" max="2" step="0.05" value="1.1"></div>
              </div>`;
          } else if (sel.value === 'blur') {
            extra.innerHTML = `<label class="field-label">Сила блюра</label><input type="number" id="opt-blur-strength" min="1" max="20" step="1" value="5">`;
          } else {
            extra.innerHTML = '';
          }
        }
        sel.addEventListener('change', renderExtra);
        renderExtra();
      },
      buildArgs: (inputName, outputName) => {
        const type = document.getElementById('opt-filter-type').value;
        let vf;
        switch (type) {
          case 'grayscale':
            vf = 'hue=s=0';
            break;
          case 'sepia':
            vf = 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131';
            break;
          case 'brightness': {
            const b = document.getElementById('opt-bright').value || '0.1';
            const c = document.getElementById('opt-contrast').value || '1.1';
            vf = `eq=brightness=${b}:contrast=${c}`;
            break;
          }
          case 'blur': {
            const s = document.getElementById('opt-blur-strength').value || '5';
            vf = `boxblur=${s}:1`;
            break;
          }
          case 'sharpen':
            vf = 'unsharp=5:5:1.0:5:5:0.0';
            break;
          case 'mirror':
            vf = 'hflip';
            break;
          default:
            vf = 'null';
        }
        return ['-i', inputName, '-vf', vf, '-c:a', 'copy', outputName];
      },
    },

    compress: {
      label: 'Сжатие',
      desc: 'Уменьшить размер файла',
      kind: 'video',
      optionsHTML: () => `
        <label class="field-label">Качество (CRF, меньше = лучше и тяжелее)</label>
        <input type="number" id="opt-crf" min="18" max="35" step="1" value="28">
        <div class="hint">28 — заметная экономия при приемлемом качестве. 18-23 — почти без потерь. 32+ — сильное сжатие.</div>
        <label class="field-label" style="margin-top:12px;">Пресет скорости</label>
        <select id="opt-preset">
          <option value="veryfast">Быстро (крупнее файл)</option>
          <option value="medium" selected>Средне</option>
          <option value="slow">Медленно (меньше файл)</option>
        </select>
      `,
      buildArgs: (inputName, outputName) => {
        const crf = document.getElementById('opt-crf').value || '28';
        const preset = document.getElementById('opt-preset').value || 'medium';
        return ['-i', inputName, '-c:v', 'libx264', '-crf', crf, '-preset', preset, '-c:a', 'aac', '-b:a', '128k', outputName];
      },
    },

    convert: {
      label: 'Конвертация',
      desc: 'Сменить формат видео',
      kind: 'video',
      optionsHTML: () => `
        <label class="field-label">Формат</label>
        <select id="opt-convert-fmt">
          <option value="mp4">MP4</option>
          <option value="webm">WebM</option>
          <option value="gif">GIF</option>
          <option value="mkv">MKV</option>
        </select>
      `,
      buildArgs: (inputName, outputName, ctx) => {
        const fmt = document.getElementById('opt-convert-fmt').value;
        ctx.outExt = fmt;
        const out = outputName.replace(/\.\w+$/, '.' + fmt);
        ctx.actualOutputName = out;
        if (fmt === 'gif') {
          return ['-i', inputName, '-vf', 'fps=12,scale=480:-1:flags=lanczos', out];
        }
        if (fmt === 'webm') {
          // libvpx-vp9 в этой сборке ffmpeg-core стабильно валится с
          // "memory access out of bounds" — даже на 640x360 и с -threads 1.
          // VP8 + Vorbis кодируется нормально, поэтому webm делаем через него.
          return ['-i', inputName, '-c:v', 'libvpx', '-crf', '30', '-b:v', '1M', '-c:a', 'libvorbis', out];
        }
        return ['-i', inputName, '-c:v', 'libx264', '-c:a', 'aac', out];
      },
    },

    // ---- image tools ----
    imgResize: {
      label: 'Ресайз',
      desc: 'Изменить размер картинки',
      kind: 'image',
      optionsHTML: () => `
        <div class="row-2">
          <div><label class="field-label">Ширина (px)</label><input type="number" id="opt-img-w" min="1" placeholder="авто"></div>
          <div><label class="field-label">Высота (px)</label><input type="number" id="opt-img-h" min="1" placeholder="авто"></div>
        </div>
        <div class="hint">Оставь одно поле пустым, чтобы сохранить пропорции.</div>
      `,
      buildArgs: (inputName, outputName) => {
        const w = document.getElementById('opt-img-w').value || '-1';
        const h = document.getElementById('opt-img-h').value || '-1';
        return ['-i', inputName, '-vf', `scale=${w}:${h}`, outputName];
      },
    },

    imgCrop: {
      label: 'Кроп',
      desc: 'Обрезать область картинки',
      kind: 'image',
      optionsHTML: () => `
        <div class="row-3">
          <div><label class="field-label">Ширина</label><input type="number" id="opt-crop-w" min="1" value="500"></div>
          <div><label class="field-label">Высота</label><input type="number" id="opt-crop-h" min="1" value="500"></div>
          <div></div>
          <div><label class="field-label">Отступ X</label><input type="number" id="opt-crop-x" min="0" value="0"></div>
          <div><label class="field-label">Отступ Y</label><input type="number" id="opt-crop-y" min="0" value="0"></div>
        </div>
        <div class="hint">Координаты — от левого верхнего угла оригинала.</div>
      `,
      buildArgs: (inputName, outputName) => {
        const w = document.getElementById('opt-crop-w').value || '500';
        const h = document.getElementById('opt-crop-h').value || '500';
        const x = document.getElementById('opt-crop-x').value || '0';
        const y = document.getElementById('opt-crop-y').value || '0';
        return ['-i', inputName, '-vf', `crop=${w}:${h}:${x}:${y}`, outputName];
      },
    },

    imgConvert: {
      label: 'Конвертация',
      desc: 'Сменить формат картинки',
      kind: 'image',
      optionsHTML: () => `
        <label class="field-label">Формат</label>
        <select id="opt-img-fmt">
          <option value="png">PNG</option>
          <option value="jpg">JPG</option>
          <option value="webp">WebP</option>
        </select>
        <div id="opt-img-quality-wrap" style="margin-top:12px;"></div>
      `,
      onOptionsRendered: () => {
        const sel = document.getElementById('opt-img-fmt');
        const wrap = document.getElementById('opt-img-quality-wrap');
        function render() {
          if (sel.value === 'jpg' || sel.value === 'webp') {
            wrap.innerHTML = `<label class="field-label">Качество (2-31, меньше = лучше)</label><input type="number" id="opt-img-q" min="2" max="31" value="4">`;
          } else {
            wrap.innerHTML = '';
          }
        }
        sel.addEventListener('change', render);
        render();
      },
      buildArgs: (inputName, outputName, ctx) => {
        const fmt = document.getElementById('opt-img-fmt').value;
        ctx.outExt = fmt;
        const out = outputName.replace(/\.\w+$/, '.' + fmt);
        ctx.actualOutputName = out;
        const args = ['-i', inputName];
        const qEl = document.getElementById('opt-img-q');
        if (qEl) args.push('-q:v', qEl.value);
        args.push(out);
        return args;
      },
    },

    imgFilter: {
      label: 'Фильтр',
      desc: 'Ч/б, сепия, поворот',
      kind: 'image',
      optionsHTML: () => `
        <label class="field-label">Фильтр</label>
        <select id="opt-img-filter-type">
          <option value="grayscale">Чёрно-белый</option>
          <option value="sepia">Сепия</option>
          <option value="rotate90">Повернуть 90°</option>
          <option value="rotate180">Повернуть 180°</option>
          <option value="flip">Зеркало по горизонтали</option>
        </select>
      `,
      buildArgs: (inputName, outputName) => {
        const type = document.getElementById('opt-img-filter-type').value;
        let vf;
        switch (type) {
          case 'grayscale': vf = 'hue=s=0'; break;
          case 'sepia': vf = 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131'; break;
          case 'rotate90': vf = 'transpose=1'; break;
          case 'rotate180': vf = 'transpose=1,transpose=1'; break;
          case 'flip': vf = 'hflip'; break;
          default: vf = 'null';
        }
        return ['-i', inputName, '-vf', vf, outputName];
      },
    },
  };

  function toolsForKind(kind) {
    return Object.entries(TOOLS).filter(([, t]) => t.kind === kind);
  }

  function renderToolGrid() {
    if (!currentFile) return;
    const applicable = toolsForKind(currentFile.kind);
    el.toolGrid.innerHTML = '';
    applicable.forEach(([key, tool]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tool-btn';
      btn.dataset.tool = key;
      btn.innerHTML = `<span class="tool-name">${tool.label}</span><span class="tool-desc">${tool.desc}</span>`;
      btn.addEventListener('click', () => selectTool(key));
      el.toolGrid.appendChild(btn);
    });
    // auto-select first tool
    if (applicable.length) selectTool(applicable[0][0]);
  }

  function selectTool(key) {
    selectedTool = key;
    el.toolGrid.querySelectorAll('.tool-btn').forEach((b) => {
      b.classList.toggle('selected', b.dataset.tool === key);
    });
    const tool = TOOLS[key];
    el.toolOptions.innerHTML = tool.optionsHTML();
    if (tool.onOptionsRendered) tool.onOptionsRendered();
    el.resultCard.style.display = 'none';
  }

  // ---------------------------------------------------------
  // run selected tool
  // ---------------------------------------------------------
  async function runSelectedTool() {
    if (!currentFile || !selectedTool) return;
    const tool = TOOLS[selectedTool];
    setBusy(true);
    setProgress(0);
    try {
      setStatus('Готовлю ffmpeg...', false);
      await ensureFfmpeg();

      const inputName = 'input.' + currentFile.ext;
      let outputName = 'output.' + currentFile.ext;

      setStatus('Записываю файл в память...', false);
      await ffmpeg.writeFile(inputName, await _fetchFile(currentFile.blob));

      const ctx = {};
      const args = tool.buildArgs(inputName, outputName, ctx);
      if (ctx.actualOutputName) outputName = ctx.actualOutputName;

      setStatus('Обрабатываю...', false);
      // через общий exec — он подставляет -threads и проверяет код возврата
      await window.natrixSharedFFmpeg.exec(args);

      const data = await ffmpeg.readFile(outputName);
      if (!data || !data.length) {
        throw new Error('ffmpeg вернул пустой файл — проверь параметры инструмента.');
      }
      const mime = mimeFor(ctx.outExt || currentFile.ext, currentFile.kind);

      resultBlob = new Blob([data], { type: mime });
      showResult(outputName, mime);

      // cleanup wasm FS
      try { await ffmpeg.deleteFile(inputName); } catch (e) {}
      try { await ffmpeg.deleteFile(outputName); } catch (e) {}

      setStatus('Готово.', false);
      setProgress(0);
    } catch (err) {
      console.error(err);
      setStatus('Ошибка: ' + (err.message || err), true);
      setProgress(0);
    } finally {
      setBusy(false);
    }
  }

  // Расширение != mime: 'video/mkv' и 'image/jpg' не существуют, и <video>/<img>
  // с таким типом отказываются проигрывать результат.
  const MIME_BY_EXT = {
    mp4: 'video/mp4', mov: 'video/mp4', m4v: 'video/mp4',
    webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
    gif: 'image/gif', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    webp: 'image/webp', bmp: 'image/bmp',
  };

  function mimeFor(ext, kind) {
    return MIME_BY_EXT[String(ext).toLowerCase()]
      || (kind === 'video' ? 'video/mp4' : 'image/png');
  }

  let resultUrl = null;

  function showResult(outputName, mime) {
    // предыдущий результат больше не нужен — иначе blob'ы копятся в памяти вкладки
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    const url = URL.createObjectURL(resultBlob);
    resultUrl = url;
    el.resultPreview.innerHTML = '';
    if (mime.startsWith('video/')) {
      const v = document.createElement('video');
      v.src = url;
      v.controls = true;
      el.resultPreview.appendChild(v);
    } else {
      const img = document.createElement('img');
      img.src = url;
      img.className = 'preview';
      el.resultPreview.appendChild(img);
    }
    el.downloadBtn.href = url;
    el.downloadBtn.download = 'natrix_' + outputName;
    el.resultCard.style.display = 'block';
    el.resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  el.runBtn.addEventListener('click', runSelectedTool);

  return {
    get currentFile() { return currentFile; },
  };
})();
