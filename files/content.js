// ── Platform detection ────────────────────────────────────────────────────────
const PLATFORM = window.location.hostname.includes('zoom.us') ? 'zoom' : 'meet';

// ── Shadow DOM sidebar ────────────────────────────────────────────────────────
let shadowHost = null;
let shadowRoot = null;
let isRecording = false;

function injectSidebar() {
  if (shadowHost) return;

  shadowHost = document.createElement('div');
  shadowHost.id = 'meetscribe-host';
  shadowHost.style.cssText = `
    position: fixed;
    top: 80px;
    right: 16px;
    z-index: 999999;
    width: 320px;
  `;
  document.body.appendChild(shadowHost);

  shadowRoot = shadowHost.attachShadow({ mode: 'closed' });

  shadowRoot.innerHTML = `
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, sans-serif; }
      #panel {
        background: #fff;
        border: 1px solid #e0e0e0;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 4px 24px rgba(0,0,0,0.12);
      }
      #header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        background: #f8f8f8;
        border-bottom: 1px solid #e0e0e0;
      }
      #title { font-size: 13px; font-weight: 600; color: #111; }
      #badge {
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 10px;
        background: #e8e8e8;
        color: #555;
      }
      #badge.live { background: #fee2e2; color: #dc2626; }
      #transcript-box {
        height: 240px;
        overflow-y: auto;
        padding: 12px;
        font-size: 13px;
        line-height: 1.6;
        color: #222;
        background: #fff;
      }
      .chunk { margin-bottom: 6px; }
      .speaker { font-weight: 600; color: #6366f1; font-size: 11px; margin-bottom: 2px; }
      .text { color: #333; }
      #footer {
        padding: 10px 16px;
        border-top: 1px solid #e0e0e0;
        display: flex;
        gap: 8px;
      }
      button {
        flex: 1;
        padding: 8px;
        border-radius: 8px;
        border: none;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: opacity 0.15s;
      }
      button:hover { opacity: 0.85; }
      #btn-start { background: #6366f1; color: #fff; }
      #btn-stop  { background: #f1f5f9; color: #333; display: none; }
      #btn-copy  { background: #f1f5f9; color: #333; }
    </style>
    <div id="panel">
      <div id="header">
        <span id="title">MeetScribe</span>
        <span id="badge">Idle</span>
      </div>
      <div id="transcript-box">
        <div style="color:#aaa;font-size:12px;text-align:center;margin-top:80px">
          Press Start to begin transcribing
        </div>
      </div>
      <div id="footer">
        <button id="btn-start">Start</button>
        <button id="btn-stop">Stop</button>
        <button id="btn-copy">Copy</button>
      </div>
    </div>
  `;

  // Button events
  shadowRoot.getElementById('btn-start').onclick = () => startRecording();
  shadowRoot.getElementById('btn-stop').onclick  = () => stopRecording();
  shadowRoot.getElementById('btn-copy').onclick  = () => copyTranscript();
}

// ── Recording controls ────────────────────────────────────────────────────────
function startRecording() {
  chrome.runtime.sendMessage(
    { type: 'START_RECORDING', tabId: null }, // SW will use sender.tab.id
    (res) => {
      if (res?.ok) setRecordingState(true);
    }
  );
}

function stopRecording() {
  chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (res) => {
    if (res?.ok) setRecordingState(false);
  });
}

function setRecordingState(recording) {
  isRecording = recording;
  const badge   = shadowRoot.getElementById('badge');
  const btnStart = shadowRoot.getElementById('btn-start');
  const btnStop  = shadowRoot.getElementById('btn-stop');

  if (recording) {
    badge.textContent = 'Live';
    badge.className = 'live';
    btnStart.style.display = 'none';
    btnStop.style.display = 'block';
    clearPlaceholder();
  } else {
    badge.textContent = 'Idle';
    badge.className = '';
    btnStart.style.display = 'block';
    btnStop.style.display = 'none';
  }
}

// ── Transcript rendering ──────────────────────────────────────────────────────
let placeholderCleared = false;

function clearPlaceholder() {
  if (placeholderCleared) return;
  shadowRoot.getElementById('transcript-box').innerHTML = '';
  placeholderCleared = true;
}

function appendChunk(chunk) {
  const box = shadowRoot.getElementById('transcript-box');
  const div = document.createElement('div');
  div.className = 'chunk';
  div.innerHTML = `
    <div class="speaker">Speaker ${chunk.speaker ?? '?'}</div>
    <div class="text">${chunk.text}</div>
  `;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function copyTranscript() {
  const box = shadowRoot.getElementById('transcript-box');
  navigator.clipboard.writeText(box.innerText);
}

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case 'RECORDING_STARTED': setRecordingState(true); break;
    case 'RECORDING_STOPPED': setRecordingState(false); break;
    case 'TRANSCRIPT_CHUNK':  appendChunk(msg.chunk); break;
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
// Wait for the meeting UI to mount before injecting
function waitForMeeting() {
  const selector = PLATFORM === 'zoom'
    ? '#meeting-client-inner-view'
    : 'c-meeting-ui, [data-meeting-code]';

  if (document.querySelector(selector) || document.readyState === 'complete') {
    injectSidebar();
    return;
  }

  const observer = new MutationObserver(() => {
    if (document.querySelector(selector)) {
      observer.disconnect();
      injectSidebar();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

waitForMeeting();
