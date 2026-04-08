from fastapi import APIRouter
from ..db import get_db
from ..models.models import Summary
from ..services.llm_service import generate_final_report
from datetime import datetime

router = APIRouter(prefix="/meetings", tags=["meetings"])

@router.get("/")
async def list_meetings():
    db = get_db()
    meetings = await db.meetings.find(
        {}, {"_id": 0}
    ).sort("startedAt", -1).limit(20).to_list(20)
    return meetings

@router.get("/{meeting_id}")
async def get_meeting(meeting_id: str):
    db = get_db()
    meeting = await db.meetings.find_one({"meetingId": meeting_id}, {"_id": 0})
    return meeting

@router.get("/{meeting_id}/transcript")
async def get_transcript(meeting_id: str):
    db = get_db()
    chunks = await db.chunks.find(
        {"meetingId": meeting_id, "isFinal": True}, {"_id": 0}
    ).sort("timestamp", 1).to_list(None)
    return chunks

@router.post("/{meeting_id}/report")
async def generate_report(meeting_id: str):
    """Compile all interim summaries into final meeting report."""
    db = get_db()

    interims = await db.summaries.find(
        {"meetingId": meeting_id, "type": "interim"}, {"_id": 0}
    ).sort("createdAt", 1).to_list(None)

    if not interims:
        # Fall back: use raw transcript for final summary
        chunks = await db.chunks.find(
            {"meetingId": meeting_id, "isFinal": True}, {"_id": 0}
        ).sort("timestamp", 1).to_list(None)
        interims = [{"summary": " ".join(c["text"] for c in chunks)}]

    report = await generate_final_report(interims)

    summary = Summary(
        meetingId=meeting_id,
        type="final",
        content=report.get("summary", ""),
        action_items=report.get("action_items", []),
        decisions=report.get("decisions", []),
        participants=report.get("participants", [])
    )
    await db.summaries.replace_one(
        {"meetingId": meeting_id, "type": "final"},
        summary.model_dump(),
        upsert=True
    )
    return summary.model_dump()

@router.get("/{meeting_id}/report")
async def get_report(meeting_id: str):
    db = get_db()
    report = await db.summaries.find_one(
        {"meetingId": meeting_id, "type": "final"}, {"_id": 0}
    )
    return report
