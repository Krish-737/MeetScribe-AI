import sys
import asyncio
import uvicorn

if __name__ == "__main__":
    # Force the Windows Selector Event Loop
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    
    print("[MeetScribe] Starting Professional Server on Windows...")
    # Disable reload=True locally to prevent the WatchFiles process from overriding our loop policy
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=False)
