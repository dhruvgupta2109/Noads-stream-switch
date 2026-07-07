const DEFAULT_SETTINGS = {
  fadeMs: 1800,
  musicTargetVolume: 0.75,
  resumeStableMs: 2500,
  staleFrameMs: 4500
};

const PROTOCOL_VERSION = 1;

const state = {
  running: false,
  matchTabId: null,
  musicTabId: null,
  mode: "idle",
  settings: { ...DEFAULT_SETTINGS },
  frames: new Map(),
  pendingResumeTimer: null,
  musicHeartbeatTimer: null,
  lastReason: "Not running",
  lastMusicStatus: null
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    noadsState: {
      running: false,
      mode: "idle",
      lastReason: "Installed"
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => {
      console.error(error);
      sendResponse({ ok: false, error: error.message || String(error) });
    });
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === state.matchTabId || tabId === state.musicTabId) {
    stopSession("A selected tab was closed").catch(console.error);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === state.matchTabId && changeInfo.status === "loading") {
    state.frames.clear();
  }
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "NOADS_PING":
      return {
        ok: true,
        protocolVersion: PROTOCOL_VERSION
      };
    case "NOADS_START":
      return startSession(message.payload);
    case "NOADS_STOP":
      await stopSession("Stopped by user");
      return { ok: true, state: await publicState() };
    case "NOADS_GET_STATE":
      return { ok: true, state: await publicState() };
    case "NOADS_MATCH_REPORT":
      return handleMatchReport(message.payload, sender);
    default:
      return {
        ok: false,
        error: `Unknown message type: ${message?.type || "missing"}. Reload the unpacked extension in chrome://extensions.`
      };
  }
}

async function startSession(payload = {}) {
  const matchTabId = Number(payload.matchTabId);
  const musicTabId = Number(payload.musicTabId);

  if (!Number.isInteger(matchTabId) || !Number.isInteger(musicTabId)) {
    throw new Error("Select both tabs before starting.");
  }
  if (matchTabId === musicTabId) {
    throw new Error("Match and music must be different tabs.");
  }

  await chrome.tabs.get(matchTabId);
  await chrome.tabs.get(musicTabId);

  state.matchTabId = matchTabId;
  state.musicTabId = musicTabId;
  state.settings = sanitizeSettings(payload.settings);
  state.frames.clear();
  state.running = true;
  state.mode = "match";
  state.lastReason = "Monitoring started";

  await injectMatchMonitor();
  await injectMusicController();
  await chrome.tabs.update(state.matchTabId, { muted: false });
  await chrome.tabs.update(state.musicTabId, { muted: true });
  await commandMusic("prime");
  await persistState();

  return { ok: true, state: await publicState() };
}

async function stopSession(reason) {
  clearResumeTimer();
  stopMusicHeartbeat();

  if (state.musicTabId !== null) {
    await safeTabUpdate(state.musicTabId, { muted: true });
    await commandMusic("stop").catch(() => {});
  }
  if (state.matchTabId !== null) {
    await safeTabUpdate(state.matchTabId, { muted: false });
  }

  state.running = false;
  state.mode = "idle";
  state.lastReason = reason;
  state.frames.clear();
  await persistState();
}

async function handleMatchReport(payload = {}, sender) {
  if (!state.running || sender?.tab?.id !== state.matchTabId) {
    return { ok: true, ignored: true };
  }

  const frameId = sender.frameId ?? 0;
  state.frames.set(frameId, {
    isAd: Boolean(payload.isAd),
    confidence: Number(payload.confidence || 0),
    reason: payload.reason || "No signal",
    at: Date.now()
  });

  await evaluateMatchState();
  return { ok: true };
}

async function evaluateMatchState() {
  const now = Date.now();
  for (const [frameId, frame] of state.frames) {
    if (now - frame.at > state.settings.staleFrameMs) {
      state.frames.delete(frameId);
    }
  }

  const adFrame = [...state.frames.values()].find((frame) => frame.isAd);
  if (adFrame) {
    clearResumeTimer();
    state.lastReason = adFrame.reason;
    if (state.mode !== "ad") {
      await switchToAd(adFrame.reason);
    } else {
      await persistState();
    }
    return;
  }

  if (state.mode === "ad" && !state.pendingResumeTimer) {
    state.pendingResumeTimer = setTimeout(() => {
      state.pendingResumeTimer = null;
      switchToMatch("Match signal restored").catch(console.error);
    }, state.settings.resumeStableMs);
  }
}

