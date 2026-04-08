let ws = null;
let audioContext = null;
let scriptProcessor = null;
let isRecording = false;

// Handle messages from the parent tab
window.addEventListener('message', async (event) => {
  if (event.data.type === 'START_CAPTURE') {
    const { streamId } = event.data;
    startTranscription(streamId);
  }
});

async function startTranscription(streamId) {
  if (isRecording) return;
  isRecording = true;

  updateUIState(true);
  
  try {
    const desktopConstraints = {
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: streamId
        }
      },
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: streamId
        }
      }
    };

    // 1. Get Desktop Audio (The other participants)
    const desktopStream = await navigator.mediaDevices.getUserMedia(desktopConstraints);
    const desktopAudioTrack = desktopStream.getAudioTracks()[0];
    
    if (!desktopAudioTrack) {
      throw new Error('No desktop audio track found. Make sure to check "Share system audio".');
    }

    // 2. Get Microphone Audio (Your voice)
    const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }).catch(err => {
      console.warn('[MeetScribe PiP] Could not get microphone:', err);
      return null;
    });

    const micAudioTrack = micStream ? micStream.getAudioTracks()[0] : null;

    // Connect to backend
    const meetingId = `desktop_meeting_${Date.now()}`;
    ws = new WebSocket(`ws://localhost:8000/ws/transcribe?meetingId=${meetingId}`);

    ws.onopen = () => {
      setupAudioProcessing(new MediaStream([desktopAudioTrack]), micAudioTrack ? new MediaStream([micAudioTrack]) : null);
      console.log('[MeetScribe PiP] Dual-Channel Streaming started');
    };

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      appendChunk(data);
    };

    ws.onerror = (err) => console.error('[MeetScribe PiP] WS Error:', err);
    ws.onclose = () => updateUIState(false);

  } catch (err) {
    console.error('[MeetScribe PiP] Capture failed:', err);
    alert('Capture failed: ' + err.message);
    updateUIState(false);
  }
}

function setupAudioProcessing(desktopStream, micStream) {
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);

  // Connect Desktop Source
  const desktopSource = audioContext.createMediaStreamSource(desktopStream);
  desktopSource.connect(scriptProcessor);

  // Connect Microphone Source (Web Audio API mixes them automatically)
  if (micStream) {
    const micSource = audioContext.createMediaStreamSource(micStream);
    micSource.connect(scriptProcessor);
  }

  scriptProcessor.connect(audioContext.destination);

  const resampleRatio = audioContext.sampleRate / 16000;
  let resampleBuffer = [];

  scriptProcessor.onaudioprocess = (e) => {
    const inputData = e.inputBuffer.getChannelData(0);
    for (let i = 0; i < inputData.length; i++) {
        resampleBuffer.push(inputData[i]);
    }

    const targetFrameSize = Math.floor(4096 / resampleRatio);
    while (resampleBuffer.length >= targetFrameSize) {
      const resampledData = [];
      for (let i = 0; i < targetFrameSize; i++) {
        resampledData.push(resampleBuffer[Math.floor(i * resampleRatio)]);
      }
      resampleBuffer.splice(0, Math.floor(targetFrameSize * resampleRatio));

      const int16Buffer = new Int16Array(resampledData.length);
      for (let i = 0; i < resampledData.length; i++) {
        const s = Math.max(-1, Math.min(1, resampledData[i]));
        int16Buffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(int16Buffer.buffer);
      }
    }
  };
}

function updateUIState(recording) {
  const badge = document.getElementById('badge');
  const dot = document.getElementById('status-dot');
  if (recording) {
    badge.classList.add('live');
    badge.querySelector('span').textContent = 'Live';
    document.getElementById('transcript-box').innerHTML = '';
  } else {
    badge.classList.remove('live');
    badge.querySelector('span').textContent = 'Idle';
    isRecording = false;
  }
}

function appendChunk(chunk) {
  const box = document.getElementById('transcript-box');
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

document.getElementById('btn-copy').onclick = () => {
  const text = document.getElementById('transcript-box').innerText;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('btn-copy');
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy Transcript', 1500);
  });
};
