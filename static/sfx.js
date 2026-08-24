// ==========================================================================
// natrix SFX — Zero-dependency, lightweight Web Audio API Sound Synthesizer
// Generates deep, muffled, ultra-satisfying tactile sound effects purely in code.
// No external assets, zero bandwidth, zero CORS issues.
// ==========================================================================

(function () {
  let ctx = null;
  let muted = localStorage.getItem('natrix_sfx_muted') === 'true';

  function getAudioContext() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        ctx = new AudioCtx();
      }
    }
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  // Ensure AudioContext starts on initial click/keydown
  function initOnGesture() {
    getAudioContext();
    window.removeEventListener('pointerdown', initOnGesture);
    window.removeEventListener('keydown', initOnGesture);
  }
  window.addEventListener('pointerdown', initOnGesture, { once: true });
  window.addEventListener('keydown', initOnGesture, { once: true });

  const sfx = {
    isMuted() {
      return muted;
    },

    setMuted(val) {
      muted = Boolean(val);
      localStorage.setItem('natrix_sfx_muted', muted ? 'true' : 'false');
      window.dispatchEvent(new CustomEvent('sfx-mute-changed', { detail: { muted } }));
      return muted;
    },

    toggleMute() {
      return this.setMuted(!muted);
    },

    // 1. Muffled, deep tactical click / thud
    playClick() {
      if (muted) return;
      const ac = getAudioContext();
      if (!ac) return;

      const now = ac.currentTime;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      const filter = ac.createBiquadFilter();

      // Lowpass filter to create warm muffled quality
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(420, now);
      filter.frequency.exponentialRampToValueAtTime(80, now + 0.08);

      // Pitch sweep
      osc.type = 'sine';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + 0.08);

      // Gain envelope
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ac.destination);

      osc.start(now);
      osc.stop(now + 0.09);
    },

    // 2. Soft micro-hover sound
    playHover() {
      if (muted) return;
      const ac = getAudioContext();
      if (!ac) return;

      const now = ac.currentTime;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      const filter = ac.createBiquadFilter();

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(320, now);

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.04);

      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ac.destination);

      osc.start(now);
      osc.stop(now + 0.045);
    },

    // 3. Deep resonant card expansion whoosh
    playOpen() {
      if (muted) return;
      const ac = getAudioContext();
      if (!ac) return;

      const now = ac.currentTime;
      const osc = ac.createOscillator();
      const subOsc = ac.createOscillator();
      const gain = ac.createGain();
      const filter = ac.createBiquadFilter();

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(150, now);
      filter.frequency.exponentialRampToValueAtTime(550, now + 0.12);
      filter.frequency.exponentialRampToValueAtTime(100, now + 0.28);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(90, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.14);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.28);

      subOsc.type = 'triangle';
      subOsc.frequency.setValueAtTime(55, now);
      subOsc.frequency.exponentialRampToValueAtTime(110, now + 0.14);
      subOsc.frequency.exponentialRampToValueAtTime(60, now + 0.28);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.18, now + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

      osc.connect(filter);
      subOsc.connect(filter);
      filter.connect(gain);
      gain.connect(ac.destination);

      osc.start(now);
      subOsc.start(now);
      osc.stop(now + 0.31);
      subOsc.stop(now + 0.31);
    },

    // 4. Soft collapse / back sound
    playClose() {
      if (muted) return;
      const ac = getAudioContext();
      if (!ac) return;

      const now = ac.currentTime;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      const filter = ac.createBiquadFilter();

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(400, now);
      filter.frequency.exponentialRampToValueAtTime(80, now + 0.18);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(60, now + 0.18);

      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ac.destination);

      osc.start(now);
      osc.stop(now + 0.21);
    },

    // 5. Warm dual harmonic chime (success/complete)
    playSuccess() {
      if (muted) return;
      const ac = getAudioContext();
      if (!ac) return;

      const now = ac.currentTime;
      const notes = [523.25, 659.25, 783.99]; // C5, E5, G5 major triad

      notes.forEach((freq, i) => {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        const filter = ac.createBiquadFilter();

        const delay = i * 0.045;
        const noteStart = now + delay;
        const noteDuration = 0.28;

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1200, noteStart);
        filter.frequency.exponentialRampToValueAtTime(400, noteStart + noteDuration);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, noteStart);

        gain.gain.setValueAtTime(0.001, noteStart);
        gain.gain.linearRampToValueAtTime(0.12, noteStart + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, noteStart + noteDuration);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ac.destination);

        osc.start(noteStart);
        osc.stop(noteStart + noteDuration + 0.02);
      });
    }
  };

  window.natrixSFX = sfx;
})();