async function switchToAd(reason) {
  state.mode = "ad";
  state.lastReason = reason || "Ad detected";
  await chrome.tabs.update(state.matchTabId, { muted: true });
  await chrome.tabs.update(state.musicTabId, { muted: false });
  await commandMusic("activate");
  startMusicHeartbeat();
  await persistState();
}

async function switchToMatch(reason) {
  if (!state.running) return;
  stopMusicHeartbeat();
  state.mode = "match";
  state.lastReason = reason || "Match resumed";
  await commandMusic("deactivate");
  await chrome.tabs.update(state.musicTabId, { muted: true });
  await chrome.tabs.update(state.matchTabId, { muted: false });
  await persistState();
}

async function injectMatchMonitor() {
  const target = { tabId: state.matchTabId };
  await chrome.scripting.executeScript({
    target,
    files: ["match-monitor.js"]
  });
  await chrome.scripting.executeScript({
    target,
    func: (settings) => window.__noadsMatchMonitor?.start(settings),
    args: [state.settings]
  });
}

async function injectMusicController() {
  await chrome.scripting.executeScript({
    target: { tabId: state.musicTabId },
    files: ["music-controller.js"]
  });
}

async function commandMusic(command) {
  if (!state.running || state.musicTabId === null) return;
  const results = await chrome.scripting.executeScript({
    target: { tabId: state.musicTabId },
    func: (commandName, settings) => {
      const controller = window.__noadsMusicController;
      if (!controller || typeof controller[commandName] !== "function") {
        return { ok: false, reason: "Music controller is not available." };
      }
      return controller[commandName](settings);
    },
    args: [command, state.settings]
  });

  state.lastMusicStatus = results?.[0]?.result || null;
  return state.lastMusicStatus;
}

async function safeTabUpdate(tabId, updateProperties) {
  try {
    await chrome.tabs.update(tabId, updateProperties);
  } catch (error) {
    console.warn("Tab update failed", tabId, error);
  }
}

function sanitizeSettings(settings = {}) {
  return {
    fadeMs: clamp(Number(settings.fadeMs), 250, 8000, DEFAULT_SETTINGS.fadeMs),
    musicTargetVolume: clamp(
      Number(settings.musicTargetVolume),
      0.05,
      1,
      DEFAULT_SETTINGS.musicTargetVolume
    ),
    resumeStableMs: clamp(
      Number(settings.resumeStableMs),
      500,
      8000,
      DEFAULT_SETTINGS.resumeStableMs
    ),
    staleFrameMs: DEFAULT_SETTINGS.staleFrameMs
  };
}

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function clearResumeTimer() {
  if (state.pendingResumeTimer) {
    clearTimeout(state.pendingResumeTimer);
    state.pendingResumeTimer = null;
  }
}

function startMusicHeartbeat() {
  stopMusicHeartbeat();
  state.musicHeartbeatTimer = setInterval(() => {
    if (!state.running || state.mode !== "ad" || state.musicTabId === null) {
      stopMusicHeartbeat();
      return;
    }

    safeTabUpdate(state.musicTabId, { muted: false })
      .then(() => commandMusic("activate"))
      .then(() => persistState())
      .catch((error) => {
        state.lastMusicStatus = {
          ok: false,
          reason: error?.message || "Music heartbeat failed."
        };
        persistState().catch(console.error);
      });
  }, 1200);
}

function stopMusicHeartbeat() {
  if (state.musicHeartbeatTimer) {
    clearInterval(state.musicHeartbeatTimer);
    state.musicHeartbeatTimer = null;
  }
}

async function publicState() {
  const stored = await chrome.storage.local.get("noadsState");
  return {
    ...stored.noadsState,
    running: state.running,
    matchTabId: state.matchTabId,
    musicTabId: state.musicTabId,
    mode: state.mode,
    lastReason: state.lastReason,
    lastMusicStatus: state.lastMusicStatus,
    settings: state.settings
  };
}

async function persistState() {
  await chrome.storage.local.set({
    noadsState: {
      running: state.running,
      matchTabId: state.matchTabId,
      musicTabId: state.musicTabId,
      mode: state.mode,
      lastReason: state.lastReason,
      lastMusicStatus: state.lastMusicStatus,
      settings: state.settings,
      updatedAt: Date.now()
    }
  });
}
