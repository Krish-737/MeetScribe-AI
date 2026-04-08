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
  try {
    await chrome.offscreen.closeDocument();
  } catch (e) {}
  offscreenReady = false;
}

// ── Recording control ─────────────────────────────────────────────────────────
async function startRecording(tabId, streamId) {
  recordingTabId = tabId;

  await ensureOffscreenDocument();

  // Wait briefly for offscreen document to fully load
  if (!offscreenReady) {
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (offscreenReady) {
          clearInterval(check);
          resolve();
        }
      }, 50);
      // Timeout after 2 seconds
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 2000);
    });
  }

  startHeartbeat();

  // Send streamId DIRECTLY to offscreen document (minimal delay to avoid expiry)
  console.log('[MeetScribe] Sending streamId directly to offscreen document');
  chrome.runtime.sendMessage({ 
    type: 'DIRECT_STREAMID', 
    streamId: streamId, 
    tabId: tabId 
  }).catch(err => {
    console.error('[MeetScribe] Failed to send streamId to offscreen:', err);
  });

  // Notify content script
  chrome.tabs.sendMessage(tabId, { type: 'RECORDING_STARTED' }, () => {
    if (chrome.runtime.lastError) {
        console.warn('[MeetScribe] Sidebar not reachable yet, will try again via capture progress');
    }
  });
}

async function startMicRecording(tabId) {
  recordingTabId = tabId;
  console.log('[MeetScribe] Starting microphone recording for tab:', tabId);
  
  try {
    // Ensure offscreen document exists (it has access to navigator.mediaDevices)
    await ensureOffscreenDocument();
    
    startHeartbeat();
    
    // Tell offscreen document to start microphone recording
    console.log('[MeetScribe] Sending START_MIC_RECORDING to offscreen');
    chrome.runtime.sendMessage({ 
      type: 'START_MIC_RECORDING',
      tabId: tabId,
      meetingId: `meeting_${tabId}_${Date.now()}`
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[MeetScribe] Failed to send to offscreen:', chrome.runtime.lastError);
      } else {
        console.log('[MeetScribe] Offscreen response:', response);
      }
    });
    
    return true;
  } catch (err) {
    console.error('[MeetScribe] Microphone recording setup failed:', err);
    console.error('[MeetScribe] Error name:', err.name);
    console.error('[MeetScribe] Error message:', err.message);
    throw err;
  }
}

async function stopRecording() {
  if (!recordingTabId) return;

  chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' }, () => {
    if (chrome.runtime.lastError) {}
  });

  stopHeartbeat();
  await closeOffscreenDocument();

  chrome.tabs.sendMessage(recordingTabId, { type: 'RECORDING_STOPPED' }, () => {
    if (chrome.runtime.lastError) {}
  });
  recordingTabId = null;
}

