import sys
import asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

# Fix for Playwright NotImplementedError on Windows
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from .routers import transcribe, meetings

app = FastAPI(title="MeetScribe API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # Tighten in production
    allow_methods=["*"],
    allow_headers=["*"]
)

app.include_router(transcribe.router)
app.include_router(meetings.router)

@app.get("/health")
async def health():
    return {"status": "ok"}
