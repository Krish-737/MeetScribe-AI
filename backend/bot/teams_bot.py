import asyncio
import sys
import time
from playwright.async_api import async_playwright
from ..state import meeting_store

async def run(meeting_url: str, meeting_id: str):
    # Secondary check for Windows event loop policy
    if sys.platform == 'win32':
        import asyncio
        if not isinstance(asyncio.get_event_loop_policy(), asyncio.WindowsSelectorEventLoopPolicy):
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    async with async_playwright() as p:
        try:
            # Update status to joining
            if meeting_id in meeting_store:
                meeting_store[meeting_id]["status"] = "joining"

            # Launch browser with fake media to bypass permission popups
            browser = await p.chromium.launch(
                headless=True, 
                args=[
                    "--use-fake-ui-for-media-stream",
                    "--use-fake-device-for-media-stream",
                    "--disable-blink-features=AutomationControlled",
                    "--autoplay-policy=no-user-gesture-required",
                    "--disable-background-timer-throttling",
                    "--disable-backgrounding-occluded-windows",
                    "--disable-renderer-backgrounding"
                ]
            )
            
            context = await browser.new_context(
                viewport={"width": 1280, "height": 720},
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                bypass_csp=True
            )

            audio_injector_script = r"""
            console.log("[MeetScribe Injector] Payload initialized!");
            const meetingId = "__MEETING_ID__";
            let ws = window.meetScribeWs || null;
            if (!window.hookedStreams) window.hookedStreams = new Set();
            
            function initWebSocket() {
                if (window.meetScribeWs) return;
                window.meetScribeWs = new WebSocket(`ws://localhost:8000/ws/transcribe?meetingId=${meetingId}`);
                window.meetScribeWs.onopen = () => console.log("[MeetScribe Injector] Websocket connected!");
                window.meetScribeWs.onmessage = (e) => {
                    try {
                        const data = JSON.parse(e.data);
                        if (data.text) console.log(`[Transcript] ${data.text}`);
                    } catch (err) {}
                };
                ws = window.meetScribeWs;
            }

            function processStream(stream) {
                initWebSocket();
                if (window.hookedStreams.has(stream.id)) return;
                window.hookedStreams.add(stream.id);
                
                if (!window.activeAudioContext) {
                    window.activeAudioContext = new (window.AudioContext || window.webkitAudioContext)();
                    window.masterDestination = window.activeAudioContext.createMediaStreamDestination();
                    window.activeScriptProcessor = window.activeAudioContext.createScriptProcessor(4096, 1, 1);
                    const mixedSource = window.activeAudioContext.createMediaStreamSource(window.masterDestination.stream);
                    mixedSource.connect(window.activeScriptProcessor);
                    window.activeScriptProcessor.connect(window.activeAudioContext.destination);

                    const resampleRatio = window.activeAudioContext.sampleRate / 16000;
                    let resampleBuffer = [];

                    window.activeScriptProcessor.onaudioprocess = (e) => {
                        const inputData = e.inputBuffer.getChannelData(0);
                        for (let i = 0; i < inputData.length; i++) resampleBuffer.push(inputData[i]);
                        const targetFrameSize = Math.floor(4096 / resampleRatio);
                        while (resampleBuffer.length >= targetFrameSize) {
                            const resampledData = [];
                            for (let i = 0; i < targetFrameSize; i++) resampledData.push(resampleBuffer[Math.floor(i * resampleRatio)]);
                            resampleBuffer.splice(0, Math.floor(targetFrameSize * resampleRatio));
                            const int16Buffer = new Int16Array(resampledData.length);
                            for (let i = 0; i < resampledData.length; i++) {
                                const s = Math.max(-1, Math.min(1, resampledData[i]));
                                int16Buffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                            }
                            if (ws && ws.readyState === WebSocket.OPEN) ws.send(int16Buffer.buffer);
                        }
                    };
                }
                const source = window.activeAudioContext.createMediaStreamSource(stream);
                source.connect(window.masterDestination);
            }

            const originalRTCPeerConnection = window.RTCPeerConnection;
            window.RTCPeerConnection = function(...args) {
                const pc = new originalRTCPeerConnection(...args);
                pc.addEventListener('track', (event) => {
                    if (event.track.kind === 'audio') {
                        const stream = new MediaStream([event.track]);
                        processStream(stream);
                    }
                });
                return pc;
            };
            window.RTCPeerConnection.prototype = originalRTCPeerConnection.prototype;
            """.replace("__MEETING_ID__", meeting_id)
            
            await context.add_init_script(audio_injector_script)
            page = await context.new_page()
            page.set_default_timeout(90000)        # Global action timeout for slow hardware
            page.set_default_navigation_timeout(90000) # Global loading timeout
            page.on("console", lambda msg: print(f"[Browser]: {msg.text}"))
            await page.route("**/*", lambda route: route.abort() if route.request.url.startswith("msteams") else route.continue_())

            print(f"[*] [Bot v1.1.1] Navigating to {meeting_url}")
            await page.goto(meeting_url)

            # Handle "Continue on this browser"
            try:
                await page.wait_for_selector('button:has-text("Continue on this browser")', timeout=60000)
                await page.evaluate('''() => {
                    const btn = Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('Continue on this browser'));
                    if (btn) btn.click();
                }''')
            except: pass

            await page.wait_for_load_state("networkidle")

            # Enter Name
            name_input = page.get_by_placeholder("Type your name").first
            await name_input.wait_for(state="visible", timeout=60000)
            await name_input.fill("MeetScribe Associate")

            # Prove original method for Mute/Join
            print("[*] Reverting to original stable mute/join method...")
            # Check for Termination Signal (from Dashboard)
            if meeting_store.get(meeting_id, {}).get("status") == "terminating":
                print(f"[*] Termination signal received for {meeting_id}. Leaving meeting...")
                return

            await asyncio.sleep(2)
            await page.evaluate('''() => {
                // 1. Mute Mic
                const micBtn = document.querySelector('[data-tid="toggle-mute"], [aria-label="Mute microphone"], [title="Mute microphone"]');
                if (micBtn) micBtn.click();

                // 2. Kill Camera
                const camBtn = document.querySelector('[data-tid="toggle-video"], [aria-label="Turn camera off"], [title="Turn camera off"]');
                if (camBtn) camBtn.click();

                // 3. Join
                setTimeout(() => {
                    const join = Array.from(document.querySelectorAll('button')).find(el => 
                        el.textContent.includes('Join now') || el.textContent.includes('Join')
                    );
                    if (join) join.click();
                }, 1000);
            }''')

            # Update status to active
            if meeting_id in meeting_store:
                meeting_store[meeting_id]["status"] = "active"

            # Monitor for Termination or 1-hour timeout
            print("[+] Bot joined. Monitoring session...")
            start_time = time.time()
            while time.time() - start_time < 3600:
                # Check for Termination Signal (from Dashboard)
                m_info = meeting_store.get(meeting_id, {})
                if m_info.get("status") == "terminating":
                    print(f"[*] Termination signal received for {meeting_id}. Leaving meeting...")
                    break
                
                # Check if browser is still alive
                if not page or page.is_closed():
                    break

                await asyncio.sleep(3)
            
            if meeting_id in meeting_store:
                meeting_store[meeting_id]["status"] = "completed"

        except Exception as e:
            print(f"[-] Bot encountered error: {e}")
            if meeting_id in meeting_store:
                meeting_store[meeting_id]["status"] = "failed"
        finally:
            await browser.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(1)
    url = sys.argv[1].strip()
    meeting_id = f"cli_bot_{int(time.time()*1000)}"
    asyncio.run(run(url, meeting_id))
