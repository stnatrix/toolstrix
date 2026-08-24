// ============================================================
// natrix compress — client-side video compression via ffmpeg.wasm
// Compresses videos to target size (MB) with bitrate estimation.
// ============================================================

const COMPRESS = (() => {
  let ffmpeg = null;
  let currentFile = null; // { name, ext, blob, url, duration, width, height, size }
  let targetSizeMB = 25; // default target size
  let resultBlob = null;

  const el = {
    dropzone: document.getElementById('compress-dropzone'),
    dropzoneText: document.getElementById('compress-dropzone-text'),
    fileInput: document.getElementById('compress-file-input'),
    loadStatus: document.getElementById('compress-load-status'),
    uploadCard: document.getElementById('compress-upload-card'),
    workspace: document.getElementById('compress-workspace'),
    previewWrap: document.getElementById('compress-preview-wrap'),
    fileInfo: document.getElementById('compress-file-info'),
    sizeGrid: document.getElementById('compress-size-grid'),
    customSizeWrap: document.getElementById('compress-custom-size-wrap'),
    customSizeInput: document.getElementById('compress-custom-size'),
    optScale: document.getElementById('compress-opt-scale'),
    optAudio: document.getElementById('compress-opt-audio'),
    optPreset: document.getElementById('compress-opt-preset'),
    bitrateInfo: document.getElementById('compress-bitrate-info'),
    progressWrap: document.getElementById('compress-progress-wrap'),
    progressBar: document.getElementById('compress-progress-bar'),
    status: document.getElementById('compress-status'),
    runBtn: document.getElementById('compress-run-btn'),
    resetBtn: document.getElementById('compress-reset-btn'),
    resultCard: document.getElementById('compress-result-card'),
    resultPreview: document.getElementById('compress-result-preview'),
    resultInfo: document.getElementById('compress-result-info'),
    downloadBtn: document.getElementById('compress-download-btn'),
  };

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

  // Wire presets
  el.sizeGrid.querySelectorAll('button[data-size]').forEach((btn) => {
    btn.addEventListener('click', () => {
      el.sizeGrid.querySelectorAll('button[data-size]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      
      const sizeVal = btn.dataset.size;
      if (sizeVal === 'custom') {
        el.customSizeWrap.style.display = 'block';
        targetSizeMB = parseFloat(el.customSizeInput.value) || 25;
      } else {
        el.customSizeWrap.style.display = 'none';
        targetSizeMB = parseFloat(sizeVal);
      }
      updateBitrateEstimation();
    });
  });

  el.customSizeInput.addEventListener('input', () => {
    targetSizeMB = parseFloat(el.customSizeInput.value) || 1;
    updateBitrateEstimation();
  });

  el.optScale.addEventListener('change', updateBitrateEstimation);
  el.optAudio.addEventListener('change', updateBitrateEstimation);

  // ---------------------------------------------------------
  // file handling & metadata extraction
  // ---------------------------------------------------------
  async function handleFile(file) {
    if (!file.type.startsWith('video/')) {
      setLoadStatus('Пожалуйста, выберите видеофайл.', true);
      return;
    }

    setLoadStatus('Чтение метаданных видео...', false);
    
    try {
      const meta = await getVideoMetadata(file);
      currentFile = {
        name: file.name,
        ext: extFromName(file.name),
        blob: file,
        url: URL.createObjectURL(file),
        duration: meta.duration,
        width: meta.width,
        height: meta.height,
        size: file.size
      };

      resultBlob = null;
      el.resultCard.style.display = 'none';

      renderPreview();
      updateBitrateEstimation();

      el.uploadCard.style.display = 'none';
      el.workspace.style.display = 'block';
      setLoadStatus('', false);

      // Pre-warm ffmpeg
      window.natrixSharedFFmpeg.ensure().catch((err) => console.error('[compress] pre-warm failed:', err));

    } catch (err) {
      console.error(err);
      setLoadStatus('Не удалось прочитать видео: ' + err.message, true);
    }
  }

  function getVideoMetadata(file) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      
      const fileURL = URL.createObjectURL(file);
      video.src = fileURL;

      video.onloadedmetadata = () => {
        URL.revokeObjectURL(fileURL);
        resolve({
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight
        });
      };

      video.onerror = () => {
        URL.revokeObjectURL(fileURL);
        reject(new Error('Невозможно декодировать заголовки видео. Возможно, файл поврежден или кодек не поддерживается вашим браузером.'));
      };
    });
  }

  function extFromName(name) {
    const m = name.match(/\.([a-zA-Z0-9]+)$/);
    return m ? m[1].toLowerCase() : 'mp4';
  }

  function renderPreview() {
    el.previewWrap.innerHTML = '';
    const v = document.createElement('video');
    v.src = currentFile.url;
    v.controls = true;
    el.previewWrap.appendChild(v);

    const sizeMB = (currentFile.size / (1024 * 1024)).toFixed(2);
    const durMin = Math.floor(currentFile.duration / 60);
    const durSec = Math.round(currentFile.duration % 60);
    const durStr = `${durMin}:${durSec < 10 ? '0' : ''}${durSec}`;
    
    el.fileInfo.textContent = `${currentFile.name} · ${sizeMB} МБ · ${currentFile.width}x${currentFile.height} · ${durStr}`;
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
  // bitrate & scaling calculations
  // ---------------------------------------------------------
  function updateBitrateEstimation() {
    if (!currentFile) return;

    const duration = currentFile.duration;
    if (!duration || duration <= 0) return;

    // Use 93% of the target size as safety margin for muxing/container overhead
    const safetyMargin = 0.93;
    const targetSizeBits = targetSizeMB * 8 * 1024 * 1024 * safetyMargin;

    // Estimate audio bitrate
    let audioBitrateBps = 128 * 1000; // default for keep (fallback assumption)
    const audioMode = el.optAudio.value;
    if (audioMode === 'mono64') {
      audioBitrateBps = 64 * 1000;
    } else if (audioMode === 'mute') {
      audioBitrateBps = 0;
    }

    const totalTargetBitrateBps = targetSizeBits / duration;
    const videoBitrateBps = totalTargetBitrateBps - audioBitrateBps;
    const videoBitrateKbps = Math.round(videoBitrateBps / 1000);

    const originalSizeMB = currentFile.size / (1024 * 1024);

    if (targetSizeMB >= originalSizeMB) {
      el.bitrateInfo.innerHTML = `<span style="color: var(--ok)">Целевой размер (${targetSizeMB} МБ) больше или равен оригинальному (${originalSizeMB.toFixed(1)} МБ). Видео просто скопируется или слегка оптимизируется.</span>`;
      el.runBtn.disabled = false;
      return;
    }

    if (videoBitrateBps <= 50 * 1000) {
      // critical size warning
      el.bitrateInfo.innerHTML = `<span style="color: var(--danger); font-weight: bold;">Ошибка: Целевой размер слишком мал для видео такой длительности (${Math.round(duration)} сек). Битрейт видео получается отрицательным или слишком низким (${videoBitrateKbps} kbps). Пожалуйста, увеличьте целевой размер.</span>`;
      el.runBtn.disabled = true;
      return;
    }

    el.runBtn.disabled = false;

    // Determine auto resolution
    let autoScaleText = '';
    let calculatedHeight = currentFile.height;
    let calculatedWidth = currentFile.width;

    if (el.optScale.value === 'auto') {
      if (videoBitrateKbps < 300) {
        calculatedHeight = Math.min(360, currentFile.height);
      } else if (videoBitrateKbps < 600) {
        calculatedHeight = Math.min(480, currentFile.height);
      } else if (videoBitrateKbps < 1200) {
        calculatedHeight = Math.min(720, currentFile.height);
      } else {
        calculatedHeight = currentFile.height;
      }
      
      // Keep aspect ratio
      const ratio = currentFile.width / currentFile.height;
      calculatedWidth = Math.round((calculatedHeight * ratio) / 2) * 2;
      autoScaleText = `(Рекомендуемое разрешение: <b>${calculatedWidth}x${calculatedHeight}</b>)`;
    } else {
      calculatedHeight = parseInt(el.optScale.value);
      const ratio = currentFile.width / currentFile.height;
      calculatedWidth = Math.round((calculatedHeight * ratio) / 2) * 2;
    }

    let warningStyle = '';
    let qualityText = 'хорошее';
    if (videoBitrateKbps < 300) {
      warningStyle = 'color: var(--danger);';
      qualityText = 'очень низкое (будут сильные артефакты)';
    } else if (videoBitrateKbps < 700) {
      warningStyle = 'color: var(--compress);';
      qualityText = 'среднее';
    } else {
      warningStyle = 'color: var(--ok);';
    }

    el.bitrateInfo.innerHTML = `
      Расчетный битрейт видео: <b style="${warningStyle}">${videoBitrateKbps} kbps</b>.<br>
      Ожидаемое качество: <b>${qualityText}</b>.<br>
      ${autoScaleText}
    `;
  }

  // ---------------------------------------------------------
  // run compression
  // ---------------------------------------------------------
  async function runCompression() {
    if (!currentFile) return;

    setBusy(true);
    setProgress(0);

    try {
      setStatus('Подключение ffmpeg...', false);
      ffmpeg = await window.natrixSharedFFmpeg.ensure((msg, isError) => {
        setStatus(msg, isError);
      });

      // Set progress listener
      window.natrixSharedFFmpeg.setProgressListener((progress) => {
        const pct = Math.min(100, Math.max(0, Math.round(progress * 100)));
        setProgress(pct);
      });

      const inputName = 'input.' + currentFile.ext;
      const outputName = 'output.mp4';

      setStatus('Загрузка видеофайла в память...', false);
      await ffmpeg.writeFile(inputName, await window.natrixSharedFFmpeg.fetchFile(currentFile.blob));

      setStatus('Подготовка аргументов сжатия...', false);
      const args = buildFfmpegArgs(inputName, outputName);
      console.log('[compress] running ffmpeg with args:', args.join(' '));

      setStatus('Сжатие видео (это может занять время)...', false);
      // через общий exec — он подставляет -threads (без него x264 в wasm виснет)
      // и сам бросает исключение на ненулевом коде возврата
      await window.natrixSharedFFmpeg.exec(args);

      setStatus('Чтение готового файла...', false);
      const data = await ffmpeg.readFile(outputName);
      if (!data || data.length === 0) {
        throw new Error('Получен пустой файл на выходе. Возможно, неверные параметры или кодек.');
      }

      resultBlob = new Blob([data], { type: 'video/mp4' });
      showResult(outputName);

      // cleanup WASM files
      try { await ffmpeg.deleteFile(inputName); } catch (e) {}
      try { await ffmpeg.deleteFile(outputName); } catch (e) {}

      setStatus('Видео успешно сжато!', false);
      setProgress(0);

    } catch (err) {
      console.error(err);
      setStatus('Ошибка при сжатии: ' + (err.message || err), true);
      setProgress(0);

      // Auto-trigger confirmation for server fallback
      setTimeout(() => {
        if (confirm("Локальное сжатие в браузере не удалось (вероятно, кодек AV1 или HEVC не поддерживается вашим браузером/WASM).\n\nХотите загрузить видео на сервер для сжатия? (Сжатие выполнится на сервере с помощью native ffmpeg).")) {
          runServerCompression();
        }
      }, 100);
    } finally {
      setBusy(false);
    }
  }

  async function runServerCompression() {
    setBusy(true);
    setProgress(0);
    setStatus('Загрузка видео на сервер для сжатия...', false);

    // Calculate parameters (exactly matching the client calculation)
    const duration = currentFile.duration;
    const safetyMargin = 0.93;
    const targetSizeBits = targetSizeMB * 8 * 1024 * 1024 * safetyMargin;

    let audioBitrateKbps = 128;
    const audioMode = el.optAudio.value;
    if (audioMode === 'mono64') {
      audioBitrateKbps = 64;
    } else if (audioMode === 'mute') {
      audioBitrateKbps = 0;
    }

    const totalTargetBitrateKbps = Math.round(targetSizeBits / duration / 1000);
    let videoBitrateKbps = totalTargetBitrateKbps - audioBitrateKbps;
    if (videoBitrateKbps < 50) videoBitrateKbps = 50;

    let scaleHeight = 0;
    if (el.optScale.value === 'auto') {
      if (videoBitrateKbps < 300) {
        scaleHeight = 360;
      } else if (videoBitrateKbps < 600) {
        scaleHeight = 480;
      } else if (videoBitrateKbps < 1200) {
        scaleHeight = 720;
      }
    } else {
      scaleHeight = parseInt(el.optScale.value);
    }
    // Only scale down, never upscale
    if (scaleHeight && currentFile.height <= scaleHeight) {
      scaleHeight = 0;
    }

    const formData = new FormData();
    formData.append('file', currentFile.blob, currentFile.name);
    formData.append('video_bitrate_kbps', videoBitrateKbps);
    formData.append('target_height', scaleHeight);
    formData.append('audio_mode', audioMode);
    formData.append('preset', el.optPreset.value);

    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/compress', true);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setProgress(pct);
          setStatus(`Загрузка на сервер: ${pct}%...`, false);
        }
      };

      xhr.onload = async () => {
        if (xhr.status === 200) {
          setStatus('Получение сжатого файла...', false);
          setProgress(0);
          resultBlob = xhr.response;
          showResult('output.mp4');
          setStatus('Видео успешно сжато на сервере!', false);
        } else {
          let errText = 'Неизвестная ошибка сервера.';
          try {
            const reader = new FileReader();
            reader.onload = () => {
              try {
                const parsed = JSON.parse(reader.result);
                errText = parsed.detail || errText;
              } catch (e) {
                errText = reader.result || errText;
              }
              setStatus('Ошибка сервера: ' + errText, true);
            };
            reader.readAsText(xhr.response);
          } catch (e) {
            setStatus('Ошибка сервера: ' + xhr.statusText, true);
          }
        }
        setBusy(false);
      };

      xhr.onerror = () => {
        setStatus('Ошибка сети при загрузке на сервер.', true);
        setBusy(false);
      };

      xhr.responseType = 'blob';
      xhr.send(formData);

    } catch (err) {
      console.error(err);
      setStatus('Ошибка при отправке: ' + err.message, true);
      setBusy(false);
    }
  }

  function buildFfmpegArgs(inputName, outputName) {
    const duration = currentFile.duration;
    const safetyMargin = 0.93;
    const targetSizeBits = targetSizeMB * 8 * 1024 * 1024 * safetyMargin;

    let audioBitrateKbps = 128;
    const audioMode = el.optAudio.value;
    if (audioMode === 'mono64') {
      audioBitrateKbps = 64;
    } else if (audioMode === 'mute') {
      audioBitrateKbps = 0;
    }

    const totalTargetBitrateKbps = Math.round(targetSizeBits / duration / 1000);
    let videoBitrateKbps = totalTargetBitrateKbps - audioBitrateKbps;
    if (videoBitrateKbps < 50) videoBitrateKbps = 50; // clamp to minimum video quality

    const args = ['-i', inputName];

    // Explicit stream mapping with optional audio to prevent crashes if video is muted
    args.push('-map', '0:v');
    if (audioMode !== 'mute') {
      args.push('-map', '0:a?');
    }

    // Scale filter
    let scaleHeight = null;
    if (el.optScale.value === 'auto') {
      // Auto downscaling based on bitrate
      if (videoBitrateKbps < 300) {
        scaleHeight = 360;
      } else if (videoBitrateKbps < 600) {
        scaleHeight = 480;
      } else if (videoBitrateKbps < 1200) {
        scaleHeight = 720;
      }
    } else {
      scaleHeight = parseInt(el.optScale.value);
    }

    // Only scale down, never upscale
    if (scaleHeight && currentFile.height > scaleHeight) {
      args.push('-vf', `scale=-2:${scaleHeight}`);
    }

    // Video codec, pixel format, and bitrate limiters
    args.push(
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-b:v', `${videoBitrateKbps}k`,
      '-maxrate', `${videoBitrateKbps}k`,
      '-bufsize', `${videoBitrateKbps * 2}k`,
      '-preset', el.optPreset.value
    );

    // Audio options
    if (audioMode === 'mute') {
      args.push('-an');
    } else if (audioMode === 'mono64') {
      args.push('-c:a', 'aac', '-b:a', '64k', '-ac', '1');
    } else {
      // transcode to 128k stereo
      args.push('-c:a', 'aac', '-b:a', '128k');
    }

    // Output settings
    args.push('-y', outputName);
    return args;
  }

  let resultUrl = null;

  function showResult(outputName) {
    // предыдущий результат больше не нужен — иначе blob'ы копятся в памяти вкладки
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    const url = URL.createObjectURL(resultBlob);
    resultUrl = url;
    el.resultPreview.innerHTML = '';
    
    const v = document.createElement('video');
    v.src = url;
    v.controls = true;
    el.resultPreview.appendChild(v);

    const sizeMB = (resultBlob.size / (1024 * 1024)).toFixed(2);
    el.resultInfo.textContent = `Размер: ${sizeMB} МБ`;

    el.downloadBtn.href = url;
    el.downloadBtn.download = 'compressed_' + currentFile.name.replace(/\.\w+$/, '.mp4');
    el.resultCard.style.display = 'block';
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
    el.optScale.disabled = busy;
    el.optAudio.disabled = busy;
    el.optPreset.disabled = busy;
    el.sizeGrid.querySelectorAll('button').forEach((btn) => btn.disabled = busy);
    el.customSizeInput.disabled = busy;
  }

  el.runBtn.addEventListener('click', runCompression);

  return {
    handleFile,
  };
})();
