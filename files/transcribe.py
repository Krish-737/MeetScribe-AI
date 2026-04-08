import asyncio
from datetime import datetime, timedelta
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from ..db import get_db
from ..models.models import Meeting, TranscriptChunk, Summary
from ..services.deepgram_service import stream_to_deepgram
from ..services.llm_service import generate_rolling_summary
from ..config import settings

router = APIRouter()

@router.websocket("/ws/transcribe")
async def transcribe_ws(
    websocket: WebSocket,
    meetingId: str = Query(...)
):
    await websocket.accept()
    db = get_db()

    # Detect platform from meetingId prefix or query param
    platform = "meet"  # default; extension can pass platform param later

    # Store meeting record
    meeting = Meeting(meetingId=meetingId, platform=platform)
    await db.meetings.insert_one(meeting.model_dump())

    audio_queue = asyncio.Queue()
    transcript_buffer = []       # Accumulates final chunks for rolling summary
    last_summary_time = datetime.utcnow()

    async def on_chunk(speaker, text, is_final, confidence):
        """Called by Deepgram service for each transcript result."""
        chunk = TranscriptChunk(
            meetingId=meetingId,
            speaker=speaker,
            text=text,
            isFinal=is_final,
            confidence=confidence
        )

        # Persist all final chunks to MongoDB
        if is_final:
            await db.chunks.insert_one(chunk.model_dump())
            transcript_buffer.append(f"Speaker {speaker}: {text}")

        # Forward to extension
        await websocket.send_json({
            "speaker": speaker,
            "text": text,
            "isFinal": is_final
        })

        # Rolling summary every N minutes
        nonlocal last_summary_time
        interval = timedelta(minutes=settings.SUMMARY_INTERVAL_MINUTES)
        if is_final and datetime.utcnow() - last_summary_time >= interval:
            asyncio.create_task(
                run_rolling_summary(meetingId, list(transcript_buffer), db)
            )
            transcript_buffer.clear()
            last_summary_time = datetime.utcnow()

    # Start Deepgram stream in background
    dg_task = asyncio.create_task(
        stream_to_deepgram(audio_queue, on_chunk)
    )

    try:
        # Receive audio bytes from extension
        while True:
            data = await websocket.receive_bytes()
            await audio_queue.put(data)

    except WebSocketDisconnect:
        print(f"[WS] Client disconnected: {meetingId}")
    finally:
        # Signal Deepgram to close
        await audio_queue.put(None)
        await dg_task

        # Mark meeting ended
        await db.meetings.update_one(
            {"meetingId": meetingId},
            {"$set": {"endedAt": datetime.utcnow()}}
        )


async def run_rolling_summary(meetingId: str, chunks: list, db):
    if not chunks:
        return
    transcript_text = "\n".join(chunks)
    result = await generate_rolling_summary(transcript_text)

    summary = Summary(
        meetingId=meetingId,
        type="interim",
        content=result.get("summary", ""),
        action_items=result.get("action_items", []),
        decisions=result.get("decisions", [])
    )
    await db.summaries.insert_one(summary.model_dump())
    print(f"[Summary] Interim summary saved for {meetingId}")
