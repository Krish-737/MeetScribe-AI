const statusEl   = document.getElementById('status');
const controlsEl = document.getElementById('controls');
const notMeetEl  = document.getElementById('not-meeting');
const btnToggle  = document.getElementById('btn-toggle');

const MEETING_PATTERNS = [/meet\.google\.com/, /zoom\.us\/wc\//];

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isMeeting = MEETING_PATTERNS.some(p => p.test(tab?.url || ''));

  if (!isMeeting) {
    statusEl.style.display = 'none';
    notMeetEl.style.display = 'block';
    return;
  }

  controlsEl.style.display = 'block';

  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
    setUI(res?.recording, tab.id);
  });
}

function setUI(recording, tabId) {
  if (recording) {
    statusEl.textContent = 'Recording live';
    statusEl.className = 'live';
    btnToggle.textContent = 'Stop recording';
    btnToggle.onclick = () => {
      chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, () => window.close());
    };
  } else {
    statusEl.textContent = 'Not recording';
    statusEl.className = '';
    btnToggle.textContent = 'Start recording';
    btnToggle.onclick = () => {
      chrome.runtime.sendMessage({ type: 'START_RECORDING', tabId }, () => window.close());
    };
  }
}

init();
