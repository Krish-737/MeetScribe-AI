// ── Config ────────────────────────────────────────────────────────────────────
const BACKEND_WS = 'ws://localhost:8000/ws/transcribe';
const SAMPLE_RATE = 16000;

function logToUI(msg) {
  console.log(`[MeetScribe] ${msg}`);
  chrome.runtime.sendMessage({ type: 'CAPTURE_PROGRESS', message: msg });
}
const CHUNK_MS = 250;      // Send every 250ms

// ── State ─────────────────────────────────────────────────────────────────────
let audioContext = null;
let scriptProcessor = null;
let ws = null;
let meetingId = null;
let lastLevelLog = 0;
let isCapturing = false;

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  console.log(`[MeetScribe] -> OFFSCREEN RECEIVED: ${msg.type}`);
  switch (msg.type) {
    case 'START_MIC_RECORDING':
      startMicrophoneCapture(msg.meetingId, msg.tabId);
      break;
    case 'START_CAPTURE':
      startCapture(msg.streamId, msg.tabId);
      break;
    case 'STOP_CAPTURE':
      stopCapture();
      break;
    case 'HEARTBEAT':
      // Just receiving this keeps the offscreen doc alive
      break;
    case 'USE_STREAM_ID':
      // Popup got streamId and is sending it directly
      console.log('[MeetScribe] Received USE_STREAM_ID from popup');
      startCapture(msg.streamId, msg.tabId);
      break;
  }
});

console.log('[MeetScribe] Offscreen document ready, waiting for streamId from popup...');

