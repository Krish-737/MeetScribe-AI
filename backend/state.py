from typing import Dict, Any

# Simple in-memory global state for meetings and their transient API keys
meeting_store: Dict[str, Any] = {}
