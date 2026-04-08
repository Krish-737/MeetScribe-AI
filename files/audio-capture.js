// ── Config ────────────────────────────────────────────────────────────────────
const BACKEND_WS = 'ws://localhost:8000/ws/transcribe';
const SAMPLE_RATE = 16000; // Deepgram optimal
const CHUNK_MS = 250;      // Send every 250ms

// ── State ─────────────────────────────────────────────────────────────────────
let audioContext = null;
let mediaRecorder = null;
let ws = null;
let meetingId = null;

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case 'START_CAPTURE':
      startCapture(msg.streamId, msg.tabId);
      break;
    case 'STOP_CAPTURE':
      stopCapture();
      break;
    case 'HEARTBEAT':
      // Just receiving this keeps the offscreen doc alive
      break;
  }
});

// ── Main capture logic ────────────────────────────────────────────────────────
async function startCapture(streamId, tabId) {
  try {
    // 1. Tab audio stream (other participants)
    const tabStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });

    // 2. Microphone stream (local user)
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: SAMPLE_RATE
      },
      video: false
    });

    // 3. Merge both streams using AudioContext
    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });

    const tabSource = audioContext.createMediaStreamSource(tabStream);
    const micSource = audioContext.createMediaStreamSource(micStream);
    const destination = audioContext.createMediaStreamDestination();

    // Gain nodes so we can control levels independently
    const tabGain = audioContext.createGain();
    const micGain = audioContext.createGain();
    tabGain.gain.value = 1.0;
    micGain.gain.value = 1.0;

    tabSource.connect(tabGain).connect(destination);
    micSource.connect(micGain).connect(destination);

    // 4. Connect to backend WebSocket
    meetingId = `meeting_${tabId}_${Date.now()}`;
    ws = new WebSocket(`${BACKEND_WS}?meetingId=${meetingId}`);

    ws.onopen = () => {
      console.log('[MeetScribe] WebSocket connected');
      startMediaRecorder(destination.stream);
    };

    ws.onerror = (e) => console.error('[MeetScribe] WebSocket error', e);

    ws.onmessage = (event) => {
      // Deepgram transcript chunk forwarded from backend
      const data = JSON.parse(event.data);
      chrome.runtime.sendMessage({ type: 'TRANSCRIPT_CHUNK', chunk: data });
    };

    ws.onclose = () => console.log('[MeetScribe] WebSocket closed');

  } catch (err) {
    console.error('[MeetScribe] Capture error:', err);
    chrome.runtime.sendMessage({ type: 'CAPTURE_ERROR', error: err.message });
  }
}

function startMediaRecorder(stream) {
  mediaRecorder = new MediaRecorder(stream, {
    mimeType: 'audio/webm;codecs=opus'
  });

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0 && ws?.readyState === WebSocket.OPEN) {
      ws.send(event.data);
    }
  };

  mediaRecorder.start(CHUNK_MS);
  console.log('[MeetScribe] Recording started');
}

function stopCapture() {
  mediaRecorder?.stop();
  ws?.close();
  audioContext?.close();

  mediaRecorder = null;
  ws = null;
  audioContext = null;
  meetingId = null;

  console.log('[MeetScribe] Recording stopped');
}
