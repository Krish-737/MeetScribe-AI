import sys
from unittest.mock import MagicMock

# Headless Fix: Prevent Deepgram from crashing due to missing pyaudio on Linux servers
sys.modules["pyaudio"] = MagicMock()

import os
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
    # CORS Configuration
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        os.getenv("FRONTEND_URL", "*") # Allow Render Frontend URL or fallback to all
    ],
    allow_methods=["*"],
    allow_headers=["*"]
)

app.include_router(transcribe.router)
app.include_router(meetings.router)

@app.get("/health")
async def health():
    return {"status": "ok"}
