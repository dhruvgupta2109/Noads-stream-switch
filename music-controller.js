(() => {
  if (window.__noadsMusicController) return;

  const state = {
    originals: new WeakMap(),
    activeTimers: new WeakMap(),
    controlled: new WeakSet()
  };

  async function prime(settings = {}) {
    const media = pickPrimaryMedia();
    if (!media) return { ok: false, reason: "No audio or video element found on music tab." };

    remember(media);
    state.controlled.add(media);
    media.muted = true;
    media.volume = 0;

    const play = await playMedia(media);
    if (play.ok) {
      media.muted = false;
      media.volume = 0;
    }

    return status(media, "prime", play);
  }

  async function activate(settings = {}) {
    const targetVolume = clamp(Number(settings.musicTargetVolume), 0.05, 1, 0.75);
    const fadeMs = clamp(Number(settings.fadeMs), 250, 8000, 1800);
    const media = pickPrimaryMedia();

    if (!media) return { ok: false, reason: "No audio or video element found on music tab." };

    remember(media);
    state.controlled.add(media);
    media.muted = false;

    const play = media.paused
      ? await playWithMutedFallback(media)
      : { ok: true, reason: "Already playing." };
    if (!media.paused) {
      if (media.volume < targetVolume * 0.95 || media.muted) {
        media.muted = false;
        media.volume = Math.max(media.volume, Math.min(0.18, targetVolume));
        fade(media, targetVolume, fadeMs);
      } else {
        media.volume = targetVolume;
      }
    }

    return status(media, "activate", play);
  }

  function deactivate(settings = {}) {
    const fadeMs = clamp(Number(settings.fadeMs), 250, 8000, 1800);
    const keepWarm = settings.keepWarm !== false;
    let found = false;

    for (const media of findMedia()) {
      if (!state.controlled.has(media) && !isLikelyPrimary(media)) continue;
      found = true;
      remember(media);
      fade(media, 0, fadeMs, () => {
        const original = state.originals.get(media);
        media.volume = 0;

        if (keepWarm) {
          media.muted = false;
          if (media.paused) {
            playMedia(media);
          }
          return;
        }

        media.pause?.();
        if (original) {
          media.volume = original.volume;
          media.muted = original.muted;
        }
        state.controlled.delete(media);
      });
    }

    return { ok: found };
  }

  function stop(settings = {}) {
    return deactivate({ ...settings, keepWarm: false });
  }

  async function playMedia(media) {
    try {
      const playResult = media.play?.();
      if (playResult?.then) await playResult;
      return { ok: true, reason: "Playback accepted." };
    } catch (error) {
      return {
        ok: false,
        reason: error?.message || "Playback was blocked by the site or browser."
      };
    }
  }

  async function playWithMutedFallback(media) {
    media.muted = false;
    const unmutedPlay = await playMedia(media);
    if (unmutedPlay.ok) return unmutedPlay;

    media.muted = true;
    media.volume = 0;
    const mutedPlay = await playMedia(media);
    if (!mutedPlay.ok) return unmutedPlay;

    media.muted = false;
    return {
      ok: true,
      reason: "Playback accepted after muted warm-up."
    };
  }

  function status(media, command, play) {
    return {
      ok: Boolean(play?.ok),
      command,
      playReason: play?.reason || "",
      paused: Boolean(media.paused),
      muted: Boolean(media.muted),
      volume: Number(media.volume),
      currentTime: Number(media.currentTime || 0),
      tagName: media.tagName
    };
  }

  function findMedia() {
    return [...document.querySelectorAll("audio, video")].filter((media) => {
      return media.readyState > 0 || media.src || media.currentSrc;
    });
  }

  function pickPrimaryMedia() {
    const media = findMedia();
    return (
      media.find((item) => state.controlled.has(item) && isLikelyPrimary(item)) ||
      media.find((item) => !item.paused && isLikelyPrimary(item)) ||
      media.find(isLikelyPrimary) ||
      media[0] ||
      null
    );
  }

  function isLikelyPrimary(media) {
    if (!media) return false;
    if (media.tagName === "AUDIO") return true;
    const rect = media.getBoundingClientRect();
    return rect.width >= 80 && rect.height >= 45;
  }

  function remember(media) {
    if (state.originals.has(media)) return;
    state.originals.set(media, {
      volume: media.volume,
      muted: media.muted,
      paused: media.paused
    });
  }

  function fade(media, targetVolume, durationMs, done) {
    const previousTimer = state.activeTimers.get(media);
    if (previousTimer) clearInterval(previousTimer);

    const startVolume = Number(media.volume) || 0;
    const start = performance.now();
    const tickMs = 80;
    let timer = null;

    function tick(now) {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      media.volume = clamp(startVolume + (targetVolume - startVolume) * eased, 0, 1, 0);

      if (progress >= 1) {
        if (timer) clearInterval(timer);
        state.activeTimers.delete(media);
        media.volume = targetVolume;
        done?.();
      }
    }

    tick(performance.now());
    timer = setInterval(() => tick(performance.now()), tickMs);
    state.activeTimers.set(media, timer);
  }

  function clamp(value, min, max, fallback) {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  }

  window.__noadsMusicController = {
    prime,
    activate,
    deactivate,
    stop
  };
})();
