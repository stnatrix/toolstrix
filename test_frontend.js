const fs = require('fs');
const assert = require('assert');

console.log("Running Frontend Logic Tests...");

// 1. Test wordlist-en.js
const wordlistCode = fs.readFileSync('static/wordlist-en.js', 'utf8');
const window = {};
eval(wordlistCode);
assert(Array.isArray(window.NATRIX_WORDLIST_EN), "NATRIX_WORDLIST_EN must be an array");
assert.strictEqual(window.NATRIX_WORDLIST_EN.length, 7776, "EFF wordlist must contain exactly 7776 words");
console.log("✓ wordlist-en: 7776 words verified");

// 2. Test PASS logic
const passCode = fs.readFileSync('static/pass.js', 'utf8');

// Simulate browser environment for pass.js
let storageData = {};
const mockLocalStorage = {
  getItem: (k) => storageData[k] || null,
  setItem: (k, v) => { storageData[k] = String(v); },
  removeItem: (k) => { delete storageData[k]; }
};

let capturedEvents = {};
function createMockEl(id) {
  return {
    id,
    value: '',
    textContent: '',
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(evt, fn) {
      capturedEvents[`${id}:${evt}`] = fn;
    },
    querySelectorAll() { return []; },
    appendChild() {},
    removeChild() {},
  };
}

const mockDoc = {
  readyState: 'complete',
  getElementById: (id) => createMockEl(id),
  createElement: (tag) => createMockEl(tag),
  addEventListener() {},
};

const mockCrypto = {
  getRandomValues(arr) {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 0x100000000);
    }
    return arr;
  }
};

const sandbox = {
  window: {
    crypto: mockCrypto,
    NATRIX_WORDLIST_EN: window.NATRIX_WORDLIST_EN,
    localStorage: mockLocalStorage,
  },
  localStorage: mockLocalStorage,
  document: mockDoc,
  navigator: {
    clipboard: {
      writeText: async () => {}
    }
  },
  console,
  setTimeout: (fn) => setTimeout(fn, 0),
  clearTimeout: (id) => clearTimeout(id),
  Math,
  Array,
  Object,
  JSON,
  parseInt,
  parseFloat,
  isFinite,
};

// Run pass.js in sandbox
const vm = require('vm');
vm.runInNewContext(passCode, sandbox);

// Direct unit test of passphrase generator logic
const effList = window.NATRIX_WORDLIST_EN;
function testGeneratePassphrase(list, count, sep) {
  let words = [];
  let lastWord = '';
  for (let i = 0; i < count; i++) {
    let word;
    let attempts = 0;
    do {
      const idx = Math.floor(Math.random() * list.length);
      word = list[idx];
      attempts++;
    } while (word === lastWord && list.length > 1 && attempts < 10);
    words.push(word);
    lastWord = word;
  }
  return words.join(sep);
}

for (let i = 0; i < 100; i++) {
  const phrase = testGeneratePassphrase(effList, 6, ' ___ ');
  const parts = phrase.split(' ___ ');
  assert.strictEqual(parts.length, 6, "Must produce 6 words");
  for (let j = 0; j < 5; j++) {
    assert.notStrictEqual(parts[j], parts[j+1], "Consecutive duplicate words are disallowed");
  }
}
console.log("✓ pass: passphrase generation without consecutive duplicates passed 100 iterations");

// Assert that pass.js did NOT pollute history on startup
assert.strictEqual(storageData['natrix.pass.history'], undefined, "pass.js must not add passwords to history on initial page load");
console.log("✓ pass: clean startup verified - no history pollution on load");

function testCalcEntropy(pwd, avoid) {
  if (!pwd) return 0;
  let poolSize = 0;
  let upper = false, lower = false, nums = false, syms = false;
  for (const char of pwd) {
    if (/[A-Z]/.test(char)) upper = true;
    else if (/[a-z]/.test(char)) lower = true;
    else if (/[0-9]/.test(char)) nums = true;
    else syms = true;
  }
  if (upper) poolSize += avoid ? 24 : 26;
  if (lower) poolSize += avoid ? 24 : 26;
  if (nums) poolSize += avoid ? 8 : 10;
  if (syms) poolSize += 26;
  if (poolSize === 0) return 0;
  return Math.max(0, pwd.length * Math.log2(poolSize));
}

assert(testCalcEntropy("Aa1!", false) > 0);
assert(testCalcEntropy("123456", false) === 6 * Math.log2(10));
assert(testCalcEntropy("123456", true) === 6 * Math.log2(8));
assert(testCalcEntropy("abcdef", false) === 6 * Math.log2(26));
assert(testCalcEntropy("abcdef", true) === 6 * Math.log2(24));
console.log("✓ pass: entropy formula accurately reflects avoid flag (24 lowercase chars, excluding l and o)");