// ── Main capture logic ────────────────────────────────────────────────────────
async function startCapture(streamId, tabId) {
  if (isCapturing) {
    console.log('[MeetScribe] Capture already in progress, ignoring duplicate START_CAPTURE.');
    return;
  }
  isCapturing = true;
  const captureStartTime = Date.now();
  console.log('[MeetScribe] ===== STARTING CAPTURE =====');
  console.log('[MeetScribe] Capture start time:', captureStartTime);
  console.log('[MeetScribe] StreamId:', streamId);
  console.log('[MeetScribe] StreamId type:', typeof streamId);
  console.log('[MeetScribe] StreamId length:', streamId?.length);
  console.log('[MeetScribe] TabId:', tabId);

  // Modern Audio-Only Constraint
  const constraints = {
    audio: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: streamId
    },
    video: false 
  };
  
  console.log('[MeetScribe] Constraints object:', constraints);
  console.log('[MeetScribe] About to call getUserMedia...');

  try {
    const getUserMediaTime = Date.now();
    console.log('[MeetScribe] getUserMedia call time:', getUserMediaTime, '(delay since startCapture:', getUserMediaTime - captureStartTime, 'ms)');
    console.log('[MeetScribe] About to call navigator.mediaDevices.getUserMedia()...');
    console.log('[MeetScribe] navigator.mediaDevices exists?', !!navigator.mediaDevices);
    console.log('[MeetScribe] getUserMedia method exists?', !!navigator.mediaDevices?.getUserMedia);
    
    const fullStream = await navigator.mediaDevices.getUserMedia(constraints);
    console.log('[MeetScribe] ===== DESKTOP CAPTURE SUCCESS =====');
    console.log('[MeetScribe] Got audio tracks:', fullStream.getAudioTracks().length);

    logToUI('Waking up audio engine...');

    console.log('[MeetScribe] Media stream received. Extracting audio...');
    
    // We only want the audio track
    const audioTracks = fullStream.getAudioTracks();
    if (audioTracks.length === 0) {
      console.error('[MeetScribe] No audio track found! Did you check the "Share tab audio" box?');
      throw new Error('No audio track found. Please ensure "Share tab audio" is checked in the selection dialog.');
    }

    const tabStream = new MediaStream([audioTracks[0]]);
    console.log('[MeetScribe] Audio track successfully isolated. Capture SUCCESS!');

    logToUI('Tab audio captured. Attempting microphone...');
    // 2. Microphone stream (Optional - separate from tab capture)
    let micStream = null;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('[MeetScribe] Microphone captured successfully.');
    } catch (micErr) {
      console.warn('[MeetScribe] Microphone capture failed (will continue with tab only):', micErr.message);
    }

    // 3. Setup AudioContext and Routing
    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    const destination = audioContext.createMediaStreamDestination();
    const mainGain = audioContext.createGain();
    mainGain.connect(destination);

    // Tab audio source (Primary)
    const tabSource = audioContext.createMediaStreamSource(tabStream);
    tabSource.connect(mainGain);

    console.log('[MeetScribe] Tab audio source connected. Attempting mic wake-up...');
    
    // MIC DECOUPLING: Do not await micStream - let it fail silently if denied
    navigator.mediaDevices.getUserMedia({ audio: true }).then(micStream => {
        const micSource = audioContext.createMediaStreamSource(micStream);
        micSource.connect(mainGain);
        console.log('[MeetScribe] Microphone mixed in.');
    }).catch(err => {
        console.warn('[MeetScribe] Continuing without mic:', err.message);
    });

    await audioContext.resume();

    // Success Signal
    logToUI('Capture Succeeded! Connecting to Deepgram via backend...');
    chrome.runtime.sendMessage({ type: 'CAPTURE_SUCCESS', tabId });

    // 4. Connect to backend WebSocket
    logToUI('Audio engine ready. Connecting to server...');
    meetingId = `meeting_${tabId || 'unknown'}_${Date.now()}`;
    const url = `${BACKEND_WS}?meetingId=${meetingId}`;
    console.log('[MeetScribe] Opening WebSocket connection to:', url);
    ws = new WebSocket(url);

    ws.onopen = () => {
      logToUI('Connected to server! Starting raw PCM streaming...');
      ws.send(JSON.stringify({ type: 'hello', meetingId }));
      startRawStreaming(destination.stream);
    };

    ws.onerror = (e) => {
      console.error('[MeetScribe] WebSocket error', e);
      chrome.runtime.sendMessage({
        type: 'CAPTURE_ERROR',
        error: 'Cannot connect to backend. Is the server running on localhost:8000?'
      });
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('[MeetScribe] Received text from server:', data.text);
      chrome.runtime.sendMessage({ type: 'TRANSCRIPT_CHUNK', chunk: data });
    };

    ws.onclose = () => {
      console.log('[MeetScribe] WebSocket closed');
      chrome.runtime.sendMessage({ type: 'CAPTURE_ERROR', error: 'Server connection lost. Please restart recording.' });
    };

  } catch (err) {
    isCapturing = false;
    console.error('[MeetScribe] ===== CAPTURE FAILED =====');
    console.error('[MeetScribe] Error name:', err.name);
    console.error('[MeetScribe] Error message:', err.message);
    console.error('[MeetScribe] Full error:', err);
    
    let errorMsg = err.message;
    if (err.name === 'NotAllowedError') {
      if (err.message.includes('dismissed')) {
        errorMsg = 'Permission dialog was dismissed. Please click "Share" in the dialog, not "Cancel".';
      } else if (err.message.includes('Permission denied')) {
        errorMsg = 'Permission denied. Make sure "Share tab audio" is enabled in the dialog.';
      }
    }
    
    console.error('[MeetScribe] Sending error to backend:', errorMsg);
    chrome.runtime.sendMessage({ type: 'CAPTURE_ERROR', error: errorMsg });
    if (ws) ws.close();
  }
}

function startRawStreaming(stream) {
  try {
    const source = audioContext.createMediaStreamSource(stream);
    scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);

    source.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);

    scriptProcessor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      
      // 1. Calculate audio level (RMS)
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) {
        sum += inputData[i] * inputData[i];
      }
      const rms = Math.sqrt(sum / inputData.length);
      
      // Send level to sidebar for visual pulse
      const now = Date.now();
      if (now - lastLevelLog > 100) { // Update indicator every 100ms
        chrome.runtime.sendMessage({ type: 'CAPTURE_PROGRESS', audioLevel: rms });
        lastLevelLog = now;
      }

      // 2. Convert Float32 to Int16
      const int16Buffer = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        int16Buffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      // 3. Send raw bytes
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(int16Buffer.buffer);
      }
    };

    console.log('[MeetScribe] Raw streaming started');
  } catch (err) {
    console.error('[MeetScribe] Failed to start raw streaming:', err);
    chrome.runtime.sendMessage({ type: 'CAPTURE_ERROR', error: 'Raw streaming fail: ' + err.message });
    ws?.close();
  }
}

