import { startHeartbeat, stopHeartbeat } from './heartbeat.js';

// ── State ─────────────────────────────────────────────────────────────────────
let recordingTabId = null;
let offscreenReady = false;

// ── Offscreen document ────────────────────────────────────────────────────────
async function ensureOffscreenDocument() {
  const existing = await chrome.offscreen.hasDocument().catch(() => false);
  if (existing) return;

  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL('offscreen/offscreen.html'),
    reasons: ['USER_MEDIA', 'DISPLAY_MEDIA'],
    justification: 'Capture meeting tab audio and microphone for transcription'
  });

  offscreenReady = true;
}

async function closeOffscreenDocument() {
  const existing = await chrome.offscreen.hasDocument().catch(() => false);
  if (!existing) return;
  await chrome.offscreen.closeDocument();
  offscreenReady = false;
}

// ── Recording control ─────────────────────────────────────────────────────────
async function startRecording(tabId) {
  recordingTabId = tabId;

  await ensureOffscreenDocument();

  // Get streamId for this specific tab
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });

  // Send to offscreen doc
  chrome.runtime.sendMessage({
    type: 'START_CAPTURE',
    streamId,
    tabId
  });

  startHeartbeat();

  // Notify content script
  chrome.tabs.sendMessage(tabId, { type: 'RECORDING_STARTED' });
}

async function stopRecording() {
  if (!recordingTabId) return;

  chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' });

  stopHeartbeat();
  await closeOffscreenDocument();

  chrome.tabs.sendMessage(recordingTabId, { type: 'RECORDING_STOPPED' });
  recordingTabId = null;
}

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {

    case 'START_RECORDING': {
      const tabId = msg.tabId || sender.tab?.id;
      startRecording(tabId)
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true; // async
    }

    case 'STOP_RECORDING': {
      stopRecording()
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    case 'GET_STATUS': {
      sendResponse({ recording: !!recordingTabId, tabId: recordingTabId });
      return false;
    }

    // Forwarded from offscreen — chunk arrived from Deepgram
    case 'TRANSCRIPT_CHUNK': {
      if (recordingTabId) {
        chrome.tabs.sendMessage(recordingTabId, {
          type: 'TRANSCRIPT_CHUNK',
          chunk: msg.chunk
        });
      }
      return false;
    }
  }
});

// ── Tab closed / navigated away ───────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === recordingTabId) stopRecording();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === recordingTabId && changeInfo.url) stopRecording();
});
