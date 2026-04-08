import json
from groq import AsyncGroq
from ..config import settings

client = AsyncGroq(api_key=settings.GROQ_API_KEY)

ROLLING_PROMPT = """You are an AI meeting assistant. Analyze this transcript segment and extract:
1. Key discussion points (2-3 bullet points max)
2. Any decisions made (look for: "we decided", "agreed", "let's go with")
3. Action items (look for: "I will", "can you", "assign to", "follow up")

Respond ONLY in this JSON format:
{
  "summary": "Brief 1-2 sentence overview",
  "decisions": ["decision 1"],
  "action_items": [{"text": "task", "assignee": "name or null"}]
}

Transcript:
"""

FINAL_PROMPT = """You are an AI meeting assistant. Compile these interim summaries into a final meeting report.

Respond ONLY in this JSON format:
{
  "summary": "Executive summary (3-4 sentences)",
  "decisions": ["all decisions made"],
  "action_items": [{"text": "task", "assignee": "name or null"}],
  "participants": ["Speaker 0", "Speaker 1"]
}

Interim summaries:
"""

async def generate_rolling_summary(transcript_text: str) -> dict:
    """Generate a summary for a transcript segment."""
    try:
        response = await client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": ROLLING_PROMPT + transcript_text}],
            max_tokens=500,
            temperature=0.3
        )
        raw = response.choices[0].message.content.strip()
        # Strip markdown fences if present
        raw = raw.replace("```json", "").replace("```", "").strip()
        return json.loads(raw)
    except Exception as e:
        print(f"[LLM] Rolling summary error: {e}")
        return {"summary": "", "decisions": [], "action_items": []}

async def generate_final_report(interim_summaries: list[dict]) -> dict:
    """Compile all interim summaries into a final report."""
    combined = "\n\n".join([
        f"[{i+1}] {s.get('summary', '')}\nDecisions: {s.get('decisions', [])}\nActions: {s.get('action_items', [])}"
        for i, s in enumerate(interim_summaries)
    ])
    try:
        response = await client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": FINAL_PROMPT + combined}],
            max_tokens=800,
            temperature=0.3
        )
        raw = response.choices[0].message.content.strip()
        raw = raw.replace("```json", "").replace("```", "").strip()
        return json.loads(raw)
    except Exception as e:
        print(f"[LLM] Final report error: {e}")
        return {"summary": "", "decisions": [], "action_items": [], "participants": []}
