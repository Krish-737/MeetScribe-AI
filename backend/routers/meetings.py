from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
import time
from ..state import meeting_store
from ..bot.teams_bot import run

router = APIRouter(prefix="/meetings", tags=["meetings"])

class JoinRequest(BaseModel):
    meeting_url: str
    deepgram_api_key: str | None = None
    groq_api_key: str | None = None

@router.get("/")
async def list_meetings():
    """Returns all meetings currently in memory."""
    # Convert dict view to a list of meeting objects
    return [
        {"meetingId": mid, **info} 
        for mid, info in meeting_store.items()
    ]

@router.post("/join")
async def join_meeting(req: JoinRequest, background_tasks: BackgroundTasks):
    # Concurrency Guard: Check for already active meetings
    active_meetings = [m for m in meeting_store.values() if m.get("status") in ["joining", "active"]]
    if len(active_meetings) > 0:
        raise HTTPException(
            status_code=429, 
            detail="Server at capacity: Current hosting tier only supports ONE active meeting at a time."
        )

    meeting_id = f"api_bot_{int(time.time()*1000)}"
    
    meeting_info = {
        "meetingId": meeting_id,
        "url": req.meeting_url,
        "startedAt": time.time(),
        "status": "joining",
        "deepgram_api_key": req.deepgram_api_key,
        "groq_api_key": req.groq_api_key,
        "transcript": []
    }
    meeting_store[meeting_id] = meeting_info
    
    # Run the playwright bot as a background task
    background_tasks.add_task(run, req.meeting_url, meeting_id)
    return {"meetingId": meeting_id, "status": "joining"}



@router.get("/")
async def list_meetings():
    # Return sorted list of active/recent meetings from memory
    meetings = sorted(
        meeting_store.values(), 
        key=lambda x: x["startedAt"], 
        reverse=True
    )[:20]
    # Remove keys from response for security
    return [
        {k: v for k, v in m.items() if "api_key" not in k} 
        for m in meetings
    ]

@router.get("/{meeting_id}")
async def get_meeting(meeting_id: str):
    meeting = meeting_store.get(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    # Mask keys
    return {k: v for k, v in meeting.items() if "api_key" not in k}

@router.post("/{meeting_id}/terminate")
async def terminate_meeting(meeting_id: str):
    """Signals the bot to leave and triggers summarization."""
    if meeting_id in meeting_store:
        meeting_info = meeting_store[meeting_id]
        if meeting_info.get("status") == "active":
            meeting_info["status"] = "terminating" # Signal for the bot loop
            return {"status": "termination_signaled"}
    return {"status": "meeting_not_active"}

@router.get("/{meeting_id}/transcript")
async def get_transcript(meeting_id: str):
    meeting = meeting_store.get(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting.get("transcript", [])

@router.get("/{meeting_id}/summary")
async def get_summary(meeting_id: str):
    meeting = meeting_store.get(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting.get("summary")


