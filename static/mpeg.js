const MPEG = (() => {
  let ffmpeg = null;
  let currentFile = null;
  let selectedTool = null;
  let resultBlob = null;
  let resultUrl = null;

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

  async function ensureFfmpeg() {
    ffmpeg = await window.natrixSharedFFmpeg.ensure((msg, isError) => {
      setStatus(msg, isError);
    });

    window.natrixSharedFFmpeg.setProgressListener((progress) => {
      const pct = Math.min(100, Math.max(0, Math.round(progress * 100)));
      setProgress(pct);
    });
  }

  async function _fetchFile(file) {
    return window.natrixSharedFFmpeg.fetchFile(file);
  }

  const VIDEO_EXTS = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'flv', 'ts', '3gp', 'ogv']);
  const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg', 'avif', 'ico', 'tiff']);

  function extFromName(name, defaultExt = null) {
    const m = (name || '').match(/\.([a-zA-Z0-9]+)$/);
    if (m) return m[1].toLowerCase();
    return defaultExt || 'bin';
  }

  function kindFromMimeOrExt(type, name) {
    if (type && type.startsWith('video/')) return 'video';
    if (type && type.startsWith('image/')) return 'image';
    const ext = extFromName(name, null);
    if (VIDEO_EXTS.has(ext)) return 'video';
    if (IMAGE_EXTS.has(ext)) return 'image';
    return null;
  }

  function getMediaDimensions(file, kind, url) {
    return new Promise((resolve) => {
      let resolved = false;
      let timer = null;
      let v = null;
      const cleanup = () => {
        if (v) {
          v.onloadedmetadata = null;
          v.onerror = null;
          v.ontimeupdate = null;
          try { v.src = ''; } catch (e) {}
        }
      };
      const done = (data) => {
        if (!resolved) {
          resolved = true;
          if (timer) clearTimeout(timer);
          cleanup();
          resolve(data);
        }
      };
      timer = setTimeout(() => done({ width: 0, height: 0, duration: 0 }), 4000);

      if (kind === 'image') {
        const img = new Image();
        img.onload = () => done({ width: img.naturalWidth || 0, height: img.naturalHeight || 0, duration: 0 });
        img.onerror = () => done({ width: 0, height: 0, duration: 0 });
        img.src = url;
      } else {
        v = document.createElement('video');
        v.preload = 'metadata';
        v.muted = true;
        v.playsInline = true;
        v.onloadedmetadata = () => {
          if (v.duration === Infinity) {
            const seekTimer = setTimeout(() => {
              clearTimeout(seekTimer);
              const dur = (isFinite(v.duration) && v.duration > 0) ? v.duration : ((isFinite(v.currentTime) && v.currentTime > 0) ? v.currentTime : 0);
              done({ width: v.videoWidth || 0, height: v.videoHeight || 0, duration: dur });
            }, 2000);
            v.currentTime = 1e101;
            v.ontimeupdate = () => {
              clearTimeout(seekTimer);
              const dur = (isFinite(v.duration) && v.duration > 0) ? v.duration : ((isFinite(v.currentTime) && v.currentTime > 0) ? v.currentTime : 0);
              done({ width: v.videoWidth || 0, height: v.videoHeight || 0, duration: dur });
            };
            return;
          }
          done({
            width: v.videoWidth || 0,
            height: v.videoHeight || 0,
            duration: isFinite(v.duration) && v.duration > 0 ? v.duration : 0,
          });
        };
        v.onerror = () => done({ width: 0, height: 0, duration: 0 });
        v.src = url;
      }
    });
  }

  async function handleFile(file) {
    const kind = kindFromMimeOrExt(file.type, file.name);
    if (!kind) {
      setLoadStatus('Формат не распознан. Нужно видео или картинка.', true);
      return;
    }

    if (currentFile && currentFile.url) URL.revokeObjectURL(currentFile.url);
    if (resultUrl) { URL.revokeObjectURL(resultUrl); resultUrl = null; }

    const fileUrl = URL.createObjectURL(file);
    const meta = await getMediaDimensions(file, kind, fileUrl);

    let ext = extFromName(file.name, null);
    if (!ext || ext === 'bin') {
      ext = kind === 'video' ? 'mp4' : 'png';
    }

    currentFile = {
      name: file.name,
      ext,
      kind,
      blob: file,
      url: fileUrl,
      width: meta.width,
      height: meta.height,
      duration: meta.duration,
    };

    resultBlob = null;
    el.resultCard.style.display = 'none';
    selectedTool = null;

    renderPreview();
    renderToolGrid();
    el.uploadCard.style.display = 'none';
    el.workspace.style.display = 'block';

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
    const parts = [currentFile.name, `${sizeMB} МБ`];
    if (currentFile.width && currentFile.height) {
      parts.push(`${currentFile.width}x${currentFile.height}`);
    }
    if (currentFile.duration > 0) {
      const min = Math.floor(currentFile.duration / 60);
      const sec = Math.round(currentFile.duration % 60);
      parts.push(`${min}:${sec < 10 ? '0' : ''}${sec}`);
    }
    parts.push(currentFile.kind);
    el.fileInfo.textContent = parts.join(' · ');
  }

  function resetToUpload() {
    if (currentFile && currentFile.url) URL.revokeObjectURL(currentFile.url);
    if (resultUrl) { URL.revokeObjectURL(resultUrl); resultUrl = null; }
    currentFile = null;
    resultBlob = null;
    el.fileInput.value = '';
    el.previewWrap.innerHTML = '';
    el.resultPreview.innerHTML = '';
    el.uploadCard.style.display = 'block';
    el.workspace.style.display = 'none';
    el.resultCard.style.display = 'none';
    setLoadStatus('', false);
  }

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

  const TOOLS = {
    trim: {
      label: 'Обрезка',
      desc: 'Вырезать участок по времени',
      kind: 'video',
      optionsHTML: () => {
        const maxEnd = currentFile && currentFile.duration ? currentFile.duration.toFixed(1) : '';
        return `
        <div class="row-2">
          <div>
            <label class="field-label">Начало (сек)</label>
            <input type="number" id="opt-trim-start" min="0" step="0.1" value="0">
          </div>
          <div>
            <label class="field-label">Конец (сек, пусто = до конца)</label>
            <input type="number" id="opt-trim-end" min="0" step="0.1" placeholder="${maxEnd ? 'макс. ' + maxEnd : ''}">
          </div>
        </div>
        <div class="hint">Копирует потоки без перекодирования — быстро, но точность реза ограничена ключевыми кадрами. Для точного реза включи «Перекодировать точно».</div>
        <label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:13px;">
          <input type="checkbox" id="opt-trim-exact" style="width:auto;"> Перекодировать точно (медленнее)
        </label>
      `;
      },
      buildArgs: (inputName, outputName, ctx) => {
        const start = parseFloat(document.getElementById('opt-trim-start').value) || 0;
        const endRaw = document.getElementById('opt-trim-end').value;
        const exact = document.getElementById('opt-trim-exact').checked;
        if (start < 0) {
          throw new Error('Время начала не может быть отрицательным.');
        }
        if (endRaw !== '' && parseFloat(endRaw) <= start) {
          throw new Error('Время окончания должно быть строго больше времени начала.');
        }
        const args = ['-ss', String(start), '-i', inputName];
        if (endRaw !== '') {
          const dur = (parseFloat(endRaw) - start).toFixed(2);
          args.push('-t', dur);
        }
        if (exact) {
          ctx.outExt = 'mp4';
          const out = outputName.replace(/\.\w+$/, '.mp4');
          ctx.actualOutputName = out;
          args.push(
            '-map', '0:v:0',
            '-map', '0:a?',
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-b:a', '128k',
            out
          );
        } else {
          args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero', outputName);
        }
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
        let vol = parseFloat(document.getElementById('opt-vol').value);
        if (isNaN(vol) || vol < 0) vol = 1.0;
        vol = Math.min(5, Math.max(0, vol));

        if (vol === 0) {
          return [
            '-i', inputName,
            '-map', '0:v:0',
            '-an',
            '-c:v', 'copy',
            outputName
          ];
        }

        const isWebm = currentFile && currentFile.ext === 'webm';
        const aCodec = isWebm ? ['-c:a', 'libvorbis'] : ['-c:a', 'aac', '-b:a', '128k'];

        return [
          '-i', inputName,
          '-map', '0:v:0',
          '-map', '0:a?',
          '-c:v', 'copy',
          '-af', `volume=${vol}`,
          ...aCodec,
          outputName
        ];
      },
    },

    removeAudio: {
      label: 'Удалить звук',
      desc: 'Полностью убрать аудиодорожку',
      kind: 'video',
      optionsHTML: () => `<div class="hint">Видео останется, звуковая дорожка будет удалена целиком.</div>`,
      buildArgs: (inputName, outputName) => [
        '-i', inputName,
        '-map', '0:v:0',
        '-an',
        '-c:v', 'copy',
        outputName
      ],
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
      buildArgs: (inputName, outputName, ctx) => {
        ctx.outExt = 'mp4';
        const out = outputName.replace(/\.\w+$/, '.mp4');
        ctx.actualOutputName = out;
        const type = document.getElementById('opt-filter-type').value;
        let vf;
        switch (type) {
          case 'grayscale': vf = 'hue=s=0'; break;
          case 'sepia': vf = 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131'; break;
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
          case 'sharpen': vf = 'unsharp=5:5:1.0:5:5:0.0'; break;
          case 'mirror': vf = 'hflip'; break;
          default: vf = 'null';
        }
        vf += ',scale=trunc(iw/2)*2:trunc(ih/2)*2';
        return [
          '-i', inputName,
          '-map', '0:v:0',
          '-map', '0:a?',
          '-vf', vf,
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '128k',
          out
        ];
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
      buildArgs: (inputName, outputName, ctx) => {
        ctx.outExt = 'mp4';
        const out = outputName.replace(/\.\w+$/, '.mp4');
        ctx.actualOutputName = out;
        let crf = parseInt(document.getElementById('opt-crf').value);
        if (isNaN(crf)) crf = 28;
        crf = Math.min(51, Math.max(0, crf));
        const preset = document.getElementById('opt-preset').value || 'medium';
        return [
          '-i', inputName,
          '-map', '0:v:0',
          '-map', '0:a?',
          '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-crf', String(crf),
          '-preset', preset,
          '-c:a', 'aac',
          '-b:a', '128k',
          out
        ];
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
          return ['-i', inputName, '-map', '0:v:0', '-vf', 'fps=12,scale=480:-2:flags=lanczos', out];
        }
        if (fmt === 'webm') {
          return [
            '-i', inputName,
            '-map', '0:v:0',
            '-map', '0:a?',
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
            '-c:v', 'libvpx',
            '-pix_fmt', 'yuv420p',
            '-crf', '30',
            '-b:v', '1M',
            '-c:a', 'libvorbis',
            out
          ];
        }
        return [
          '-i', inputName,
          '-map', '0:v:0',
          '-map', '0:a?',
          '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '128k',
          out
        ];
      },
    },

    imgResize: {
      label: 'Ресайз',
      desc: 'Изменить размер картинки',
      kind: 'image',
      optionsHTML: () => `
        <div class="row-2">
          <div><label class="field-label">Ширина (px)</label><input type="number" id="opt-img-w" min="1" placeholder="${currentFile && currentFile.width ? currentFile.width : 'авто'}"></div>
          <div><label class="field-label">Высота (px)</label><input type="number" id="opt-img-h" min="1" placeholder="${currentFile && currentFile.height ? currentFile.height : 'авто'}"></div>
        </div>
        <div class="hint">Оставь одно поле пустым, чтобы сохранить пропорции. Оставь оба пустыми для сохранения исходного размера.</div>
      `,
      buildArgs: (inputName, outputName) => {
        const wVal = document.getElementById('opt-img-w').value.trim();
        const hVal = document.getElementById('opt-img-h').value.trim();
        let vf = 'null';
        const w = (wVal && parseInt(wVal) > 0) ? parseInt(wVal) : -1;
        const h = (hVal && parseInt(hVal) > 0) ? parseInt(hVal) : -1;
        if (w > 0 || h > 0) {
          vf = `scale=${w}:${h}`;
        }
        return ['-i', inputName, '-vf', vf, outputName];
      },
    },

    imgCrop: {
      label: 'Кроп',
      desc: 'Обрезать область картинки',
      kind: 'image',
      optionsHTML: () => {
        const imgW = currentFile && currentFile.width ? currentFile.width : 500;
        const imgH = currentFile && currentFile.height ? currentFile.height : 500;
        const defW = Math.min(imgW, 500);
        const defH = Math.min(imgH, 500);
        return `
        <div class="row-3">
          <div><label class="field-label">Ширина</label><input type="number" id="opt-crop-w" min="1" max="${imgW}" value="${defW}"></div>
          <div><label class="field-label">Высота</label><input type="number" id="opt-crop-h" min="1" max="${imgH}" value="${defH}"></div>
          <div></div>
          <div><label class="field-label">Отступ X</label><input type="number" id="opt-crop-x" min="0" max="${Math.max(0, imgW - defW)}" value="0"></div>
          <div><label class="field-label">Отступ Y</label><input type="number" id="opt-crop-y" min="0" max="${Math.max(0, imgH - defH)}" value="0"></div>
        </div>
        <div class="hint">Размер оригинала: ${imgW}x${imgH} px. Координаты — от левого верхнего угла.</div>
      `;
      },
      buildArgs: (inputName, outputName) => {
        const imgW = currentFile && currentFile.width ? currentFile.width : 10000;
        const imgH = currentFile && currentFile.height ? currentFile.height : 10000;
        let w = parseInt(document.getElementById('opt-crop-w').value) || Math.min(imgW, 500);
        let h = parseInt(document.getElementById('opt-crop-h').value) || Math.min(imgH, 500);
        let x = parseInt(document.getElementById('opt-crop-x').value) || 0;
        let y = parseInt(document.getElementById('opt-crop-y').value) || 0;

        w = Math.max(1, Math.min(w, imgW));
        h = Math.max(1, Math.min(h, imgH));
        x = Math.max(0, Math.min(x, imgW - w));
        y = Math.max(0, Math.min(y, imgH - h));

        const vf = `crop=w='min(iw,${w})':h='min(ih,${h})':x='min(max(0,${x}),iw-out_w)':y='min(max(0,${y}),ih-out_h)'`;
        return ['-i', inputName, '-vf', vf, outputName];
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
        if (fmt === 'jpg' || fmt === 'jpeg') {
          args.push('-pix_fmt', 'yuvj420p');
        }
        const qEl = document.getElementById('opt-img-q');
        if (qEl && (fmt === 'jpg' || fmt === 'jpeg' || fmt === 'webp')) {
          let q = parseInt(qEl.value);
          if (isNaN(q)) q = 4;
          q = Math.min(31, Math.max(1, q));
          args.push('-q:v', String(q));
        }
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

  async function runSelectedTool() {
    if (!currentFile || !selectedTool) return;
    const tool = TOOLS[selectedTool];
    setBusy(true);
    setProgress(0);

    let inputName = '';
    let outputName = '';
    try {
      inputName = 'input.' + currentFile.ext;
      outputName = 'output.' + currentFile.ext;

      // Validate options and build arguments before allocating memory
      const ctx = {};
      const args = tool.buildArgs(inputName, outputName, ctx);
      if (ctx.actualOutputName) outputName = ctx.actualOutputName;

      setStatus('Готовлю ffmpeg...', false);
      await ensureFfmpeg();

      setStatus('Записываю файл в память...', false);
      await ffmpeg.writeFile(inputName, await _fetchFile(currentFile.blob));

      setStatus('Обрабатываю...', false);
      await window.natrixSharedFFmpeg.exec(args);

      const data = await ffmpeg.readFile(outputName);
      if (!data || !data.length) {
        throw new Error('ffmpeg вернул пустой файл — проверь параметры инструмента.');
      }
      const mime = mimeFor(ctx.outExt || currentFile.ext, currentFile.kind);

      resultBlob = new Blob([data], { type: mime });
      showResult(outputName, mime);

      setStatus('Готово.', false);
      setProgress(0);
    } catch (err) {
      console.error(err);
      setStatus('Ошибка: ' + (err.message || err), true);
      setProgress(0);
    } finally {
      if (inputName) await window.natrixSharedFFmpeg.deleteFile(inputName);
      if (outputName) await window.natrixSharedFFmpeg.deleteFile(outputName);
      setBusy(false);
    }
  }

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

  function showResult(outputName, mime) {
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
    const stem = (currentFile.name || 'file').replace(/\.[a-zA-Z0-9]+$/, '') || 'media';
    const targetExt = outputName.split('.').pop() || (mime.startsWith('video/') ? 'mp4' : 'png');
    el.downloadBtn.href = url;
    el.downloadBtn.download = 'natrix_' + stem + '.' + targetExt;
    el.resultCard.style.display = 'block';
    el.resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  el.runBtn.addEventListener('click', runSelectedTool);

  return {
    get currentFile() { return currentFile; },
  };
})();
