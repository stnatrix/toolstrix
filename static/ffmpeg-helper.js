window.natrixSharedFFmpeg = (function () {
  let ffmpeg = null;
  let ffmpegReady = false;
  let _loadingPromise = null;
  let activeProgressListener = null;

  const THREADS = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));

  const LOAD_TIMEOUT_MS = 180000;

  const recentLogs = [];

  async function ensure(statusCallback) {
    if (ffmpegReady) return ffmpeg;
    if (_loadingPromise) {
      if (statusCallback) statusCallback('Загрузка ffmpeg уже выполняется...');
      return _loadingPromise;
    }

    _loadingPromise = (async () => {
      const { FFmpeg } = FFmpegWASM;
      ffmpeg = new FFmpeg();

      ffmpeg.on('progress', ({ progress }) => {
        if (activeProgressListener) {
          activeProgressListener(progress);
        }
      });

      ffmpeg.on('log', ({ message }) => {
        console.log('[ffmpeg-shared]', message);
        if (typeof message === 'string') {
          recentLogs.push(message);
          if (recentLogs.length > 30) recentLogs.shift();
        }
      });

      const BASE = '/static/ffmpeg';
      let coreURL = null;
      let wasmURL = null;
      let workerURL = null;
      try {
        if (statusCallback) statusCallback('Загружаю ядро ffmpeg (1/3 — core.js)...', false);
        coreURL = await _toBlobURL(`${BASE}/ffmpeg-core.js`, 'text/javascript');
        if (statusCallback) statusCallback('Загружаю ядро ffmpeg (2/3 — core.wasm ~32МБ)...', false);
        wasmURL = await _toBlobURL(`${BASE}/ffmpeg-core.wasm`, 'application/wasm');
        if (statusCallback) statusCallback('Загружаю ядро ffmpeg (3/3 — worker)...', false);
        workerURL = await _toBlobURL(`${BASE}/ffmpeg-core.worker.js`, 'text/javascript');

        await withTimeout(
          ffmpeg.load({ coreURL, wasmURL, workerURL }),
          LOAD_TIMEOUT_MS,
          'ffmpeg не ответил за 3 минуты — воркер не запустился. Обнови страницу с очисткой кэша (Ctrl+F5).'
        );
        try { if (wasmURL) URL.revokeObjectURL(wasmURL); } catch (err) {}
        ffmpegReady = true;
        if (statusCallback) statusCallback('', false);
        return ffmpeg;
      } catch (e) {
        try { if (coreURL) URL.revokeObjectURL(coreURL); } catch (err) {}
        try { if (wasmURL) URL.revokeObjectURL(wasmURL); } catch (err) {}
        try { if (workerURL) URL.revokeObjectURL(workerURL); } catch (err) {}
        ffmpeg = null;
        ffmpegReady = false;
        if (statusCallback) statusCallback(`Ошибка загрузки ffmpeg: ${e.message || e}`, true);
        throw e;
      }
    })();

    return _loadingPromise.finally(() => {
      _loadingPromise = null;
    });
  }

  async function _toBlobURL(url, mimeType) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} при загрузке ${url}`);
    const buf = await resp.arrayBuffer();
    return URL.createObjectURL(new Blob([buf], { type: mimeType }));
  }

  function withTimeout(promise, ms, message) {
    let timer;
    return Promise.race([
      promise.finally(() => clearTimeout(timer)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  }

  async function exec(args) {
    const ff = await ensure();
    recentLogs.length = 0;
    let finalArgs = args;
    if (!args.includes('-threads')) {
      finalArgs = [...args];
      finalArgs.splice(finalArgs.length - 1, 0, '-threads', String(THREADS));
    }
    let code;
    try {
      code = await ff.exec(finalArgs);
    } catch (e) {
      reset();
      throw e;
    }
    if (code !== 0) {
      const errorDetail = recentLogs
        .filter(l => /error|invalid|failed|not divisible|cannot|unsupported/i.test(l))
        .slice(-2)
        .join('; ');
      const detailMsg = errorDetail ? `: ${errorDetail}` : '. Подробности — в консоли браузера.';
      throw new Error(`ffmpeg завершился с кодом ${code}${detailMsg}`);
    }
    return code;
  }

  function reset() {
    try { if (ffmpeg) ffmpeg.terminate(); } catch (e) {}
    ffmpeg = null;
    ffmpegReady = false;
    _loadingPromise = null;
    recentLogs.length = 0;
  }

  async function deleteFile(name) {
    if (!ffmpeg || !ffmpegReady) return;
    try {
      await ffmpeg.deleteFile(name);
    } catch (e) {}
  }

  function setProgressListener(callback) {
    activeProgressListener = callback;
  }

  async function fetchFile(file) {
    if (file instanceof Blob) {
      return new Uint8Array(await file.arrayBuffer());
    }
    if (typeof file === 'string') {
      const resp = await fetch(file);
      return new Uint8Array(await resp.arrayBuffer());
    }
    if (file instanceof ArrayBuffer) return new Uint8Array(file);
    if (ArrayBuffer.isView(file)) return new Uint8Array(file.buffer);
    throw new Error('fetchFile: неподдерживаемый тип данных');
  }

  return {
    ensure,
    exec,
    reset,
    deleteFile,
    threads: THREADS,
    isReady: () => ffmpegReady,
    getFFmpeg: () => ffmpeg,
    setProgressListener,
    fetchFile,
  };
})();
