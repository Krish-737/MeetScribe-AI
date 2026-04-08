document.addEventListener('DOMContentLoaded', async () => {
    const startBtn = document.getElementById('start-btn');
    const stopBtn = document.getElementById('stop-btn');
    const status = document.getElementById('status');

    // Keep popup window alive during operations
    let popupActive = false;
    
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!startBtn || !stopBtn) return;

    let currentStream = null;
    let currentWs = null;

    startBtn.addEventListener('click', async () => {
        if (!activeTab) {
            status.textContent = 'Error: Tab not found';
            return;
        }

        if (!activeTab.url.includes('meet.google.com') && 
            !activeTab.url.includes('zoom.us') && 
            !activeTab.url.includes('teams.microsoft.com')) {
            status.textContent = 'Error: Not on Meet, Zoom, or Teams';
            return;
        }

        popupActive = true;
        console.log('[MeetScribe Popup] Start button clicked');
        console.log('[MeetScribe Popup] Active tab:', activeTab.id, activeTab.url);
        status.textContent = 'Starting on page...';
        
        try {
            // Request microphone from content script running on the page
            // (page context has permissions already granted)
            console.log('[MeetScribe Popup] Sending REQUEST_MICROPHONE to content script');
            
            chrome.tabs.sendMessage(
                activeTab.id,
                { type: 'REQUEST_MICROPHONE', tabId: activeTab.id },
                (response) => {
                    console.log('[MeetScribe Popup] Content script response:', response);
                    if (response && response.success) {
                        status.textContent = 'Transcribing on page...';
                        // Close popup after successful start
                        setTimeout(() => window.close(), 1000);
                    } else {
                        status.textContent = `Error: ${response?.error || 'Unknown'}`;
                        popupActive = false;
                    }
                }
            );
            
        } catch (err) {
            console.error('[MeetScribe Popup] Error:', err);
            status.textContent = `Error: ${err.message}`;
            popupActive = false;
        }
    });

    stopBtn.addEventListener('click', () => {
        console.log('[MeetScribe Popup] Stop button clicked');
        
        // Tell service worker to stop recording
        chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (response) => {
            console.log('[MeetScribe Popup] Stop response:', response);
            status.textContent = 'Stopped';
            popupActive = false;
        });
        
        // Cleanup local references
        if (currentWs) {
            currentWs.close();
            currentWs = null;
        }
        if (currentStream) {
            currentStream.getTracks().forEach(t => t.stop());
            currentStream = null;
        }
    });

    const launchAppBtn = document.getElementById('launch-app-mode');
    if (launchAppBtn) {
        launchAppBtn.addEventListener('click', () => {
            chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
        });
    }
});
