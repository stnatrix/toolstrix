(function () {
  const storage = {
    getItem(key) {
      try {
        return localStorage.getItem(key);
      } catch (e) {
        console.warn("Storage access warning (probably private mode):", e);
        return null;
      }
    },
    setItem(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch (e) {
        console.warn("Storage write warning:", e);
      }
    }
  };

  const WORDLISTS = {
    ru: [
      "uyut", "lofi", "chay", "kofe", "dozhd", "veter", "osen", "zakat", "rassvet", "mechta", 
      "son", "kniga", "pled", "svecha", "ten", "noch", "zvezda", "luna", "tishina", "les", 
      "list", "volna", "pesok", "nebo", "teplo", "kamin", "par", "utro", "vecher", "nezhno", 
      "tiho", "melodiya", "zvuk", "nota", "poy", "spokoyno", "shopt", "eho", "iskra", "chashka", 
      "noski", "kover", "dusha", "mysl", "okean", "oblako", "tuman", "sneg", "zima", "vesna", "leto"
    ]
  };

  function activeWordlist() {
    if (settings.phrase.lang === 'en') {
      if (Array.isArray(window.NATRIX_WORDLIST_EN) && window.NATRIX_WORDLIST_EN.length > 0) {
        return window.NATRIX_WORDLIST_EN;
      }
    }
    return WORDLISTS[settings.phrase.lang] || WORDLISTS.ru;
  }

  const els = {
    display: document.getElementById('pass-display'),
    container: document.getElementById('pass-display-container'),
    toast: document.getElementById('pass-toast'),
    strengthLabel: document.getElementById('pass-strength-label'),
    entropyDisplay: document.getElementById('pass-entropy-display'),
    segs: [
      document.getElementById('pass-seg-1'),
      document.getElementById('pass-seg-2'),
      document.getElementById('pass-seg-3'),
      document.getElementById('pass-seg-4')
    ],
    modeToggle: document.getElementById('pass-mode-toggle'),
    passGroup: document.getElementById('pass-settings-group'),
    phraseGroup: document.getElementById('phrase-settings-group'),
    
    lenSlider: document.getElementById('pass-len-slider'),
    lenVal: document.getElementById('pass-len-val'),
    chkUpper: document.getElementById('pass-chk-upper'),
    chkLower: document.getElementById('pass-chk-lower'),
    chkNums: document.getElementById('pass-chk-nums'),
    chkSyms: document.getElementById('pass-chk-syms'),
    chkAvoid: document.getElementById('pass-chk-avoid'),

    wordsSlider: document.getElementById('pass-words-slider'),
    wordsVal: document.getElementById('pass-words-val'),
    sepSelect: document.getElementById('pass-sep-select'),
    langSelect: document.getElementById('pass-lang-select'),

    generateBtn: document.getElementById('pass-generate-btn'),
    clearBtn: document.getElementById('pass-clear-btn'),
    historyList: document.getElementById('pass-history-list')
  };

  let currentMode = 'pass';
  let history = [];
  let settings = {
    pass: { len: 16, upper: true, lower: true, nums: true, syms: true, avoid: false },
    phrase: { words: 4, sep: '-', lang: 'en' }
  };

  function init() {
    try {
      loadState();
      setupEvents();
      generate(false);
      console.log("natrix.pass: Initialization completed successfully.");
    } catch (e) {
      console.error("natrix.pass: Critical error during initialization:", e);
    }
  }

  function loadState() {
    const savedSettings = storage.getItem('natrix.pass.settings');
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        if (parsed && typeof parsed === 'object') {
          currentMode = parsed.currentMode || 'pass';
          if (parsed.settings && typeof parsed.settings === 'object') {
            if (parsed.settings.pass && typeof parsed.settings.pass === 'object') {
              settings.pass = { ...settings.pass, ...parsed.settings.pass };
              if (!settings.pass.upper && !settings.pass.lower && !settings.pass.nums && !settings.pass.syms) {
                settings.pass.lower = true;
              }
            }
            if (parsed.settings.phrase && typeof parsed.settings.phrase === 'object') {
              settings.phrase = { ...settings.phrase, ...parsed.settings.phrase };
            }
          }
        }
      } catch (e) {
        console.error("natrix.pass: Error parsing stored settings:", e);
      }
    }

    try {
      if (els.lenSlider) {
        els.lenSlider.value = settings.pass.len || 16;
        els.lenVal.textContent = settings.pass.len || 16;
      }
      if (els.chkUpper) els.chkUpper.checked = !!settings.pass.upper;
      if (els.chkLower) els.chkLower.checked = !!settings.pass.lower;
      if (els.chkNums) els.chkNums.checked = !!settings.pass.nums;
      if (els.chkSyms) els.chkSyms.checked = !!settings.pass.syms;
      if (els.chkAvoid) els.chkAvoid.checked = !!settings.pass.avoid;

      if (els.wordsSlider) {
        els.wordsSlider.value = settings.phrase.words || 4;
        els.wordsVal.textContent = settings.phrase.words || 4;
      }
      if (els.sepSelect) els.sepSelect.value = settings.phrase.sep || '-';
      if (els.langSelect) els.langSelect.value = settings.phrase.lang || 'en';

      setMode(currentMode, false);
    } catch (e) {
      console.error("natrix.pass: Error syncing settings to DOM:", e);
    }

    const savedHistory = storage.getItem('natrix.pass.history');
    if (savedHistory) {
      try {
        const parsedHistory = JSON.parse(savedHistory);
        if (Array.isArray(parsedHistory)) {
          history = parsedHistory.filter(item => typeof item === 'string' && item.length > 0);
          renderHistory();
        }
      } catch (e) {
        console.error("natrix.pass: Error parsing history log:", e);
      }
    }
  }

  function saveSettings() {
    storage.setItem('natrix.pass.settings', JSON.stringify({ currentMode, settings }));
  }

  function saveHistory() {
    storage.setItem('natrix.pass.history', JSON.stringify(history));
  }

  function setupEvents() {
    if (els.modeToggle) {
      els.modeToggle.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          els.modeToggle.querySelectorAll('button').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          setMode(btn.dataset.mode);
        });
      });
    }

    if (els.lenSlider) {
      els.lenSlider.addEventListener('input', (e) => {
        els.lenVal.textContent = e.target.value;
        settings.pass.len = parseInt(e.target.value);
        saveSettings();
        generate(false);
      });
      els.lenSlider.addEventListener('change', () => {
        generate(true);
      });
    }

    const typeBoxes = [els.chkUpper, els.chkLower, els.chkNums, els.chkSyms];
    typeBoxes.forEach(chk => {
      if (chk) {
        chk.addEventListener('change', (e) => {
          const checkedCount = typeBoxes.filter(c => c && c.checked).length;
          if (checkedCount === 0) {
            e.target.checked = true;
          }
          settings.pass.upper = !!els.chkUpper.checked;
          settings.pass.lower = !!els.chkLower.checked;
          settings.pass.nums = !!els.chkNums.checked;
          settings.pass.syms = !!els.chkSyms.checked;
          saveSettings();
          generate(true);
        });
      }
    });

    if (els.chkAvoid) {
      els.chkAvoid.addEventListener('change', () => {
        settings.pass.avoid = !!els.chkAvoid.checked;
        saveSettings();
        generate(true);
      });
    }

    if (els.wordsSlider) {
      els.wordsSlider.addEventListener('input', (e) => {
        els.wordsVal.textContent = e.target.value;
        settings.phrase.words = parseInt(e.target.value);
        saveSettings();
        generate(false);
      });
      els.wordsSlider.addEventListener('change', () => {
        generate(true);
      });
    }

    if (els.sepSelect) {
      els.sepSelect.addEventListener('change', (e) => {
        settings.phrase.sep = e.target.value;
        saveSettings();
        generate(true);
      });
    }

    if (els.langSelect) {
      els.langSelect.addEventListener('change', (e) => {
        settings.phrase.lang = e.target.value;
        saveSettings();
        generate(true);
      });
    }

    if (els.generateBtn) els.generateBtn.addEventListener('click', () => generate(true));
    if (els.container) els.container.addEventListener('click', copyCurrent);
    if (els.clearBtn) els.clearBtn.addEventListener('click', clearHistory);
  }

  function setMode(mode, recordHistory = false) {
    currentMode = mode;
    if (els.modeToggle) {
      els.modeToggle.querySelectorAll('button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
      });
    }

    if (els.passGroup && els.phraseGroup) {
      if (mode === 'pass') {
        els.passGroup.style.display = 'block';
        els.phraseGroup.style.display = 'none';
      } else {
        els.passGroup.style.display = 'none';
        els.phraseGroup.style.display = 'block';
      }
    }
    saveSettings();
    generate(recordHistory);
  }

  function getRandomInt(max) {
    if (max <= 0) return 0;
    const cryptoObj = (typeof window !== 'undefined' && window.crypto) || (typeof crypto !== 'undefined' && crypto);
    if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
      const limit = Math.floor(0x100000000 / max) * max;
      let val;
      do {
        const arr = new Uint32Array(1);
        cryptoObj.getRandomValues(arr);
        val = arr[0];
      } while (val >= limit);
      return val % max;
    }
    return Math.floor(Math.random() * max);
  }

  function generate(recordHistory = true) {
    let pwd = '';
    let entropy = 0;

    if (currentMode === 'pass') {
      pwd = generatePassword();
      entropy = calculatePasswordEntropy(pwd);
    } else {
      pwd = generatePassphrase();
      const list = activeWordlist();
      entropy = (list && list.length > 0) ? settings.phrase.words * Math.log2(list.length) : 0;
    }

    if (!els.display) return;

    if (!pwd) {
      els.display.textContent = 'Выберите настройки';
      els.display.style.color = 'var(--text-dim)';
      updateStrength(0);
      return;
    }

    els.display.textContent = pwd;
    els.display.style.color = 'var(--text)';
    updateStrength(entropy);
    if (recordHistory) {
      addToHistory(pwd);
    }
  }

  function generatePassword() {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const upperSim = 'IO';
    const lower = 'abcdefghijkmnpqrstuvwxyz';
    const lowerSim = 'lo';
    const nums = '23456789';
    const numsSim = '01';
    const syms = '!@#$%^&*()_+-=[]{}|;:,.<>?';

    let pool = '';
    let must = [];

    if (settings.pass.upper) {
      const set = upper + (settings.pass.avoid ? '' : upperSim);
      pool += set;
      must.push(set[getRandomInt(set.length)]);
    }
    if (settings.pass.lower) {
      const set = lower + (settings.pass.avoid ? '' : lowerSim);
      pool += set;
      must.push(set[getRandomInt(set.length)]);
    }
    if (settings.pass.nums) {
      const set = nums + (settings.pass.avoid ? '' : numsSim);
      pool += set;
      must.push(set[getRandomInt(set.length)]);
    }
    if (settings.pass.syms) {
      pool += syms;
      must.push(syms[getRandomInt(syms.length)]);
    }

    if (pool.length === 0) return '';

    let arr = [];
    for (let i = 0; i < must.length && i < settings.pass.len; i++) {
      arr.push(must[i]);
    }
    while (arr.length < settings.pass.len) {
      arr.push(pool[getRandomInt(pool.length)]);
    }

    for (let i = arr.length - 1; i > 0; i--) {
      const j = getRandomInt(i + 1);
      const temp = arr[i];
      arr[i] = arr[j];
      arr[j] = temp;
    }

    return arr.join('');
  }

  function generatePassphrase() {
    const list = activeWordlist();
    if (!list || list.length === 0) return '';
    const count = Math.max(1, settings.phrase.words);
    const sep = settings.phrase.sep !== undefined ? settings.phrase.sep : '-';
    
    let words = [];
    let lastWord = '';
    for (let i = 0; i < count; i++) {
      let word;
      let attempts = 0;
      do {
        word = list[getRandomInt(list.length)];
        attempts++;
      } while (word === lastWord && list.length > 1 && attempts < 10);
      words.push(word);
      lastWord = word;
    }
    return words.join(sep);
  }

  function calculatePasswordEntropy(pwd) {
    if (!pwd) return 0;
    let poolSize = 0;
    let upper = false, lower = false, nums = false, syms = false;
    for (const char of pwd) {
      if (/[A-Z]/.test(char)) upper = true;
      else if (/[a-z]/.test(char)) lower = true;
      else if (/[0-9]/.test(char)) nums = true;
      else syms = true;
    }
    if (upper) poolSize += settings.pass.avoid ? 24 : 26;
    if (lower) poolSize += settings.pass.avoid ? 24 : 26;
    if (nums) poolSize += settings.pass.avoid ? 8 : 10;
    if (syms) poolSize += 26;

    if (poolSize === 0) return 0;
    return Math.max(0, pwd.length * Math.log2(poolSize));
  }

  function updateStrength(entropy) {
    if (!els.entropyDisplay || !els.strengthLabel) return;
    els.entropyDisplay.textContent = `${Math.round(entropy)} bits`;
    
    let score = 0;
    let label = 'Низкая';
    let color = 'var(--danger)';

    if (entropy > 0) {
      if (entropy < 28) {
        score = 1;
        label = 'Небезопасно';
        color = 'var(--danger)';
      } else if (entropy < 50) {
        score = 2;
        label = 'Средняя';
        color = 'var(--mpeg)';
      } else if (entropy < 75) {
        score = 3;
        label = 'Высокая';
        color = 'var(--pass)';
      } else {
        score = 4;
        label = 'Критическая';
        color = 'var(--dlp)';
      }
    }

    els.strengthLabel.textContent = label;
    els.strengthLabel.style.color = score === 0 ? 'var(--text-dim)' : color;

    els.segs.forEach((seg, idx) => {
      if (seg) {
        if (idx < score) {
          seg.style.backgroundColor = color;
          seg.style.boxShadow = `0 0 6px ${color}`;
        } else {
          seg.style.backgroundColor = 'transparent';
          seg.style.boxShadow = 'none';
        }
      }
    });
  }

  function addToHistory(pwd) {
    if (!pwd) return;
    if (history.length > 0 && history[0] === pwd) return;
    const existingIdx = history.indexOf(pwd);
    if (existingIdx !== -1) history.splice(existingIdx, 1);
    history.unshift(pwd);
    if (history.length > 20) history.pop();
    saveHistory();
    renderHistory();
  }

  function renderHistory() {
    if (els.clearBtn) {
      els.clearBtn.style.opacity = history.length === 0 ? '0.3' : '1';
      els.clearBtn.style.pointerEvents = history.length === 0 ? 'none' : 'auto';
    }
    if (!els.historyList) return;
    if (history.length === 0) {
      els.historyList.innerHTML = `<div style="font-size: 12px; color: var(--text-dim); text-align: center; font-style: italic; padding: 8px 0;">История пуста</div>`;
      return;
    }

    els.historyList.innerHTML = '';
    history.forEach((pwd, idx) => {
      const item = document.createElement('div');
      item.style.display = 'flex';
      item.style.justifyContent = 'space-between';
      item.style.alignItems = 'center';
      item.style.background = 'var(--bg-elevated)';
      item.style.border = '1px solid var(--card-border)';
      item.style.borderRadius = 'var(--radius-sm)';
      item.style.padding = '8px 12px';
      item.style.fontFamily = 'var(--font-mono)';
      item.style.fontSize = '12px';

      const textNode = document.createElement('span');
      textNode.textContent = pwd;
      textNode.style.wordBreak = 'break-all';
      textNode.style.cursor = 'pointer';
      textNode.style.color = 'var(--text-dim)';
      textNode.addEventListener('click', () => copyText(pwd));
      textNode.addEventListener('mouseover', () => textNode.style.color = 'var(--text)');
      textNode.addEventListener('mouseout', () => textNode.style.color = 'var(--text-dim)');

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '8px';

      const cp = document.createElement('button');
      cp.type = 'button';
      cp.title = 'Копировать';
      cp.setAttribute('aria-label', 'Копировать пароль');
      cp.style.background = 'none';
      cp.style.border = 'none';
      cp.style.color = 'var(--text-dim)';
      cp.style.cursor = 'pointer';
      cp.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
      cp.addEventListener('click', () => copyText(pwd));

      const del = document.createElement('button');
      del.type = 'button';
      del.title = 'Удалить';
      del.setAttribute('aria-label', 'Удалить из истории');
      del.style.background = 'none';
      del.style.border = 'none';
      del.style.color = 'var(--text-dim)';
      del.style.cursor = 'pointer';
      del.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
      del.addEventListener('click', () => {
        history.splice(idx, 1);
        saveHistory();
        renderHistory();
      });

      actions.appendChild(cp);
      actions.appendChild(del);
      item.appendChild(textNode);
      item.appendChild(actions);
      els.historyList.appendChild(item);
    });
  }

  function clearHistory() {
    if (!history || history.length === 0) return;
    if (confirm('Очистить всю историю?')) {
      history = [];
      saveHistory();
      renderHistory();
    }
  }

  function copyCurrent() {
    if (!els.display) return;
    const txt = els.display.textContent;
    if (txt === 'Выберите настройки' || txt === 'Нажмите «Сгенерировать»') return;
    addToHistory(txt);
    copyText(txt);
  }

  let toastTimeout;
  function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(() => {
        showToast();
      }).catch(() => {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    try {
      document.execCommand('copy');
      showToast();
    } catch (err) {
      console.error('Clipboard fallback copy error:', err);
    }
    document.body.removeChild(el);
  }

  function showToast() {
    if (window.natrixSFX) window.natrixSFX.playSuccess();
    if (!els.toast) return;
    els.toast.style.opacity = '1';
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      els.toast.style.opacity = '0';
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
