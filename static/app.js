(function () {
  const landingView = document.getElementById('landing-view');
  const workspaceOverlay = document.getElementById('workspace-overlay');
  const workspacePanel = document.getElementById('workspace-panel');
  const backBtn = document.getElementById('workspace-back-btn');
  const logoHome = document.getElementById('logo-home');
  const workspaceTabs = document.getElementById('workspace-tabs');
  const sfxToggle = document.getElementById('sfx-toggle');

  const sections = {
    dlp: document.getElementById('section-dlp'),
    mpeg: document.getElementById('section-mpeg'),
    compress: document.getElementById('section-compress'),
    pass: document.getElementById('section-pass'),
  };

  let activeTool = null;

  function sfx(fn) {
    if (window.natrixSFX && typeof window.natrixSFX[fn] === 'function') {
      window.natrixSFX[fn]();
    }
  }

  function openTool(toolName, updateHash = true, playSound = true) {
    if (!sections[toolName]) return;
    if (playSound) {
      if (activeTool === null) {
        sfx('playOpen');
      } else if (activeTool !== toolName) {
        sfx('playClick');
      }
    }

    activeTool = toolName;
    document.body.classList.add('workspace-open');
    workspaceOverlay.classList.add('active');

    Object.entries(sections).forEach(([key, el]) => {
      if (el) el.classList.toggle('active', key === toolName);
    });

    if (workspaceTabs) {
      workspaceTabs.querySelectorAll('button[data-tab]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === toolName);
      });
    }

    document.querySelectorAll('.header-nav .nav-link').forEach((link) => {
      link.classList.toggle('active', link.dataset.open === toolName);
    });

    if (updateHash) {
      history.pushState(null, '', '#' + toolName);
    }
  }

  function closeWorkspace(updateHash = true, playSound = true) {
    if (!activeTool) return;
    if (playSound) sfx('playClose');

    activeTool = null;
    document.body.classList.remove('workspace-open');
    workspaceOverlay.classList.remove('active');

    Object.values(sections).forEach((el) => {
      if (el) el.classList.remove('active');
    });

    document.querySelectorAll('.header-nav .nav-link').forEach((link) => {
      link.classList.remove('active');
    });

    if (updateHash) {
      history.pushState(null, '', window.location.pathname);
    }
  }

  document.querySelectorAll('.card-wrapper').forEach((wrapper) => {
    const tool = wrapper.dataset.tool;
    wrapper.addEventListener('click', () => openTool(tool));
    wrapper.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openTool(tool);
      }
    });
    wrapper.addEventListener('mouseenter', () => sfx('playHover'));
  });

  const cursorGlow = document.getElementById('cursor-glow');
  if (cursorGlow) {
    let targetX = window.innerWidth / 2;
    let targetY = window.innerHeight / 2;
    let currentX = targetX;
    let currentY = targetY;
    let isMoving = false;

    window.addEventListener('pointermove', (e) => {
      targetX = e.clientX;
      targetY = e.clientY;
      if (!isMoving) {
        isMoving = true;
        cursorGlow.style.opacity = '1';
      }
    }, { passive: true });

    function renderCursor() {
      currentX += (targetX - currentX) * 0.12;
      currentY += (targetY - currentY) * 0.12;
      cursorGlow.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
      requestAnimationFrame(renderCursor);
    }
    requestAnimationFrame(renderCursor);
  }

  if (backBtn) {
    backBtn.addEventListener('click', () => closeWorkspace());
  }

  if (logoHome) {
    logoHome.addEventListener('click', (e) => {
      e.preventDefault();
      if (activeTool) closeWorkspace();
    });
  }

  document.querySelectorAll('.header-nav .nav-link').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.open;
      openTool(tool);
    });
    btn.addEventListener('mouseenter', () => sfx('playHover'));
  });

  if (workspaceTabs) {
    workspaceTabs.querySelectorAll('button[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openTool(btn.dataset.tab);
      });
      btn.addEventListener('mouseenter', () => sfx('playHover'));
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activeTool) {
      closeWorkspace();
    }
  });

  if (workspaceOverlay) {
    workspaceOverlay.addEventListener('click', (e) => {
      if (e.target === workspaceOverlay) {
        closeWorkspace();
      }
    });
  }

  function updateSfxUI(muted) {
    if (!sfxToggle) return;
    const iconOn = sfxToggle.querySelector('.sfx-icon-on');
    const iconOff = sfxToggle.querySelector('.sfx-icon-off');
    const label = document.getElementById('sfx-label');

    if (iconOn) iconOn.style.display = muted ? 'none' : 'block';
    if (iconOff) iconOff.style.display = muted ? 'block' : 'none';
    if (label) label.textContent = muted ? 'Muted' : 'SFX';
    sfxToggle.classList.toggle('muted', muted);
  }

  if (sfxToggle) {
    sfxToggle.addEventListener('click', () => {
      if (window.natrixSFX) {
        const isMuted = window.natrixSFX.toggleMute();
        updateSfxUI(isMuted);
        if (!isMuted) window.natrixSFX.playClick();
      }
    });
    if (window.natrixSFX) {
      updateSfxUI(window.natrixSFX.isMuted());
    }
  }

  document.querySelectorAll('button, .size-btn, .mode-toggle button').forEach((btn) => {
    if (!btn.classList.contains('floating-card')) {
      btn.addEventListener('mouseenter', () => sfx('playHover'));
      btn.addEventListener('click', () => sfx('playClick'));
    }
  });

  function handleHash() {
    const rawHash = window.location.hash.replace(/^#/, '').toLowerCase();
    if (sections[rawHash]) {
      openTool(rawHash, false, false);
    } else if (rawHash === '' && activeTool) {
      closeWorkspace(false, false);
    }
  }

  handleHash();

  // Register Service Worker for instant offline/cache-first PWA loading
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((reg) => {
        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      }).catch((err) => {
        console.warn('[natrix] ServiceWorker registration failed:', err);
      });
    });
  }
})();