function stopCapture() {
  if (scriptProcessor) {
    scriptProcessor.onaudioprocess = null;
    scriptProcessor.disconnect();
  }
  ws?.close();
  audioContext?.close();

  scriptProcessor = null;
  ws = null;
  audioContext = null;
  meetingId = null;

  console.log('[MeetScribe] Recording stopped');
  isCapturing = false;
}

// ── Microphone Capture (new approach) ─────────────────────────────────────────
async function startMicrophoneCapture(meetingIdParam, tabId) {
  if (isCapturing) {
    console.log('[MeetScribe] Capture already in progress');
    return;
  }
  isCapturing = true;
  meetingId = meetingIdParam;
  
  console.log('[MeetScribe] ===== STARTING MICROPHONE CAPTURE =====');
  console.log('[MeetScribe] Meeting ID:', meetingId);
  console.log('[MeetScribe] Tab ID:', tabId);

  try {
    // Request microphone access
    console.log('[MeetScribe] Requesting microphone access...');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    console.log('[MeetScribe] SUCCESS! Got microphone stream');
    console.log('[MeetScribe] Audio tracks:', stream.getAudioTracks().length);

    // Connect to backend WebSocket
    console.log('[MeetScribe] Connecting to backend WebSocket...');
    ws = new WebSocket(`ws://localhost:8000/ws/transcribe?meetingId=${meetingId}`);

    ws.onopen = () => {
      console.log('[MeetScribe] WebSocket connected!');

      // Create audio context and processor
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      console.log('[MeetScribe] AudioContext sample rate:', audioContext.sampleRate);

      const source = audioContext.createMediaStreamSource(stream);
      scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);

      source.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);

      // Buffer for resampling (48000Hz -> 16000Hz)
      const resampleRatio = audioContext.sampleRate / 16000;
      const resampleBuffer = [];
      let chunkCount = 0;
      let maxAmplitude = 0;

      scriptProcessor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);

        // Track amplitude
        for (let i = 0; i < inputData.length; i++) {
          maxAmplitude = Math.max(maxAmplitude, Math.abs(inputData[i]));
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
          for (let i = 0; i < resampledData.length; i++) {
            const s = resampledData[i];
            int16Buffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            maxInt16 = Math.max(maxInt16, Math.abs(int16Buffer[i]));
          }

          if (ws.readyState === WebSocket.OPEN) {
            ws.send(int16Buffer.buffer);
            chunkCount++;

            if (chunkCount % 10 === 0) {
              console.log(
                `[MeetScribe] Chunk #${chunkCount}: ${resampledData.length} samples, ` +
                `Max amplitude: ${maxAmplitude.toFixed(4)}, Max Int16: ${maxInt16}`
              );
              maxAmplitude = 0;
            }
          }
        }
      };

      console.log('[MeetScribe] Microphone streaming started');
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('[MeetScribe] Transcription received:', data.text);
      
      // Forward to service worker
      chrome.runtime.sendMessage({
        type: 'TRANSCRIPT_CHUNK',
        chunk: data,
        tabId: tabId
      }).catch(err => console.error('[MeetScribe] Failed to send transcript:', err));
    };

    ws.onerror = (e) => {
      console.error('[MeetScribe] WebSocket error:', e);
    };

    ws.onclose = () => {
      console.log('[MeetScribe] WebSocket closed');
    };

  } catch (err) {
    console.error('[MeetScribe] Microphone capture failed:', err);
    console.error('[MeetScribe] Error name:', err.name);
    console.error('[MeetScribe] Error message:', err.message);
    isCapturing = false;
    
    // Notify service worker of the error
    chrome.runtime.sendMessage({
      type: 'CAPTURE_ERROR',
      error: `Microphone capture failed: ${err.message}`
    }).catch(() => {});
  }
}
