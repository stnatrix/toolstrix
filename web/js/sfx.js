(function () {
  let ctx = null;
  let muted = localStorage.getItem("toolstrix_sfx_muted") === "true";

  function getAudioContext() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        ctx = new AudioCtx();
      }
    }
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function initOnGesture() {
    getAudioContext();
    window.removeEventListener("pointerdown", initOnGesture);
    window.removeEventListener("keydown", initOnGesture);
  }
  window.addEventListener("pointerdown", initOnGesture, { once: true });
  window.addEventListener("keydown", initOnGesture, { once: true });

  const sfx = {
    isMuted() {
      return muted;
    },
    setMuted(val) {
      muted = Boolean(val);
      localStorage.setItem("toolstrix_sfx_muted", muted ? "true" : "false");
      window.dispatchEvent(new CustomEvent("sfx-mute-changed", { detail: { muted } }));
      return muted;
    },
    toggleMute() {
      return this.setMuted(!muted);
    },
    playClick() {
      if (muted) return;
      const ac = getAudioContext();
      if (!ac) return;

      const now = ac.currentTime;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      const filter = ac.createBiquadFilter();

      filter.type = "lowpass";
      filter.frequency.setValueAtTime(360, now);
      filter.frequency.exponentialRampToValueAtTime(70, now + 0.07);

      osc.type = "sine";
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.07);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ac.destination);

      osc.start(now);
      osc.stop(now + 0.08);
    },
  };

  window.toolstrixSFX = sfx;
})();