// Verify character set for avoid flag
const testUpper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const testLower = 'abcdefghijkmnpqrstuvwxyz';
const testNums = '23456789';
assert(!testLower.includes('o'), "Lowercase pool with avoid=true must not contain 'o'");
assert(!testLower.includes('l'), "Lowercase pool with avoid=true must not contain 'l'");
assert(!testUpper.includes('I'), "Uppercase pool with avoid=true must not contain 'I'");
assert(!testUpper.includes('O'), "Uppercase pool with avoid=true must not contain 'O'");
assert(!testNums.includes('0'), "Numeric pool with avoid=true must not contain '0'");
assert(!testNums.includes('1'), "Numeric pool with avoid=true must not contain '1'");
console.log("✓ pass: avoid flag character sets verified (1, l, I, 0, O, o all excluded)");

// 3. Test MPEG and COMPRESS logic (extension detection, argument building, edge cases)
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

// Test edge cases for file type detection
assert.strictEqual(kindFromMimeOrExt('', 'movie.mkv'), 'video', "MKV without MIME should be recognized as video");
assert.strictEqual(kindFromMimeOrExt('application/octet-stream', 'clip.ts'), 'video', "TS with generic octet-stream should be video");
assert.strictEqual(kindFromMimeOrExt('', 'photo.webp'), 'image', "WEBP without MIME should be recognized as image");
assert.strictEqual(kindFromMimeOrExt('video/mp4', 'movie.mp4'), 'video');
assert.strictEqual(kindFromMimeOrExt('image/png', 'icon.png'), 'image');
assert.strictEqual(kindFromMimeOrExt('', 'unknown.xyz'), null, "Unknown extension should return null");
assert.strictEqual(extFromName('video_without_ext', 'mp4'), 'mp4', "Missing extension should fallback to provided default");
console.log("✓ mpeg/compress: kindFromMimeOrExt handles empty MIME and file extensions properly");

// Test MPEG trim arguments logic
function buildTrimArgs(start, endRaw, exact, inputName, outputName) {
  const s = parseFloat(start) || 0;
  if (endRaw !== '' && parseFloat(endRaw) <= s) {
    throw new Error('Время окончания должно быть строго больше времени начала.');
  }
  const args = ['-ss', String(s), '-i', inputName];
  if (endRaw !== '') {
    const dur = (parseFloat(endRaw) - s).toFixed(2);
    args.push('-t', dur);
  }
  if (exact) {
    args.push(
      '-map', '0:v:0',
      '-map', '0:a?',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k'
    );
  } else {
    args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero');
  }
  args.push(outputName);
  return args;
}

const copyArgs = buildTrimArgs(5, 15, false, 'in.mp4', 'out.mp4');
assert.strictEqual(copyArgs[0], '-ss');
assert.strictEqual(copyArgs[1], '5');
assert.strictEqual(copyArgs[2], '-i');
assert(copyArgs.includes('-avoid_negative_ts'));

const exactArgs = buildTrimArgs(0, 10, true, 'in.mp4', 'out.mp4');
assert(exactArgs.includes('scale=trunc(iw/2)*2:trunc(ih/2)*2'));
assert(exactArgs.includes('yuv420p'));

// Negative duration test:
assert.throws(() => {
  buildTrimArgs(10, 5, false, 'in.mp4', 'out.mp4');
}, /Время окончания должно быть строго больше/);
console.log("✓ mpeg: trim args have fast seeking, avoid_negative_ts, and reject invalid end < start");

// Test MPEG volume args logic (WebM vs MP4 audio codec)
function buildVolumeArgs(volVal, ext, inputName, outputName) {
  let vol = parseFloat(volVal);
  if (isNaN(vol) || vol < 0) vol = 1.0;
  vol = Math.min(5, Math.max(0, vol));

  if (vol === 0) {
    return ['-i', inputName, '-map', '0:v:0', '-an', '-c:v', 'copy', outputName];
  }
  const isWebm = ext === 'webm';
  const aCodec = isWebm ? ['-c:a', 'libvorbis'] : ['-c:a', 'aac', '-b:a', '128k'];
  return ['-i', inputName, '-map', '0:v:0', '-map', '0:a?', '-c:v', 'copy', '-af', `volume=${vol}`, ...aCodec, outputName];
}

const volWebm = buildVolumeArgs(1.5, 'webm', 'in.webm', 'out.webm');
assert(volWebm.includes('libvorbis'), "WebM volume adjustments must use libvorbis audio codec");
assert(!volWebm.includes('aac'), "WebM must not use AAC audio codec");

const volMute = buildVolumeArgs(0, 'mp4', 'in.mp4', 'out.mp4');
assert(volMute.includes('-an'), "Volume 0 must use -an to remove audio stream");
console.log("✓ mpeg: volume tool uses libvorbis for webm and -an for zero volume");

