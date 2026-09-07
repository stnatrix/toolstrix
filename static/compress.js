const COMPRESS = (() => {
  let ffmpeg = null;
  let currentFile = null;
  let targetSizeMB = 25;
  let resultBlob = null;
  let resultUrl = null;

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

  el.sizeGrid.querySelectorAll('button[data-size]').forEach((btn) => {
    btn.addEventListener('click', () => {
      el.sizeGrid.querySelectorAll('button[data-size]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      
      const sizeVal = btn.dataset.size;
      if (sizeVal === 'custom') {
        el.customSizeWrap.style.display = 'block';
        targetSizeMB = Math.max(0.5, parseFloat(el.customSizeInput.value) || 25);
      } else {
        el.customSizeWrap.style.display = 'none';
        targetSizeMB = parseFloat(sizeVal);
      }
      updateBitrateEstimation();
    });
  });

  el.customSizeInput.addEventListener('input', () => {
    targetSizeMB = Math.max(0.5, parseFloat(el.customSizeInput.value) || 1);
    updateBitrateEstimation();
  });

  el.optScale.addEventListener('change', updateBitrateEstimation);
  el.optAudio.addEventListener('change', updateBitrateEstimation);

  const VIDEO_EXTS = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'flv', 'ts', '3gp', 'ogv']);

  function extFromName(name) {
    const m = (name || '').match(/\.([a-zA-Z0-9]+)$/);
    return m ? m[1].toLowerCase() : 'mp4';
  }

  function isVideoFile(file) {
    if (file.type && file.type.startsWith('video/')) return true;
    const ext = extFromName(file.name);
    return VIDEO_EXTS.has(ext);
  }

  async function handleFile(file) {
    if (!isVideoFile(file)) {
      setLoadStatus('Пожалуйста, выберите видеофайл.', true);
      return;
    }

    setLoadStatus('Чтение метаданных видео...', false);
    
    try {
      if (currentFile && currentFile.url) URL.revokeObjectURL(currentFile.url);
      if (resultUrl) { URL.revokeObjectURL(resultUrl); resultUrl = null; }

      const fileUrl = URL.createObjectURL(file);
      const meta = await getVideoMetadata(file, fileUrl);

      currentFile = {
        name: file.name,
        ext: extFromName(file.name),
        blob: file,
        url: fileUrl,
        duration: meta.duration,
        width: meta.width,
        height: meta.height,
        size: file.size,
        needsServer: meta.needsServer,
      };

      resultBlob = null;
      el.resultCard.style.display = 'none';

      renderPreview();
      updateBitrateEstimation();

      el.uploadCard.style.display = 'none';
      el.workspace.style.display = 'block';
      setLoadStatus('', false);

      if (!meta.needsServer) {
        window.natrixSharedFFmpeg.ensure().catch((err) => console.error('[compress] pre-warm failed:', err));
      }

    } catch (err) {
      console.error(err);
      setLoadStatus('Не удалось прочитать видео: ' + err.message, true);
    }
  }

  function getVideoMetadata(file, fileURL) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;

      const timer = setTimeout(() => {
        resolve({
          duration: 0,
          width: 0,
          height: 0,
          needsServer: true,
        });
      }, 5000);

      video.onloadedmetadata = () => {
        clearTimeout(timer);
        if (video.duration === Infinity) {
          const seekTimer = setTimeout(() => {
            video.ontimeupdate = null;
            resolve({
              duration: isFinite(video.duration) && video.duration > 0 ? video.duration : 0,
              width: video.videoWidth || 0,
              height: video.videoHeight || 0,
              needsServer: false,
            });
          }, 2000);
          video.currentTime = 1e101;
          video.ontimeupdate = () => {
            clearTimeout(seekTimer);
            video.ontimeupdate = null;
            resolve({
              duration: isFinite(video.duration) && video.duration > 0 ? video.duration : 0,
              width: video.videoWidth || 0,
              height: video.videoHeight || 0,
              needsServer: false,
            });
          };
          return;
        }
        resolve({
          duration: isFinite(video.duration) && video.duration > 0 ? video.duration : 0,
          width: video.videoWidth || 0,
          height: video.videoHeight || 0,
          needsServer: false,
        });
      };

      video.onerror = () => {
        clearTimeout(timer);
        resolve({
          duration: 0,
          width: 0,
          height: 0,
          needsServer: true,
        });
      };

      video.src = fileURL;
    });
  }

  function renderPreview() {
    el.previewWrap.innerHTML = '';
    if (!currentFile.needsServer) {
      const v = document.createElement('video');
      v.src = currentFile.url;
      v.controls = true;
      el.previewWrap.appendChild(v);
    } else {
      const notice = document.createElement('div');
      notice.className = 'hint';
      notice.style.padding = '24px 16px';
      notice.style.textAlign = 'center';
      notice.innerHTML = 'Превью недоступно в браузере (кодек MKV/HEVC/AV1).<br>Видео будет быстро сжато через серверный ffmpeg.';
      el.previewWrap.appendChild(notice);
    }

    const sizeMB = (currentFile.size / (1024 * 1024)).toFixed(2);
    const parts = [currentFile.name, `${sizeMB} МБ`];
    if (currentFile.width && currentFile.height) {
      parts.push(`${currentFile.width}x${currentFile.height}`);
    }
    if (currentFile.duration > 0) {
      const durMin = Math.floor(currentFile.duration / 60);
      const durSec = Math.round(currentFile.duration % 60);
      parts.push(`${durMin}:${durSec < 10 ? '0' : ''}${durSec}`);
    }
    el.fileInfo.textContent = parts.join(' · ');
  }

  function resetToUpload() {
    if (currentFile && currentFile.url) URL.revokeObjectURL(currentFile.url);
    if (resultUrl) { URL.revokeObjectURL(resultUrl); resultUrl = null; }
    currentFile = null;
    resultBlob = null;
    el.fileInput.value = '';
    el.uploadCard.style.display = 'block';
    el.workspace.style.display = 'none';
    el.resultCard.style.display = 'none';
    setLoadStatus('', false);
  }

  function updateBitrateEstimation() {
    if (!currentFile) return;

    if (currentFile.needsServer || !currentFile.duration || currentFile.duration <= 0 || !isFinite(currentFile.duration)) {
      el.bitrateInfo.innerHTML = `<span style="color: var(--compress)">Кодек или длительность не определены в браузере. Видео будет обработано через серверный движок с автоподбором битрейта.</span>`;
      el.runBtn.disabled = false;
      el.runBtn.textContent = 'Сжать видео на сервере';
      return;
    }

    el.runBtn.textContent = 'Сжать видео';
    const duration = currentFile.duration;
    const safetyMargin = 0.93;
    const targetMB = Math.max(0.5, targetSizeMB);
    const targetSizeBits = targetMB * 8 * 1024 * 1024 * safetyMargin;

    let audioBitrateBps = 128 * 1000;
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

    if (targetMB >= originalSizeMB) {
      el.bitrateInfo.innerHTML = `<span style="color: var(--ok)">Целевой размер (${targetMB} МБ) больше или равен оригинальному (${originalSizeMB.toFixed(1)} МБ). Видео просто скопируется или слегка оптимизируется.</span>`;
      el.runBtn.disabled = false;
      return;
    }

    if (videoBitrateBps <= 50 * 1000) {
      el.bitrateInfo.innerHTML = `<span style="color: var(--danger); font-weight: bold;">Ошибка: Целевой размер слишком мал для видео такой длительности (${Math.round(duration)} сек). Битрейт видео получается отрицательным или слишком низким (${videoBitrateKbps} kbps). Пожалуйста, увеличьте целевой размер.</span>`;
      el.runBtn.disabled = true;
      return;
    }

    el.runBtn.disabled = false;

    let autoScaleText = '';
    let calculatedHeight = currentFile.height || 1080;
    let calculatedWidth = currentFile.width || 1920;

    if (el.optScale.value === 'auto') {
      if (videoBitrateKbps < 300) {
        calculatedHeight = Math.min(360, currentFile.height || 360);
      } else if (videoBitrateKbps < 600) {
        calculatedHeight = Math.min(480, currentFile.height || 480);
      } else if (videoBitrateKbps < 1200) {
        calculatedHeight = Math.min(720, currentFile.height || 720);
      } else {
        calculatedHeight = currentFile.height || 1080;
      }
      
      if (currentFile.width && currentFile.height) {
        const ratio = currentFile.width / currentFile.height;
        calculatedWidth = Math.round((calculatedHeight * ratio) / 2) * 2;
        autoScaleText = `(Рекомендуемое разрешение: <b>${calculatedWidth}x${calculatedHeight}</b>)`;
      }
    } else {
      calculatedHeight = parseInt(el.optScale.value);
      if (currentFile.width && currentFile.height) {
        const ratio = currentFile.width / currentFile.height;
        calculatedWidth = Math.round((calculatedHeight * ratio) / 2) * 2;
      }
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

  async function runCompression() {
    if (!currentFile) return;

    if (currentFile.needsServer || !currentFile.duration || currentFile.duration <= 0) {
      return await runServerCompression();
    }

    setBusy(true);
    setProgress(0);

    let inputName = '';
    let outputName = '';
    try {
      setStatus('Подключение ffmpeg...', false);
      ffmpeg = await window.natrixSharedFFmpeg.ensure((msg, isError) => {
        setStatus(msg, isError);
      });

      window.natrixSharedFFmpeg.setProgressListener((progress) => {
        const pct = Math.min(100, Math.max(0, Math.round(progress * 100)));
        setProgress(pct);
      });

      inputName = 'input.' + currentFile.ext;
      outputName = 'output.mp4';

      setStatus('Загрузка видеофайла в память...', false);
      await ffmpeg.writeFile(inputName, await window.natrixSharedFFmpeg.fetchFile(currentFile.blob));

      setStatus('Подготовка аргументов сжатия...', false);
      const args = buildFfmpegArgs(inputName, outputName);
      console.log('[compress] running ffmpeg with args:', args.join(' '));

      setStatus('Сжатие видео (это может занять время)...', false);
      await window.natrixSharedFFmpeg.exec(args);

      setStatus('Чтение готового файла...', false);
      const data = await ffmpeg.readFile(outputName);
      if (!data || data.length === 0) {
        throw new Error('Получен пустой файл на выходе. Возможно, неверные параметры или кодек.');
      }

      resultBlob = new Blob([data], { type: 'video/mp4' });
      showResult(outputName);

      setStatus('Видео успешно сжато!', false);
      setProgress(0);

    } catch (err) {
      console.error(err);
      setStatus('Ошибка при сжатии: ' + (err.message || err), true);
      setProgress(0);

      setTimeout(() => {
        if (confirm("Локальное сжатие в браузере не удалось (вероятно, кодек AV1 или HEVC не поддерживается вашим браузером/WASM).\n\nХотите загрузить видео на сервер для сжатия? (Сжатие выполнится на сервере с помощью native ffmpeg).")) {
          runServerCompression();
        }
      }, 100);
    } finally {
      if (inputName) await window.natrixSharedFFmpeg.deleteFile(inputName);
      if (outputName) await window.natrixSharedFFmpeg.deleteFile(outputName);
      setBusy(false);
    }
  }

  async function runServerCompression() {
    setBusy(true);
    setProgress(0);
    setStatus('Загрузка видео на сервер для сжатия...', false);

    let duration = currentFile.duration;
    if (!duration || duration <= 0 || !isFinite(duration)) {
      duration = Math.max(10, Math.round((currentFile.size * 8) / (4000 * 1000)));
    }

    const targetMB = Math.max(0.5, targetSizeMB);
    const safetyMargin = 0.93;
    const targetSizeBits = targetMB * 8 * 1024 * 1024 * safetyMargin;

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
      scaleHeight = parseInt(el.optScale.value) || 0;
    }
    if (scaleHeight && currentFile.height && currentFile.height <= scaleHeight) {
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
          if (pct < 100) {
            setStatus(`Загрузка на сервер: ${pct}%...`, false);
          } else {
            setStatus('Файл загружен. Сервер выполняет сжатие (подождите)...', false);
          }
        }
      };

      xhr.upload.onload = () => {
        setProgress(100);
        setStatus('Файл загружен. Сервер выполняет сжатие (подождите)...', false);
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
    const targetMB = Math.max(0.5, targetSizeMB);
    const targetSizeBits = targetMB * 8 * 1024 * 1024 * safetyMargin;

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

    const args = ['-i', inputName];

    args.push('-map', '0:v:0', '-sn');
    if (audioMode !== 'mute') {
      args.push('-map', '0:a?');
    }

    let scaleHeight = null;
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

    if (scaleHeight && currentFile.height && currentFile.height > scaleHeight) {
      args.push('-vf', `scale=-2:${scaleHeight}`);
    } else {
      args.push('-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2');
    }

    args.push(
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-b:v', `${videoBitrateKbps}k`,
      '-maxrate', `${videoBitrateKbps}k`,
      '-bufsize', `${videoBitrateKbps * 2}k`,
      '-preset', el.optPreset.value
    );

    if (audioMode === 'mute') {
      args.push('-an');
    } else if (audioMode === 'mono64') {
      args.push('-c:a', 'aac', '-b:a', '64k', '-ac', '1');
    } else {
      args.push('-c:a', 'aac', '-b:a', '128k');
    }

    args.push('-y', outputName);
    return args;
  }

  function showResult(outputName) {
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
