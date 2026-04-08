from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from .db import connect, disconnect
from .routers import transcribe, meetings

@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect()
    yield
    await disconnect()

app = FastAPI(title="MeetScribe API", lifespan=lifespan)

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
