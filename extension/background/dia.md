sequenceDiagram
    participant User
    participant Bot as Playwright Teams Bot (teams_bot.py)
    participant Chrome as Headless Chrome (Injected JS)
    participant FastAPI as Backend (transcribe.py)
    participant Deepgram as Deepgram (deepgram_service.py)
    participant Groq as Groq LLM (llm_service.py)

    User->>Bot: Runs script with Meeting URL
    Bot->>Chrome: Opens URL, mutes mic/cam, hits "Join Now"
    Note over Chrome: Injects WebRTC interception JS
    Chrome->>Chrome: Catches incoming participant audio tracks
    Chrome->>FastAPI: Opens WebSocket connection
    Chrome->>FastAPI: Streams raw binary PCM audio frames

    FastAPI->>FastAPI: Puts audio frames in async queue
    FastAPI->>Deepgram: Opens outgoing secure WebSocket
    FastAPI->>Deepgram: Forwards the audio frames in real-time
    Deepgram-->>FastAPI: Returns live text chunks (with Speaker #)

    Note over FastAPI: Saves text to MongoDB & RAM Buffer

    %% END OF MEETING TRIGGER %%
    User->>Bot: Presses Ctrl+C (or 10 min timer ends)
    Bot--xChrome: Harshly kills browser instance
    Chrome--xFastAPI: WebSocket Connection Drops
    
    Note over FastAPI: "finally:" block triggered immediately upon disconnect
    
    FastAPI->>Groq: Sends entire collected transcript text
    Groq-->>FastAPI: Returns structured JSON (Summary, Decisions)
    FastAPI->>FastAPI: Generates summary_xxx.html in /reports/
