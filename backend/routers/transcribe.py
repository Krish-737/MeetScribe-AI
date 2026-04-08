import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from ..state import meeting_store
from ..services.deepgram_service import stream_to_deepgram
from ..services.llm_service import generate_rolling_summary, generate_full_summary
from ..services.report_service import save_html_report
from ..config import settings

router = APIRouter()

@router.websocket("/ws/transcribe")
async def transcribe_ws(
    websocket: WebSocket,
    meetingId: str = Query(...)
):
    await websocket.accept()
    print(f"\n" + "="*50)
    print(f"!!! [WS] CONNECTION ACCEPTED: {meetingId} !!!")
    print(f"Headers: {dict(websocket.headers)}")
    print("="*50 + "\n")
    
    meeting_info = meeting_store.get(meetingId)
    if not meeting_info:
        print(f"[WS] Error: Meeting {meetingId} not found in state.")
        await websocket.close(code=1008)
        return

    audio_queue = asyncio.Queue()
    transcript_buffer = []
    last_summary_time = datetime.now(timezone.utc)

    # Use keys from store if provided, else fall back to settings
    dg_key = meeting_info.get("deepgram_api_key") or settings.DEEPGRAM_API_KEY
    groq_key = meeting_info.get("groq_api_key") or settings.GROQ_API_KEY

    async def on_chunk(speaker, text, is_final, confidence):
        if not text:
            return

        print(f"[Deepgram] Result (Final={is_final}): (speaker {speaker}) {text}")
        
        # Always append to the meeting history for real-time polling
        meeting_info["transcript"].append({
            "speaker": speaker,
            "text": text,
            "isFinal": is_final,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })

        if is_final:
            transcript_buffer.append(f"Speaker {speaker}: {text}")

        # Try to send to the bot (for its own logs if needed)
        try:
            await websocket.send_json({
                "speaker": speaker,
                "text": text,
                "isFinal": is_final
            })
        except:
            pass
        
    async def status_callback(status_type: str, message: str):
        print(f"[Deepgram Status] {status_type}: {message}")
        if status_type == "error":
            meeting_info["status"] = "failed"
            try: await websocket.send_json({"error": message})
            except: pass
        else:
            try: await websocket.send_json({"info": message})
            except: pass

    dg_task = asyncio.create_task(
        stream_to_deepgram(audio_queue, on_chunk, status_callback, api_key=dg_key)
    )

    try:
        byte_count = 0
        while True:
            if dg_task.done():
                exc = dg_task.exception()
                if exc:
                    print(f"[Deepgram] Task died early: {exc}")
                    raise exc
                break

            message = await websocket.receive()
            
            if message["type"] == "websocket.disconnect":
                break

            if "bytes" in message and message["bytes"]:
                if byte_count == 0:
                    print(f"\n" + "!"*60)
                    print(f"!!! FIRST AUDIO DATA RECEIVED FROM {meetingId} !!!")
                    print(f"!"*60 + "\n")
                    await websocket.send_json({"info": "FASTAPI RECEIVED FIRST AUDIO BYTES!!"})
                
                data = message["bytes"]
                new_total = byte_count + len(data)
                if int(new_total / 100000) > int(byte_count / 100000):
                     print(f"[WS] Received {new_total} bytes total from {meetingId}")
                byte_count = new_total
                await audio_queue.put(data)
            elif "text" in message:
                print(f"[WS] Received text message: {message['text']}")

    except WebSocketDisconnect:
        print(f"[WS] Client disconnected: {meetingId}")
    except Exception as e:
        print(f"[WS] Error in transcription loop: {e}")
    finally:
        await audio_queue.put(None)
        try:
            await asyncio.wait_for(dg_task, timeout=2.0)
        except:
            pass
        print(f"[WS] Connection closed: {meetingId}")

        if transcript_buffer:
            print(f"[LLM] Meeting {meetingId} ended. Summarizing {len(transcript_buffer)} segments via Groq...")
            full_text = "\n".join(transcript_buffer)
            summary_dict = await generate_full_summary(full_text, api_key=groq_key)
            if summary_dict and summary_dict.get("summary"):
                meeting_info["summary"] = summary_dict
                save_html_report(meetingId, summary_dict)
            
        # Always set to completed if we have any transcript or if it was active
        if meeting_info.get("status") == "active":
            meeting_info["status"] = "completed"
            print(f"[Meeting] Meeting {meetingId} marked as completed.")