async function stopMicRecording() {
  if (!recordingTabId) return;

  console.log('[MeetScribe] Stopping microphone recording');
  
  // Close WebSocket
  if (globalThis.currentWs) {
    globalThis.currentWs.close();
    globalThis.currentWs = null;
  }
  
  // Stop audio tracks
  if (globalThis.currentMicStream) {
    globalThis.currentMicStream.getTracks().forEach(track => track.stop());
    globalThis.currentMicStream = null;
  }
  
  stopHeartbeat();

  chrome.tabs.sendMessage(recordingTabId, { type: 'RECORDING_STOPPED' }, () => {
    if (chrome.runtime.lastError) {}
  });
  recordingTabId = null;
}

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('[MeetScribe] Received message:', msg.type);

  switch (msg.type) {
    case 'START_RECORDING_WITH_MIC': {
      const tabId = msg.tabId || sender.tab?.id;
      console.log('[MeetScribe] Starting microphone recording for tab:', tabId);
      
      startMicRecording(tabId)
        .then(() => {
          console.log('[MeetScribe] Microphone recording started');
          sendResponse({ success: true });
        })
        .catch(err => {
          console.error('[MeetScribe] Microphone recording failed:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true; // async
    }

    case 'START_RECORDING': {
      const tabId = msg.tabId || sender.tab?.id;
      console.log('[MeetScribe] Starting recording process for tab:', tabId);
      
      if (!tabId) {
          sendResponse({ ok: false, error: 'Could not identify active tab' });
          return false;
      }

      startRecording(tabId, msg.streamId)
        .then(() => {
            console.log('[MeetScribe] startRecording() resolved');
            sendResponse({ ok: true });
        })
        .catch(err => {
            console.error('[MeetScribe] startRecording() failed:', err);
            sendResponse({ ok: false, error: err.message });
        });
      return true; // async
    }

    case 'STOP_RECORDING': {
      // Try to stop microphone recording first, then fall back to offscreen
      Promise.resolve()
        .then(async () => {
          if (globalThis.currentWs || globalThis.currentMicStream) {
            await stopMicRecording();
          } else {
            await stopRecording();
          }
        })
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    case 'GET_STATUS': {
      sendResponse({ recording: !!recordingTabId, tabId: recordingTabId });
      return false;
    }

    case 'REMOTE_LOG': {
      const prefix = msg.isError ? '🔴 [OFFSCREEN_ERROR]' : '🔵 [OFFSCREEN_LOG]';
      console.log(`${prefix}: ${msg.message}`);
      return false;
    }

    case 'CAPTURE_PROGRESS': {
      // Forward progress from offscreen to content script
      if (recordingTabId) {
        chrome.tabs.sendMessage(recordingTabId, msg, (res) => {
            if (chrome.runtime.lastError) {}
        });
      }
      return false;
    }

    // Forwarded from offscreen — chunk arrived from Deepgram
    case 'TRANSCRIPT_CHUNK': {
      if (recordingTabId) {
        chrome.tabs.sendMessage(recordingTabId, {
          type: 'TRANSCRIPT_CHUNK',
          chunk: msg.chunk
        }, () => {
          if (chrome.runtime.lastError) {
            // Silently ignore if tab is gone or sidebar not injected yet
          }
        });
      }
      return false;
    }
    
    // Catch-all for any other message types
    case 'CAPTURE_ERROR': {
      console.error('[MeetScribe] Capture Error reported:', msg.error);
      if (recordingTabId) {
        chrome.tabs.sendMessage(recordingTabId, { type: 'CAPTURE_ERROR', error: msg.error }, () => {
          if (chrome.runtime.lastError) {}
        });
      }
      return false;
    }

    case 'PREPARE_OFFSCREEN': {
      ensureOffscreenDocument();
      return false;
    }

    case 'REQUEST_DESKTOP_CAPTURE': {
      // Popup delegated to service worker - call chooseDesktopMedia here
      const tabId = msg.tabId;
      console.log('[MeetScribe] Popup requested desktop capture for tab:', tabId);
      
      // Pre-create offscreen if not already done
      ensureOffscreenDocument();
      
      // Call chooseDesktopMedia from service worker context (has better privileges)
      chrome.desktopCapture.chooseDesktopMedia(['tab', 'audio'], (streamId) => {
        if (!streamId) {
          console.log('[MeetScribe] User cancelled desktop capture');
          sendResponse({ ok: false, error: 'Cancelled by user' });
          return;
        }
        
        console.log('[MeetScribe] Got streamId from chooseDesktop Media in service worker:', streamId);
        recordingTabId = tabId;
        startHeartbeat();

        // Forward to offscreen immediately
        chrome.runtime.sendMessage({
          type: 'STREAM_FROM_POPUP',
          streamId: streamId,
          tabId: tabId
        }).catch(err => {
          console.error('[MeetScribe] Failed to forward to offscreen:', err);
        });

        // Notify content script
        chrome.tabs.sendMessage(tabId, { type: 'RECORDING_STARTED' }, () => {
          if (chrome.runtime.lastError) {
            console.warn('[MeetScribe] Sidebar not reachable yet, will try again via capture progress');
          }
        });

        sendResponse({ ok: true });
      });
      
      return true; // async
    }

    case 'STREAM_FROM_POPUP': {
      // Popup got the streamId and is sending to offscreen via service worker
      const tabId = msg.tabId;
      const streamId = msg.streamId;
      
      console.log('[MeetScribe] Received streamId from popup for tab:', tabId);
      recordingTabId = tabId;
      startHeartbeat();

      // Forward IMMEDIATELY to offscreen (offscreen is already loaded)
      chrome.runtime.sendMessage({
        type: 'STREAM_FROM_POPUP',
        streamId: streamId,
        tabId: tabId
      }).catch(err => {
        console.error('[MeetScribe] Failed to forward to offscreen:', err);
      });

      // Notify content script
      chrome.tabs.sendMessage(tabId, { type: 'RECORDING_STARTED' }, () => {
        if (chrome.runtime.lastError) {
          console.warn('[MeetScribe] Sidebar not reachable yet, will try again via capture progress');
        }
      });

      sendResponse({ ok: true });
      return false;
    }

    case 'START_CAPTURE_NOW': {
      // New unique message type from popup to avoid duplicate routing
      const tabId = msg.tabId;
      const streamId = msg.streamId;
      
      console.log('[MeetScribe] START_CAPTURE_NOW - streamId for tab:', tabId);
      console.log('[MeetScribe] Timestamp received by service worker:', Date.now());
      
      recordingTabId = tabId;
      startHeartbeat();

      // Forward to offscreen with minimal delay
      console.log('[MeetScribe] Forwarding to offscreen immediately');
      const forwardTime = Date.now();
      chrome.runtime.sendMessage({
        type: 'STREAM_FROM_POPUP',
        streamId: streamId,
        tabId: tabId,
        forwardTime: forwardTime
      }).catch(err => {
        console.error('[MeetScribe] Failed to forward to offscreen:', err);
      });

      // Notify content script
      chrome.tabs.sendMessage(tabId, { type: 'RECORDING_STARTED' }, () => {
        if (chrome.runtime.lastError) {
          console.warn('[MeetScribe] Sidebar not reachable yet, will try again via capture progress');
        }
      });

      sendResponse({ ok: true });
      return false;
    }

    case 'USE_STREAM_ID': {
      // Popup got streamId from chooseDesktopMedia and is passing it to offscreen
      const tabId = msg.tabId;
      const streamId = msg.streamId;
      
      console.log('[MeetScribe] USE_STREAM_ID - streamId for tab:', tabId);
      recordingTabId = tabId;
      startHeartbeat();

      // Forward to offscreen (minimal pass-through)
      chrome.runtime.sendMessage({
        type: 'USE_STREAM_ID',
        streamId: streamId,
        tabId: tabId
      }).catch(err => {
        console.error('[MeetScribe] Failed to forward to offscreen:', err);
      });

      // Notify content script
      chrome.tabs.sendMessage(tabId, { type: 'RECORDING_STARTED' }, () => {
        if (chrome.runtime.lastError) {
          console.warn('[MeetScribe] Sidebar not reachable yet, will try again via capture progress');
        }
      });

      sendResponse({ ok: true });
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
