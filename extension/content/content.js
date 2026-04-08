// ── Platform detection ────────────────────────────────────────────────────────
const PLATFORM = window.location.hostname.includes('zoom.us') ? 'zoom' : 
                 window.location.hostname.includes('teams.microsoft.com') ? 'teams' : 'meet';

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
        font-size: 10px;
        padding: 2px 8px;
        border-radius: 12px;
        background: #f1f5f9;
        color: #475569;
        font-weight: 700;
        text-transform: uppercase;
        display: flex;
        align-items: center;
        gap: 5px;
      }
      #badge.live { background: #dcfce7; color: #16a34a; }
      #status-dot {
        width: 6px;
        height: 6px;
        background: currentColor;
        border-radius: 50%;
        transition: transform 0.1s, background-color 0.2s;
      }
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
      #error-bar {
        display: none;
        padding: 10px 16px;
        background: #fee2e2;
        color: #dc2626;
        font-size: 13px;
        line-height: 1.4;
        text-align: center;
        border-bottom: 1px solid #fca5a5;
        word-wrap: break-word;
        white-space: normal;
      }
      #close-btn {
        cursor: pointer;
        font-size: 20px;
        color: #94a3b8;
        line-height: 1;
        transition: color 0.2s;
        padding: 4px;
        margin-right: -4px;
      }
      #close-btn:hover {
        color: #475569;
      }
    </style>
    <div id="panel">
      <div id="header">
        <span id="title">MeetScribe</span>
        <div style="display: flex; align-items: center; gap: 8px;">
          <div id="badge"><div id="status-dot"></div><span>Idle</span></div>
          <div id="close-btn" title="Hide Sidebar">&times;</div>
        </div>
      </div>
      <div id="error-bar"></div>
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
  shadowRoot.getElementById('close-btn').onclick = () => {
    shadowHost.style.display = 'none';
  };
}

// ── Recording controls ────────────────────────────────────────────────────────
function startRecording() {
  showError('Please click the MeetScribe icon in the toolbar (top right) to start. This is required for security.');
}

function stopRecording() {
  chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (res) => {
    if (res?.ok) {
        setRecordingState(false);
        hideError();
    }
  });
}

function setRecordingState(recording) {
  isRecording = recording;
  if (!shadowHost) injectSidebar();
  
  // Show sidebar if a recording starts
  if (recording) {
    shadowHost.style.display = 'block';
  }

  if (!shadowRoot) return;
  
  const badge    = shadowRoot.getElementById('badge');
  const dot      = shadowRoot.getElementById('status-dot');
  const btnStart = shadowRoot.getElementById('btn-start');
  const btnStop  = shadowRoot.getElementById('btn-stop');
  
  if (!badge || !btnStart || !btnStop) return;

  if (recording) {
    badge.classList.add('live');
    badge.querySelector('span').textContent = 'Live';
    btnStart.style.display = 'none';
    btnStop.style.display = 'block';
    hideError(); // Clear any previous errors on success
    clearPlaceholder();
  } else {
    badge.classList.remove('live');
    badge.querySelector('span').textContent = 'Idle';
    btnStart.style.display = 'block';
    btnStop.style.display = 'none';
    if (dot) dot.style.transform = 'scale(1)';
    hideError(); // Ensure errors are cleared when stopped
  }
}

// ── Error display ─────────────────────────────────────────────────────────────
function showError(message) {
  if (!shadowRoot) return;
  const bar = shadowRoot.getElementById('error-bar');
  if (bar) {
    bar.textContent = message;
    bar.style.display = 'block';
  }
}

function hideError() {
  if (!shadowRoot) return;
  const bar = shadowRoot.getElementById('error-bar');
  if (bar) {
    bar.style.display = 'none';
  }
}

// ── Transcript rendering (XSS-safe) ──────────────────────────────────────────
let placeholderCleared = false;

function clearPlaceholder() {
  if (placeholderCleared || !shadowRoot) return;
  const box = shadowRoot.getElementById('transcript-box');
  if (box) {
    box.innerHTML = '';
    placeholderCleared = true;
  }
}

function updateAudioLevel(level) {
  const dot = shadowRoot.getElementById('status-dot');
  if (!dot || !isRecording) return;
  
  // Normalized scale between 1 and 2.5
  const scale = 1 + (Math.min(level * 10, 1.5));
  dot.style.transform = `scale(${scale})`;
  
  // Change color to bright green if strong signal
  if (level > 0.01) {
    dot.style.backgroundColor = '#22c55e';
  } else {
    dot.style.backgroundColor = 'currentColor';
  }
}

