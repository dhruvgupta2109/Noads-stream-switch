const elements = {
  matchTab: document.querySelector("#matchTab"),
  musicTab: document.querySelector("#musicTab"),
  start: document.querySelector("#start"),
  stop: document.querySelector("#stop"),
  refreshTabs: document.querySelector("#refreshTabs"),
  message: document.querySelector("#message"),
  statusText: document.querySelector("#statusText"),
  musicVolume: document.querySelector("#musicVolume"),
  fadeMs: document.querySelector("#fadeMs"),
  resumeMs: document.querySelector("#resumeMs")
};

document.addEventListener("DOMContentLoaded", init);
elements.refreshTabs.addEventListener("click", loadTabs);
elements.start.addEventListener("click", start);
elements.stop.addEventListener("click", stop);

async function init() {
  await verifyBackground();
  await loadTabs();
  await renderState();
}

async function verifyBackground() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "NOADS_PING" });
    if (!response?.ok) {
      throw new Error(response?.error || "Background service worker is not responding.");
    }
  } catch (error) {
    setMessage(
      "Reload this unpacked extension in chrome://extensions, then reopen the popup.",
      true
    );
    throw error;
  }
}

async function loadTabs() {
  setMessage("Loading tabs...");
  const tabs = await chrome.tabs.query({});
  const eligible = tabs.filter((tab) => isInjectableUrl(tab.url));
  populateSelect(elements.matchTab, eligible);
  populateSelect(elements.musicTab, eligible);
  await restoreSelections();
  setMessage("");
}

function populateSelect(select, tabs) {
  const previous = select.value;
  select.textContent = "";

  for (const tab of tabs) {
    const option = document.createElement("option");
    option.value = String(tab.id);
    option.textContent = formatTab(tab);
    select.append(option);
  }

  if ([...select.options].some((option) => option.value === previous)) {
    select.value = previous;
  }
}

async function restoreSelections() {
  const { noadsState } = await chrome.storage.local.get("noadsState");
  if (noadsState?.matchTabId) elements.matchTab.value = String(noadsState.matchTabId);
  if (noadsState?.musicTabId) elements.musicTab.value = String(noadsState.musicTabId);
  if (noadsState?.settings) {
    elements.musicVolume.value = Math.round((noadsState.settings.musicTargetVolume || 0.75) * 100);
    elements.fadeMs.value = String(noadsState.settings.fadeMs || 1800);
    elements.resumeMs.value = String(noadsState.settings.resumeStableMs || 2500);
  }
}

async function start() {
  try {
    const matchTabId = Number(elements.matchTab.value);
    const musicTabId = Number(elements.musicTab.value);

    if (!matchTabId || !musicTabId) {
      throw new Error("Select both tabs first.");
    }
    if (matchTabId === musicTabId) {
      throw new Error("Choose two different tabs.");
    }

    await requestTabAccess(matchTabId, musicTabId);

    const response = await chrome.runtime.sendMessage({
      type: "NOADS_START",
      payload: {
        matchTabId,
        musicTabId,
        settings: currentSettings()
      }
    });

    if (!response?.ok) throw new Error(response?.error || "Could not start.");
    setMessage("Monitoring started.");
    renderState(response.state);
  } catch (error) {
    setMessage(error.message || String(error), true);
  }
}

async function stop() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "NOADS_STOP" });
    if (!response?.ok) throw new Error(response?.error || "Could not stop.");
    setMessage("Stopped.");
    renderState(response.state);
  } catch (error) {
    setMessage(error.message || String(error), true);
  }
}

async function renderState(state) {
  if (!state) {
    const response = await chrome.runtime.sendMessage({ type: "NOADS_GET_STATE" });
    state = response?.state;
  }

  if (!state?.running) {
    elements.statusText.textContent = "Select a match tab and a music tab.";
    return;
  }

  const mode = state.mode === "ad" ? "Ad detected" : "Match live";
  const musicStatus = formatMusicStatus(state.lastMusicStatus);
  elements.statusText.textContent = `${mode}: ${state.lastReason || "Monitoring"}${musicStatus}`;
}

async function requestTabAccess(...tabIds) {
  const tabs = await Promise.all(tabIds.map((tabId) => chrome.tabs.get(tabId)));
  const origins = [...new Set(tabs.map((tab) => originPattern(tab.url)).filter(Boolean))];
  if (!origins.length) return;

  const granted = await chrome.permissions.request({ origins });
  if (!granted) {
    throw new Error("Site access is required to monitor and control the selected tabs.");
  }
}

function currentSettings() {
  return {
    musicTargetVolume: Number(elements.musicVolume.value) / 100,
    fadeMs: Number(elements.fadeMs.value),
    resumeStableMs: Number(elements.resumeMs.value)
  };
}

function formatTab(tab) {
  const title = tab.title || tab.url || `Tab ${tab.id}`;
  const host = safeHost(tab.url);
  const label = host ? `${title} (${host})` : title;
  return label.length > 86 ? `${label.slice(0, 83)}...` : label;
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function isInjectableUrl(url = "") {
  return url.startsWith("http://") || url.startsWith("https://");
}

function originPattern(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return `${parsed.protocol}//${parsed.hostname}/*`;
  } catch {
    return null;
  }
}

function setMessage(text, isError = false) {
  elements.message.textContent = text;
  elements.message.classList.toggle("error", Boolean(isError));
}

function formatMusicStatus(status) {
  if (!status) return "";
  if (!status.ok) return ` | Music blocked: ${status.playReason || status.reason || "unknown"}`;
  const stateText = status.paused ? "paused" : "playing";
  return ` | Music ${stateText}, volume ${Math.round((status.volume || 0) * 100)}%`;
}