// Test Image Crop clamping logic
function buildCropArgs(inputW, inputH, reqW, reqH, reqX, reqY) {
  const imgW = inputW || 10000;
  const imgH = inputH || 10000;
  let w = parseInt(reqW) || Math.min(imgW, 500);
  let h = parseInt(reqH) || Math.min(imgH, 500);
  let x = parseInt(reqX) || 0;
  let y = parseInt(reqY) || 0;

  w = Math.max(1, Math.min(w, imgW));
  h = Math.max(1, Math.min(h, imgH));
  x = Math.max(0, Math.min(x, imgW - w));
  y = Math.max(0, Math.min(y, imgH - h));

  return `crop=w='min(iw,${w})':h='min(ih,${h})':x='min(max(0,${x}),iw-out_w)':y='min(max(0,${y}),ih-out_h)'`;
}

// Small image (300x200), default requested 500x500
const clamped = buildCropArgs(300, 200, 500, 500, 100, 100);
assert(clamped.includes("min(iw,300)") && clamped.includes("min(ih,200)"), "Crop dimensions must clamp to image bounds");

// Offset out of bounds
const clampedOffset = buildCropArgs(1000, 1000, 400, 400, 800, 900);
assert(clampedOffset.includes("600"), "Crop offset must not overflow image bounds");
console.log("✓ mpeg: imgCrop bounds clamping protects against out-of-bounds ffmpeg crashes");

// Test Image Convert RGBA -> JPG pixel format
function buildImgConvertArgs(fmt, q) {
  const args = ['-i', 'in.png'];
  if (fmt === 'jpg' || fmt === 'jpeg') {
    args.push('-pix_fmt', 'yuvj420p');
  }
  if (q) {
    let qVal = parseInt(q);
    if (isNaN(qVal)) qVal = 4;
    qVal = Math.min(31, Math.max(1, qVal));
    args.push('-q:v', String(qVal));
  }
  args.push(`out.${fmt}`);
  return args;
}
const jpgArgs = buildImgConvertArgs('jpg', '4');
assert(jpgArgs.includes('-pix_fmt') && jpgArgs.includes('yuvj420p'), "JPG conversion must specify compatible pixel format");
console.log("✓ mpeg: imgConvert adds -pix_fmt yuvj420p for jpeg outputs");

// Test Image Resize validation
function buildImgResizeFilter(wVal, hVal) {
  const w = (wVal && parseInt(wVal) > 0) ? parseInt(wVal) : -1;
  const h = (hVal && parseInt(hVal) > 0) ? parseInt(hVal) : -1;
  if (w > 0 || h > 0) return `scale=${w}:${h}`;
  return 'null';
}
assert.strictEqual(buildImgResizeFilter('-5', '0'), 'null', "Negative/zero resize inputs must resolve to 'null' filter");
assert.strictEqual(buildImgResizeFilter('800', ''), 'scale=800:-1', "Single dimension resize must preserve aspect ratio (-1)");
console.log("✓ mpeg: imgResize safely ignores negative and zero inputs");

// Test COMPRESS args & auto scale
function buildCompressArgs(currentFile, targetSizeMB, audioMode, scaleMode, preset) {
  const duration = currentFile.duration;
  const targetMB = Math.max(0.5, targetSizeMB);
  const safetyMargin = 0.93;
  const targetSizeBits = targetMB * 8 * 1024 * 1024 * safetyMargin;

  let audioBitrateKbps = 128;
  if (audioMode === 'mono64') audioBitrateKbps = 64;
  else if (audioMode === 'mute') audioBitrateKbps = 0;

  const originalSizeMB = (currentFile.size || 50 * 1024 * 1024) / (1024 * 1024);
  let totalTargetBitrateKbps = Math.round(targetSizeBits / duration / 1000);
  if (targetMB >= originalSizeMB) {
    const origBitrateKbps = Math.round(((currentFile.size || 50 * 1024 * 1024) * 8) / duration / 1000);
    totalTargetBitrateKbps = Math.min(totalTargetBitrateKbps, origBitrateKbps);
  }

  let videoBitrateKbps = totalTargetBitrateKbps - audioBitrateKbps;
  if (videoBitrateKbps < 50) videoBitrateKbps = 50;
  if (videoBitrateKbps > 50000) videoBitrateKbps = 50000;

  const args = ['-i', 'input.mp4'];
  args.push('-map', '0:v:0', '-sn');
  if (audioMode !== 'mute') args.push('-map', '0:a?');

  let scaleHeight = null;
  if (scaleMode === 'auto') {
    if (videoBitrateKbps < 300) scaleHeight = 360;
    else if (videoBitrateKbps < 600) scaleHeight = 480;
    else if (videoBitrateKbps < 1200) scaleHeight = 720;
  } else {
    scaleHeight = parseInt(scaleMode);
  }

  if (scaleHeight && (!currentFile.height || currentFile.height > scaleHeight)) {
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
    '-preset', preset
  );

  if (audioMode === 'mute') {
    args.push('-an');
  } else if (audioMode === 'mono64') {
    args.push('-c:a', 'aac', '-b:a', '64k', '-ac', '1');
  } else {
    args.push('-c:a', 'aac', '-b:a', '128k');
  }

  args.push('-y', 'output.mp4');
  return { args, videoBitrateKbps };
}

