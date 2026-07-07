# NoAds Stream Switch

NoAds Stream Switch is a Chrome Manifest V3 extension that switches audio between two selected tabs: a live match stream and a music tab. When the extension detects an ad on the match tab, it mutes the match and fades in music. When the match resumes, it fades the music down and unmutes the stream.

## Features

- Select any two open Chrome tabs:
  - Match stream tab
  - Music tab
- Automatically mute the match tab during detected ad breaks.
- Automatically unmute and fade in music from the music tab.
- Fade music back down when the match resumes.
- Keep the music tab "warm" in the background so Chrome is less likely to block playback on repeated ad breaks.
- Popup status messages for music playback state and browser playback blocks.
- Local test pages for development and debugging.
- No build step required.

## How It Works

The extension uses three main parts:

- `background.js` coordinates the selected tabs, mute state, ad state, and music heartbeat.
- `match-monitor.js` runs in the match tab and looks for page-level ad signals.
- `music-controller.js` runs in the music tab and controls the main `audio` or `video` element.

Ad detection currently uses DOM-based signals such as visible ad labels, skip-ad UI, YouTube/Twitch-style ad overlays, and explicit test-page markers.

## Important Limitations

Chrome does not provide a universal "this video is currently an ad" API.

This extension works best when the streaming site exposes ad indicators in the page DOM. If a site inserts ads inside the protected video stream without any visible page-level signal, a normal extension cannot reliably detect that ad without a screen-capture/OCR-style approach.

Music control also depends on the music site. It works best with pages that use standard HTML `audio` or `video` elements. Some custom or DRM-heavy players may block programmatic play, pause, mute, or volume changes.

Chrome's autoplay policy also matters. You should click play once manually in the music tab before starting the extension.

## Installation

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select the project folder.
6. Pin `NoAds Stream Switch (Dev)` to the toolbar if desired.

After changing extension files, reload the extension from `chrome://extensions` and refresh any already-open match/music tabs.

## Usage

1. Open your match stream in one Chrome tab.
2. Open your music site in another Chrome tab.
3. In the music tab, click play once manually.
4. Open the extension popup.
5. Select the match stream tab.
6. Select the music tab.
7. Click `Start`.
8. Approve site access if Chrome asks.

When an ad is detected, the match tab is muted and the music tab fades in. When the match resumes, the music fades down and the match tab is unmuted.

Click `Stop` in the popup to end the session and restore the music tab.

## Local Testing

The repository includes simple test pages so you can verify the switching behavior without using a real stream.

Start a local server from the project root:

```bash
python3 -m http.server 8765
```

Open these pages in Chrome:

```text
http://127.0.0.1:8765/test/match.html
http://127.0.0.1:8765/test/music.html
```

Then:

1. Click `Prime Audio` on the music test page.
2. Open the extension popup.
3. Select the test match tab and test music tab.
4. Click `Start`.
5. Use `Show Advertisement` and `Resume Match` on the match test page.

## Development

Run syntax checks:

```bash
npm run check
```

There is no bundler or build pipeline. The extension is plain JavaScript loaded directly by Chrome.

## Project Structure

```text
.
├── background.js
├── manifest.json
├── match-monitor.js
├── music-controller.js
├── package.json
├── popup.css
├── popup.html
├── popup.js
└── test
    ├── match.html
    └── music.html
```

## Troubleshooting

### The popup says music is blocked

Click play once manually in the music tab, then start the extension again. Chrome often blocks programmatic playback until the page has received a user interaction.

### The popup says music is playing at 0%

Reload the extension, refresh the music tab, click play once manually, and start again. If it still happens, the music site may be overriding media volume.

### The extension works once, then stops after reload

After reloading an unpacked extension, refresh the match and music tabs. Old injected content scripts can remain in existing pages until the page is refreshed.

### Ads are not detected on a real streaming site

The site may not expose ad indicators in the DOM. Site-specific detection may need to be added for that provider.

## Repository Description

```text
Chrome extension that mutes a live stream during detected ads and fades in music from another tab.
```
