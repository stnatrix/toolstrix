(function () {
  const urlInput = document.getElementById("url-input");
  const previewBox = document.getElementById("preview-box");
  const previewThumb = document.getElementById("preview-thumb");
  const previewTitle = document.getElementById("preview-title");
  const previewDuration = document.getElementById("preview-duration");
  const controlsSection = document.getElementById("controls-section");
  const videoSelect = document.getElementById("video-select");
  const audioSelect = document.getElementById("audio-select");
  const downloadBtn = document.getElementById("download-btn");
  const btnText = document.getElementById("btn-text");
  const progressWrap = document.getElementById("progress-wrap");
  const progressBarFill = document.getElementById("progress-bar-fill");
  const statusLabel = document.getElementById("status-label");
  const etaLabel = document.getElementById("eta-label");
  const errorBanner = document.getElementById("error-banner");
  const soundToggle = document.getElementById("sound-toggle");
  const logoutBtn = document.getElementById("logout-btn");

  let probeDebounceTimer = null;
  let lastProbedUrl = "";
  let currentJobId = null;
  let pollInterval = null;

  function updateSoundLabel() {
    soundToggle.textContent = window.toolstrixSFX.isMuted() ? "Sound: Off" : "Sound: On";
  }
  updateSoundLabel();

  soundToggle.addEventListener("click", () => {
    window.toolstrixSFX.toggleMute();
    updateSoundLabel();
    window.toolstrixSFX.playClick();
  });

  logoutBtn.addEventListener("click", async () => {
    window.toolstrixSFX.playClick();
    await fetch("/logout", { method: "POST" });
    window.location.href = "/login";
  });

  function showError(msg) {
    if (!msg) {
      errorBanner.style.display = "none";
      errorBanner.textContent = "";
      return;
    }
    errorBanner.textContent = msg;
    errorBanner.style.display = "flex";
  }

  function formatDuration(seconds) {
    if (!seconds) return "";
    const sec = Math.floor(seconds);
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const rem = sec % 60;
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
    }
    return `${mins}:${String(rem).padStart(2, "0")}`;
  }

  function enforceMutualExclusion() {
    const isNoVideo = videoSelect.value === "__none__";
    const isNoAudio = audioSelect.value === "__none__";

    Array.from(audioSelect.options).forEach((opt) => {
      if (opt.value === "__none__") {
        opt.disabled = isNoVideo;
      }
    });

    Array.from(videoSelect.options).forEach((opt) => {
      if (opt.value === "__none__") {
        opt.disabled = isNoAudio;
      }
    });

    if (isNoVideo && isNoAudio) {
      const firstValidAudio = Array.from(audioSelect.options).find((o) => o.value !== "__none__");
      if (firstValidAudio) {
        audioSelect.value = firstValidAudio.value;
      }
    }
  }

  videoSelect.addEventListener("change", () => {
    window.toolstrixSFX.playClick();
    enforceMutualExclusion();
  });

  audioSelect.addEventListener("change", () => {
    window.toolstrixSFX.playClick();
    enforceMutualExclusion();
  });

  async function fetchProbe(url) {
    if (url === lastProbedUrl) return;
    lastProbedUrl = url;
    showError(null);

    previewBox.style.display = "none";
    controlsSection.style.display = "none";

    try {
      const res = await fetch("/api/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showError(data.detail || "Failed to retrieve media information.");
        return;
      }

      const data = await res.json();
      renderProbeResults(data);
    } catch (err) {
      showError("Connection error while fetching media details.");
    }
  }

  function renderProbeResults(data) {
    previewTitle.textContent = data.title || "Media Stream";
    previewDuration.textContent = formatDuration(data.duration);
    if (data.thumbnail) {
      previewThumb.src = data.thumbnail;
      previewThumb.style.display = "block";
    } else {
      previewThumb.style.display = "none";
    }
    previewBox.style.display = "flex";

    videoSelect.innerHTML = "";
    (data.video_formats || []).forEach((vf) => {
      const opt = document.createElement("option");
      opt.value = vf.format_id;
      opt.textContent = vf.label;
      videoSelect.appendChild(opt);
    });
    const noVideoOpt = document.createElement("option");
    noVideoOpt.value = "__none__";
    noVideoOpt.textContent = "No video (audio only)";
    videoSelect.appendChild(noVideoOpt);

    audioSelect.innerHTML = "";
    (data.audio_formats || []).forEach((af) => {
      const opt = document.createElement("option");
      opt.value = af.format_id;
      opt.textContent = af.label;
      audioSelect.appendChild(opt);
    });
    const noAudioOpt = document.createElement("option");
    noAudioOpt.value = "__none__";
    noAudioOpt.textContent = "No audio (muted video)";
    audioSelect.appendChild(noAudioOpt);

    enforceMutualExclusion();
    controlsSection.style.display = "block";
  }

  urlInput.addEventListener("input", () => {
    clearTimeout(probeDebounceTimer);
    const val = urlInput.value.trim();
    if (val.startsWith("http://") || val.startsWith("https://")) {
      probeDebounceTimer = setTimeout(() => fetchProbe(val), 400);
    } else {
      previewBox.style.display = "none";
      controlsSection.style.display = "none";
      showError(null);
    }
  });

  urlInput.addEventListener("paste", () => {
    clearTimeout(probeDebounceTimer);
    setTimeout(() => {
      const val = urlInput.value.trim();
      if (val.startsWith("http://") || val.startsWith("https://")) {
        fetchProbe(val);
      }
    }, 50);
  });

  downloadBtn.addEventListener("click", async () => {
    window.toolstrixSFX.playClick();
    const url = urlInput.value.trim();
    if (!url) return;

    showError(null);
    downloadBtn.disabled = true;
    btnText.textContent = "Processing...";
    progressWrap.style.display = "block";
    progressBarFill.style.width = "5%";
    statusLabel.textContent = "Requesting download...";
    etaLabel.textContent = "";

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          video_format_id: videoSelect.value,
          audio_format_id: audioSelect.value,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showError(data.detail || "Server failed to queue download.");
        resetControls();
        return;
      }

      const jobData = await res.json();
      currentJobId = jobData.job_id;
      pollJobStatus(currentJobId);
    } catch (err) {
      showError("Failed to initiate download job.");
      resetControls();
    }
  });

  function pollJobStatus(jobId) {
    clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) {
          clearInterval(pollInterval);
          showError("Lost connection to job status.");
          resetControls();
          return;
        }

        const job = await res.json();
        if (job.status === "downloading") {
          const pct = Math.max(5, Math.min(99, job.progress || 0));
          progressBarFill.style.width = `${pct}%`;
          const spd = job.speed ? ` (${job.speed})` : "";
          statusLabel.textContent = `Downloading: ${Math.round(pct)}%${spd}`;
          etaLabel.textContent = job.eta ? `ETA: ${job.eta}` : "";
        } else if (job.status === "merging") {
          progressBarFill.style.width = "99%";
          statusLabel.textContent = "Finalizing media stream...";
          etaLabel.textContent = "";
        } else if (job.status === "ready") {
          clearInterval(pollInterval);
          progressBarFill.style.width = "100%";
          statusLabel.textContent = "Transferring file...";
          etaLabel.textContent = "";
          window.location.href = `/api/jobs/${jobId}/file`;
          setTimeout(resetControls, 2500);
        } else if (job.status === "failed") {
          clearInterval(pollInterval);
          showError(job.error || "Download failed.");
          resetControls();
        }
      } catch (err) {
        clearInterval(pollInterval);
        showError("Network interruption during download check.");
        resetControls();
      }
    }, 1000);
  }

  function resetControls() {
    clearInterval(pollInterval);
    downloadBtn.disabled = false;
    btnText.textContent = "Download";
    progressWrap.style.display = "none";
    progressBarFill.style.width = "0%";
    statusLabel.textContent = "";
    etaLabel.textContent = "";
  }
})();
