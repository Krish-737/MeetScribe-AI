document.getElementById('enable-btn').addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        document.getElementById('success-msg').style.display = 'block';
        document.getElementById('enable-btn').style.display = 'none';
        console.log('[MeetScribe] Microphone permission granted.');
    } catch (err) {
        console.error('[MeetScribe] Microphone permission denied:', err);
    }
});
