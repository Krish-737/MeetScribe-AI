const launchBtn = document.getElementById('launch-btn');

launchBtn.addEventListener('click', async () => {
  if (!('documentPictureInPicture' in window)) {
    alert('Document Picture-in-Picture is not supported in this browser. Please use the latest version of Chrome.');
    return;
  }

  try {
    // 1. Open the Picture-in-Picture window
    const pipWindow = await window.documentPictureInPicture.requestWindow({
      width: 320,
      height: 480,
    });

    // 2. Setup the PiP window content
    setupPipContent(pipWindow);

    // 3. Initiate Desktop Capture (from the dashboard tab context)
    // We need to request the streamId here and pass it to the PiP window
    chrome.desktopCapture.chooseDesktopMedia(['screen', 'audio'], (streamId) => {
      if (!streamId) {
        console.log('[MeetScribe] Capture cancelled');
        pipWindow.close();
        return;
      }
      
      // Initiate recording using the main tab's context
      startTranscription(streamId, pipWindow);
    });

  } catch (err) {
    console.error('[MeetScribe] Failed to open PiP window:', err);
  }
});

let activeWs = null;
let activeAudioContext = null;
let activeScriptProcessor = null; // Prevent Garbage Collection Halt Bug
let activeStreams = [];

function setupPipContent(pipWindow) {
  // Add styles
  const style = pipWindow.document.createElement('link');
  style.rel = 'stylesheet';
  style.href = chrome.runtime.getURL('dashboard/overlay.css');
  pipWindow.document.head.appendChild(style);

  // Add structure
  pipWindow.document.body.innerHTML = `
    <div id="panel">
      <div id="header">
        <span id="title">MeetScribe Floating</span>
        <div id="badge"><div id="status-dot"></div><span>Idle</span></div>
      </div>
      <div id="transcript-box">
        <div class="placeholder">
          Ready to transcribe. Select the Teams window to begin.
        </div>
      </div>
      <div id="footer">
        <button id="btn-copy">Copy Transcript</button>
      </div>
    </div>
  `;

  // Attach click listener for copy
  pipWindow.document.getElementById('btn-copy').onclick = () => {
    const text = pipWindow.document.getElementById('transcript-box').innerText;
    navigator.clipboard.writeText(text).then(() => {
      const btn = pipWindow.document.getElementById('btn-copy');
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy Transcript', 1500);
    });
  };

  // Handle window close
  pipWindow.addEventListener('pagehide', () => {
    console.log('[MeetScribe] Floating window closed');
    if (activeWs) activeWs.close();
    if (activeStreams) activeStreams.forEach(s => s.getTracks().forEach(t => t.stop()));
    if (activeAudioContext) activeAudioContext.close();
    activeScriptProcessor = null;
  });
}

// ── Audio Processing & UI Updates ──────────────────────────────────────────

async function startTranscription(streamId, pipWindow) {
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
          chromeMediaSourceId: streamId,
          maxWidth: 10,
          maxHeight: 10,
          maxFrameRate: 1
        }
      }
    };

    // 1. Get Desktop Audio in valid extension context
    const desktopStream = await navigator.mediaDevices.getUserMedia(desktopConstraints);
    const desktopAudioTrack = desktopStream.getAudioTracks()[0];
    
    if (!desktopAudioTrack) {
      throw new Error('No desktop audio track found. Make sure to check "Share system audio".');
    }

    // 2. Get Microphone
    const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }).catch(err => null);
    const micAudioTrack = micStream ? micStream.getAudioTracks()[0] : null;

    activeStreams = [desktopStream, micStream].filter(Boolean);

    // 3. Connect to Backend
    const meetingId = `desktop_meeting_${Date.now()}`;
    activeWs = new WebSocket(`ws://localhost:8000/ws/transcribe?meetingId=${meetingId}`);

    activeWs.onopen = () => {
      updateUIState(pipWindow, true);
      setupAudioProcessing(new MediaStream([desktopAudioTrack]), micAudioTrack ? new MediaStream([micAudioTrack]) : null, activeWs);
    };

    activeWs.onmessage = (e) => {
      const data = JSON.parse(e.data);
      appendChunk(pipWindow, data);
    };

    activeWs.onclose = () => updateUIState(pipWindow, false);

  } catch (err) {
    console.error('[MeetScribe] Capture failed:', err);
    alert('Capture failed: ' + err.message);
    updateUIState(pipWindow, false);
  }
}

function setupAudioProcessing(desktopStream, micStream, ws) {
  activeAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  activeScriptProcessor = activeAudioContext.createScriptProcessor(4096, 1, 1);

  const desktopSource = activeAudioContext.createMediaStreamSource(desktopStream);
  desktopSource.connect(activeScriptProcessor);

  if (micStream) {
    const micSource = activeAudioContext.createMediaStreamSource(micStream);
    micSource.connect(activeScriptProcessor);
  }

  activeScriptProcessor.connect(activeAudioContext.destination);

  const resampleRatio = activeAudioContext.sampleRate / 16000;
  let resampleBuffer = [];

  activeScriptProcessor.onaudioprocess = (e) => {
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

function updateUIState(pipWindow, recording) {
  const badge = pipWindow.document.getElementById('badge');
  if (recording) {
    badge.classList.add('live');
    badge.querySelector('span').textContent = 'Live';
    pipWindow.document.getElementById('transcript-box').innerHTML = '';
  } else {
    badge.classList.remove('live');
    badge.querySelector('span').textContent = 'Idle';
  }
}

function appendChunk(pipWindow, chunk) {
  const box = pipWindow.document.getElementById('transcript-box');
  const div = pipWindow.document.createElement('div');
  div.className = 'chunk';
  
  const speakerDiv = pipWindow.document.createElement('div');
  speakerDiv.className = 'speaker';
  speakerDiv.textContent = `Speaker ${chunk.speaker ?? '?'}`;

  const textDiv = pipWindow.document.createElement('div');
  textDiv.className = 'text';
  textDiv.textContent = chunk.text;

  div.appendChild(speakerDiv);
  div.appendChild(textDiv);
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}