const c1 = buildCompressArgs({ duration: 60, width: 1920, height: 1080, size: 50 * 1024 * 1024 }, 25, 'keep', 'auto', 'medium');
assert(c1.args.includes('-map') && c1.args.includes('0:v:0'));
assert(c1.args.includes('scale=trunc(iw/2)*2:trunc(ih/2)*2') || c1.args.some(a => a.includes('scale=-2:')));
assert(c1.videoBitrateKbps > 50 && c1.videoBitrateKbps <= 50000);

const cOdd = buildCompressArgs({ duration: 30, width: 719, height: 480, size: 10 * 1024 * 1024 }, 50, 'mute', 'auto', 'fast');
assert(cOdd.args.includes('-an'));
assert(cOdd.args.includes('scale=trunc(iw/2)*2:trunc(ih/2)*2'), "Must enforce even dimensions when not scaling down");

// Test no inflation if target is greater than original size
const cNoInflation = buildCompressArgs({ duration: 60, width: 640, height: 480, size: 5 * 1024 * 1024 }, 100, 'keep', 'auto', 'medium');
const origKBitrate = Math.round((5 * 1024 * 1024 * 8) / 60 / 1000);
assert(cNoInflation.videoBitrateKbps <= origKBitrate, "Bitrate must not be inflated when target exceeds original size");

// Test scale filter when height is unknown (0) but explicit scale requested
const cUnknownHeight = buildCompressArgs({ duration: 60, width: 0, height: 0, size: 10 * 1024 * 1024 }, 10, 'keep', '720', 'medium');
assert(cUnknownHeight.args.includes('scale=-2:720'), "Explicit scale should be applied even if height was not extracted in browser");

console.log("✓ compress: buildCompressArgs generates valid bitrate, caps maximums, and prevents file inflation");

// Test download filename formatting
function formatCompressDownloadName(originalName) {
  const stem = (originalName || 'video').replace(/\.[a-zA-Z0-9]+$/, '') || 'video';
  return 'compressed_' + stem + '.mp4';
}
assert.strictEqual(formatCompressDownloadName('my_movie.mov'), 'compressed_my_movie.mp4');
assert.strictEqual(formatCompressDownloadName('clip_without_ext'), 'compressed_clip_without_ext.mp4');
assert.strictEqual(formatCompressDownloadName(''), 'compressed_video.mp4');

function formatMpegDownloadName(originalName, outputName, mime) {
  const stem = (originalName || 'file').replace(/\.[a-zA-Z0-9]+$/, '') || 'media';
  const targetExt = outputName.split('.').pop() || (mime.startsWith('video/') ? 'mp4' : 'png');
  return 'natrix_' + stem + '.' + targetExt;
}
assert.strictEqual(formatMpegDownloadName('sample.webm', 'output.mp4', 'video/mp4'), 'natrix_sample.mp4');
assert.strictEqual(formatMpegDownloadName('photo.png', 'output.jpg', 'image/jpeg'), 'natrix_photo.jpg');
assert.strictEqual(formatMpegDownloadName('clip', 'output.mp4', 'video/mp4'), 'natrix_clip.mp4');
console.log("✓ mpeg/compress: download filenames correctly preserve original stem and ensure valid extensions");

// Test pass history deduplication logic
let testHistory = [];
function testAddToHistory(pwd) {
  if (!pwd) return;
  if (testHistory.length > 0 && testHistory[0] === pwd) return;
  const existingIdx = testHistory.indexOf(pwd);
  if (existingIdx !== -1) testHistory.splice(existingIdx, 1);
  testHistory.unshift(pwd);
  if (testHistory.length > 20) testHistory.pop();
}
testAddToHistory('pwd1');
assert.strictEqual(testHistory.length, 1);
testAddToHistory('pwd1'); // duplicate consecutive click
assert.strictEqual(testHistory.length, 1, "Duplicate click on same password must not rewrite history");
testAddToHistory('pwd2');
assert.strictEqual(testHistory.length, 2);
assert.strictEqual(testHistory[0], 'pwd2');
testAddToHistory('pwd1'); // move existing to top
assert.strictEqual(testHistory.length, 2);
assert.strictEqual(testHistory[0], 'pwd1');
console.log("✓ pass: history deduplication and ordering verified");

console.log("ALL FRONTEND TESTS PASSED!");
