// ============================================================
// natrix shared ffmpeg loader
// Manages a single loaded instance of ffmpeg.wasm across tabs.
// ============================================================

window.natrixSharedFFmpeg = (function () {
  let ffmpeg = null;
  let ffmpegReady = false;
  let _loadingPromise = null;
  let activeProgressListener = null;

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

      ffmpeg.on('log', ({ message }) => console.log('[ffmpeg-shared]', message));

      const BASE = '/static/ffmpeg';
      try {
        if (statusCallback) statusCallback('Загружаю ядро ffmpeg (1/3 — core.js)...', false);
        const coreURL = await _toBlobURL(`${BASE}/ffmpeg-core.js`, 'text/javascript');
        if (statusCallback) statusCallback('Загружаю ядро ffmpeg (2/3 — core.wasm ~32МБ)...', false);
        const wasmURL = await _toBlobURL(`${BASE}/ffmpeg-core.wasm`, 'application/wasm');
        if (statusCallback) statusCallback('Загружаю ядро ffmpeg (3/3 — worker)...', false);
        const workerURL = await _toBlobURL(`${BASE}/ffmpeg-core.worker.js`, 'text/javascript');

        await ffmpeg.load({ coreURL, wasmURL, workerURL });
        ffmpegReady = true;
        if (statusCallback) statusCallback('', false);
        return ffmpeg;
      } catch (e) {
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
    isReady: () => ffmpegReady,
    getFFmpeg: () => ffmpeg,
    setProgressListener,
    fetchFile,
  };
})();