function updateAudioLevel(level) {
  const dot = shadowRoot.getElementById('status-dot');
  if (!dot || !isRecording) return;
  
  // Normalized scale between 1 and 2.5
  const scale = 1 + (Math.min(level * 20, 1.5));
  dot.style.transform = `scale(${scale})`;
  
  // Change color to bright green if signal detected
  if (level > 0.005) {
    dot.style.backgroundColor = '#22c55e';
  } else {
    dot.style.backgroundColor = 'currentColor';
  }
}

function appendChunk(chunk) {
  if (!shadowRoot) return;
  clearPlaceholder();
  const box = shadowRoot.getElementById('transcript-box');
  if (!box) return;
  
  const div = document.createElement('div');
  div.className = 'chunk';

  const speakerDiv = document.createElement('div');
  speakerDiv.className = 'speaker';
  speakerDiv.textContent = `Speaker ${chunk.speaker ?? '?'}`;

  const textDiv = document.createElement('div');
  textDiv.className = 'text';
  textDiv.textContent = chunk.text;

  div.appendChild(speakerDiv);
  div.appendChild(textDiv);
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function copyTranscript() {
  const box = shadowRoot.getElementById('transcript-box');
  navigator.clipboard.writeText(box.innerText).then(() => {
    const btn = shadowRoot.getElementById('btn-copy');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  });
}

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'REQUEST_MICROPHONE': {
      // Request microphone from page context (where permissions are already granted)
      console.log('[MeetScribe] Content script received REQUEST_MICROPHONE');
      requestMicrophoneAndStream(msg.tabId)
        .then(() => {
          console.log('[MeetScribe] Microphone streaming started');
          sendResponse({ success: true });
        })
        .catch(err => {
          console.error('[MeetScribe] Microphone request failed:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true; // async
    }
    
    case 'RECORDING_STARTED': 
      setRecordingState(true); 
      hideError(); 
      break;
    case 'CAPTURE_PROGRESS': 
      if (msg.message) console.log('[MeetScribe]', msg.message);
      if (msg.audioLevel !== undefined) updateAudioLevel(msg.audioLevel);
      break;
    case 'RECORDING_STOPPED': 
      setRecordingState(false); 
      hideError(); 
      break;
    case 'TRANSCRIPT_CHUNK':  appendChunk(msg.chunk); break;
    case 'CAPTURE_ERROR':     showError(msg.error); break;
    case 'CAPTURE_PROGRESS':  showError(msg.message); break; // Use error bar for progress too
  }
});

console.log('[MeetScribe] Content script loaded');

// ── Microphone capture from page context ──────────────────────────────────────
let currentStream = null;
let currentWs = null;

async function requestMicrophoneAndStream(tabId) {
  console.log('[MeetScribe] Requesting microphone from page context...');
  
  try {
    // Request microphone - since we're on meet.google.com, permissions are already granted
    const stream = await navigator.mediaDevices.getUserMedia({ 
      audio: true, 
      video: false 
    });
    
    console.log('[MeetScribe] SUCCESS! Got microphone stream from page context');
    console.log('[MeetScribe] Audio tracks:', stream.getAudioTracks().length);
    currentStream = stream;
    
    // Start streaming to backend
    const meetingId = `meeting_${tabId}_${Date.now()}`;
    console.log('[MeetScribe] Connecting to backend WebSocket:', `ws://localhost:8000/ws/transcribe?meetingId=${meetingId}`);
    
    currentWs = new WebSocket(`ws://localhost:8000/ws/transcribe?meetingId=${meetingId}`);
    
    currentWs.onopen = () => {
      console.log('[MeetScribe] WebSocket connected');
      showMessage('🎤 Recording started...');
      setRecordingState(true);
      
      // Setup audio processing
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      console.log('[MeetScribe] AudioContext sample rate:', audioContext.sampleRate);
      
      const source = audioContext.createMediaStreamSource(currentStream);
      
      // Use ScriptProcessor but suppress the deprecation warning by using it anyway
      // (AudioWorkletNode would require a worker file, which is more complex)
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      
      source.connect(processor);
      processor.connect(audioContext.destination);
      
      // Buffer for resampling (48000Hz -> 16000Hz)
      const resampleRatio = audioContext.sampleRate / 16000;
      const resampleBuffer = [];
      let chunkCount = 0;
      let maxAmplitude = 0;
      let totalAudioFrames = 0;
      let silenceFrames = 0;
      
      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        totalAudioFrames += inputData.length;
        
        // Detect amplitude and silence
        for (let i = 0; i < inputData.length; i++) {
          const sample = Math.abs(inputData[i]);
          maxAmplitude = Math.max(maxAmplitude, sample);
          if (sample < 0.01) silenceFrames++; // Threshold for silence
        }
        
        // Add to resample buffer
        for (let i = 0; i < inputData.length; i++) {
          resampleBuffer.push(Math.max(-1, Math.min(1, inputData[i])));
        }
        
        // Process resampled chunks
        const targetFrameSize = Math.floor(4096 / resampleRatio);
        
        while (resampleBuffer.length >= targetFrameSize) {
          const resampledData = [];
          for (let i = 0; i < targetFrameSize; i++) {
            const srcIdx = Math.floor(i * resampleRatio);
            if (srcIdx < resampleBuffer.length) {
              resampledData.push(resampleBuffer[srcIdx]);
            }
          }
          
          resampleBuffer.splice(0, Math.floor(targetFrameSize * resampleRatio));
          
          // Convert to Int16
          const int16Buffer = new Int16Array(resampledData.length);
          let maxInt16 = 0;
          let minInt16 = 0;
          let zeroCount = 0;
          
          for (let i = 0; i < resampledData.length; i++) {
            const s = Math.max(-1, Math.min(1, resampledData[i]));
            int16Buffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            maxInt16 = Math.max(maxInt16, int16Buffer[i]);
            minInt16 = Math.min(minInt16, int16Buffer[i]);
            if (int16Buffer[i] === 0) zeroCount++;
          }
          
          if (currentWs.readyState === WebSocket.OPEN) {
            currentWs.send(int16Buffer.buffer);
            chunkCount++;
            
            if (chunkCount <= 3 || chunkCount % 50 === 0) {
              // Log detailed chunk analysis
              const zeroPercent = Math.round((zeroCount / resampledData.length) * 100);
              console.log(
                `[MeetScribe] Chunk #${chunkCount}: ` +
                `Int16 range [${minInt16}..${maxInt16}] | ` +
                `Zeros: ${zeroPercent}% | ` +
                `Size: ${resampledData.length} samples`
              );
            }
            
            if (chunkCount % 10 === 0) {
              const silencePercent = Math.round((silenceFrames / totalAudioFrames) * 100);
              console.log(
                `[MeetScribe] Amplitude: ${maxAmplitude.toFixed(4)}, ` +
                `silence: ${silencePercent}%, total frames: ${totalAudioFrames}`
              );
              silenceFrames = 0;
              totalAudioFrames = 0;
              maxAmplitude = 0;
            }
          }
        }
      };
    };
    
    currentWs.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('[MeetScribe] Transcription received:', data.text);
      appendChunk(data);
    };
    
    currentWs.onerror = (e) => {
      console.error('[MeetScribe] WebSocket error:', e);
      showError('Connection error');
    };
    
    currentWs.onclose = () => {
      console.log('[MeetScribe] WebSocket closed');
      setRecordingState(false);
    };
    
  } catch (err) {
    console.error('[MeetScribe] Microphone request failed:', err);
    console.error('[MeetScribe] Error name:', err.name);
    console.error('[MeetScribe] Error message:', err.message);
    showError(`Microphone error: ${err.message}`);
    setRecordingState(false);
    throw err;
  }
}

