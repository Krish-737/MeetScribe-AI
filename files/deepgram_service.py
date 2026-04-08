import json
import asyncio
import websockets
from ..config import settings

DEEPGRAM_URL = (
    "wss://api.deepgram.com/v1/listen"
    "?model=nova-2"
    "&language=en"
    "&encoding=opus"
    "&sample_rate=16000"
    "&channels=1"
    "&diarize=true"
    "&punctuate=true"
    "&utterance_end_ms=1000"
    "&interim_results=true"
)

async def stream_to_deepgram(audio_queue: asyncio.Queue, chunk_callback):
    """
    Reads raw audio bytes from audio_queue.
    Calls chunk_callback(speaker, text, is_final, confidence) for each transcript.
    """
    headers = {"Authorization": f"Token {settings.DEEPGRAM_API_KEY}"}

    async with websockets.connect(DEEPGRAM_URL, extra_headers=headers) as dg_ws:
        async def sender():
            while True:
                audio_bytes = await audio_queue.get()
                if audio_bytes is None:  # Sentinel — stop signal
                    await dg_ws.send(json.dumps({"type": "CloseStream"}))
                    break
                await dg_ws.send(audio_bytes)

        async def receiver():
            async for message in dg_ws:
                data = json.loads(message)
                msg_type = data.get("type")

                if msg_type == "Results":
                    channel = data.get("channel", {})
                    alternatives = channel.get("alternatives", [])
                    if not alternatives:
                        continue

                    alt = alternatives[0]
                    transcript = alt.get("transcript", "").strip()
                    if not transcript:
                        continue

                    is_final = data.get("is_final", False)
                    confidence = alt.get("confidence", None)

                    # Extract speaker from first word with diarization
                    words = alt.get("words", [])
                    speaker = words[0].get("speaker") if words else None

                    await chunk_callback(
                        speaker=speaker,
                        text=transcript,
                        is_final=is_final,
                        confidence=confidence
                    )

                elif msg_type == "Error":
                    print(f"[Deepgram] Error: {data}")
                    break

        await asyncio.gather(sender(), receiver())
