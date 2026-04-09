import asyncio
import json
from deepgram import DeepgramClient, LiveOptions, LiveResultResponse, LiveTranscriptionEvents
from ..config import settings

async def stream_to_deepgram(audio_queue: asyncio.Queue, chunk_callback, status_callback=None, api_key: str | None = None):
    """
    Reads raw audio bytes from audio_queue and streams to Deepgram using the official SDK.
    """
    api_key = (api_key or settings.DEEPGRAM_API_KEY).strip()
    if not api_key:
        if status_callback: await status_callback("error", "Deepgram API key missing!")
        return

    try:
        # Use a wrapper to bridge the sync SDK callback to our async chunk_callback
        loop = asyncio.get_event_loop()

        def on_message(self, result, **kwargs):
            sentence = result.channel.alternatives[0].transcript
            if len(sentence) == 0:
                return
            
            is_final = result.is_final
            confidence = result.channel.alternatives[0].confidence
            words = result.channel.alternatives[0].words
            speaker = words[0].speaker if words else None

            # Schedule the async chunk_callback on the main loop
            asyncio.run_coroutine_threadsafe(
                chunk_callback(
                    speaker=speaker,
                    text=sentence,
                    is_final=is_final,
                    confidence=confidence
                ),
                loop
            )

        def on_error(self, error, **kwargs):
            print(f"[Deepgram SDK] Error: {error}")

        deepgram = DeepgramClient(api_key)
        dg_connection = deepgram.listen.live.v("1")

        dg_connection.on(LiveTranscriptionEvents.Transcript, on_message)
        dg_connection.on(LiveTranscriptionEvents.Error, on_error)

        options = LiveOptions(
            model="nova-2",
            language="en-US",
            smart_format=True,
            diarize=True,
            punctuate=True,
            interim_results=True,
            encoding="linear16",
            sample_rate=16000,
        )

        print("[Deepgram SDK] Connecting...")
        # SDK v3 start() is synchronous
        if not dg_connection.start(options):
            raise Exception("Failed to start Deepgram connection")

        print("[Deepgram SDK] Connected successfully!")
        if status_callback: await status_callback("info", "Deepgram connected! Listening...")

        try:
            while True:
                audio_bytes = await audio_queue.get()
                if audio_bytes is None:
                    break
                dg_connection.send(audio_bytes)
        except Exception as e:
            print(f"[Deepgram SDK] Stream Error: {e}")
        finally:
            dg_connection.finish()
            print("[Deepgram SDK] Connection closed.")

    except Exception as e:
        print(f"[Deepgram SDK] CRITICAL: {e}")
        if status_callback: await status_callback("error", str(e))