function showMessage(msg) {
  console.log('[MeetScribe] MESSAGE:', msg);
}

// ── Init ──────────────────────────────────────────────────────────────────────
function waitForMeeting() {
  // More reliable detection: Look for the 'Leave call' button or common meeting containers
  const meetingSelectors = [
    'c-meeting-ui',
    '[data-meeting-code]',
    '[data-unresolved-meeting-id]',
    'button[aria-label*="Leave"]',
    'button[data-is-muted]',
    '[data-testid="meeting-view"]',
    '[data-tid="calling-screen"]',
    '.ts-calling-screen'
  ];

  const isMeetingPresent = () => meetingSelectors.some(s => document.querySelector(s));

  if (isMeetingPresent()) {
    console.log('[MeetScribe] Meeting detected immediately');
    injectSidebar();
    return;
  }

  const observer = new MutationObserver(() => {
    if (isMeetingPresent()) {
      console.log('[MeetScribe] Meeting detected via mutation');
      observer.disconnect();
      injectSidebar();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  
  // Also try after a fixed delay just in case
  setTimeout(() => {
    if (!shadowHost && isMeetingPresent()) {
        console.log('[MeetScribe] Meeting detected via fallback timer');
        observer.disconnect();
        injectSidebar();
    }
  }, 3000);
}

waitForMeeting();
