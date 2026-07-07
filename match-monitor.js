(() => {
  if (window.__noadsMatchMonitor) return;

  const SIGNAL_TEXT =
    /\b(skip ad|ad \d+ of \d+|advertisement|commercial break|sponsored message|sponsor message)\b/i;
  const SHORT_AD_TEXT = /\bad\b/i;

  let timer = null;
  let lastSignature = "";

  function start(settings = {}) {
    stop();
    const intervalMs = Math.max(500, Math.min(2500, Number(settings.pollMs) || 900));
    report();
    timer = setInterval(report, intervalMs);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function report() {
    if (!chrome?.runtime?.id) {
      stop();
      return;
    }

    const result = detectAd();
    const signature = `${result.isAd}:${result.reason}:${Math.round(result.confidence * 100)}`;
    const payload = {
      type: "NOADS_MATCH_REPORT",
      payload: result
    };

    if (signature !== lastSignature || result.isAd) {
      lastSignature = signature;
      safeSendMessage(payload);
    } else {
      safeSendMessage(payload);
    }
  }

  function safeSendMessage(message) {
    try {
      chrome.runtime.sendMessage(message, () => {
        if (chrome.runtime.lastError) {
          stop();
        }
      });
    } catch {
      stop();
    }
  }

  function detectAd() {
    const explicit = explicitSignal();
    if (explicit) return explicit;

    const platform = platformSignal();
    if (platform) return platform;

    const text = visibleTextSignal();
    if (text) return text;

    return {
      isAd: false,
      confidence: 0,
      reason: "No ad signal"
    };
  }

  function explicitSignal() {
    const value =
      document.documentElement?.dataset?.noadsAd ||
      document.body?.dataset?.noadsAd ||
      window.__NOADS_AD_SIGNAL;

    if (value === true || value === "true" || value === "1") {
      return {
        isAd: true,
        confidence: 1,
        reason: "Page exposed noads ad signal"
      };
    }
    return null;
  }

  function platformSignal() {
    const checks = [
      {
        name: "YouTube ad UI",
        selectors: [
          ".ad-showing",
          ".ytp-ad-player-overlay",
          ".ytp-ad-text",
          ".ytp-ad-skip-button-container",
          ".video-ads .ytp-ad-module"
        ]
      },
      {
        name: "Twitch ad UI",
        selectors: [
          '[data-a-target="video-ad-label"]',
          '[data-a-target="player-ad-notice"]',
          '[data-test-selector="ad-banner-default-text"]',
          ".commercial-break-in-progress"
        ]
      },
      {
        name: "Generic ad UI",
        selectors: [
          '[aria-label*="advertisement" i]',
          '[aria-label*="skip ad" i]',
          '[class*="ad-overlay" i]',
          '[class*="ad-banner" i]',
          '[id*="ad-overlay" i]'
        ]
      }
    ];

    for (const check of checks) {
      for (const selector of check.selectors) {
        const node = queryVisible(selector);
        if (node) {
          return {
            isAd: true,
            confidence: 0.95,
            reason: check.name
          };
        }
      }
    }
    return null;
  }

  function visibleTextSignal() {
    const candidates = document.querySelectorAll(
      "button, [role='button'], div, span, p, ytd-player-legacy-desktop-watch-ads-renderer"
    );
    const limit = Math.min(candidates.length, 450);

    for (let i = 0; i < limit; i += 1) {
      const element = candidates[i];
      if (!isVisible(element)) continue;

      const text = normalizeText(element.textContent || element.getAttribute("aria-label") || "");
      if (!text || text.length > 110) continue;

      if (SIGNAL_TEXT.test(text) || (text.length <= 24 && SHORT_AD_TEXT.test(text))) {
        return {
          isAd: true,
          confidence: 0.72,
          reason: `Visible ad text: ${text.slice(0, 60)}`
        };
      }
    }

    return null;
  }

  function queryVisible(selector) {
    try {
      return [...document.querySelectorAll(selector)].find(isVisible) || null;
    } catch {
      return null;
    }
  }

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(element);
    return (
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      Number(style.opacity || 1) > 0.05
    );
  }

  function normalizeText(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  window.__noadsMatchMonitor = {
    start,
    stop,
    detectAd
  };
})();
