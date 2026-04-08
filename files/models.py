from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime

class Meeting(BaseModel):
    meetingId: str
    platform: str          # "meet" | "zoom"
    startedAt: datetime = Field(default_factory=datetime.utcnow)
    endedAt: Optional[datetime] = None
    userId: Optional[str] = None

class TranscriptChunk(BaseModel):
    meetingId: str
    speaker: Optional[int] = None
    text: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    isFinal: bool = False
    confidence: Optional[float] = None

class ActionItem(BaseModel):
    text: str
    assignee: Optional[str] = None

class Summary(BaseModel):
    meetingId: str
    type: str              # "interim" | "final"
    content: str
    action_items: List[ActionItem] = []
    decisions: List[str] = []
    participants: List[str] = []
    createdAt: datetime = Field(default_factory=datetime.utcnow)
