import os
from datetime import datetime

REPORT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "reports")

def save_html_report(meeting_id: str, summary_data: dict) -> str:
    """Saves the summary data to a styled HTML file in the reports directory."""
    os.makedirs(REPORT_DIR, exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filepath = os.path.join(REPORT_DIR, f"summary_{meeting_id}_{timestamp}.html")
    
    participants = ", ".join(summary_data.get("participants", [])) or "None detected"
    decisions = "\n".join(f"<li>{d}</li>" for d in summary_data.get("decisions", []))
    action_items = "\n".join(
        f"<li><strong>{item.get('assignee') or 'Unassigned'}:</strong> {item.get('text')}</li>" 
        for item in summary_data.get("action_items", [])
    )
    
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>Meeting Summary: {meeting_id}</title>
        <style>
            body {{ font-family: 'Inter', sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 20px; color: #333; }}
            h1 {{ color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; }}
            h2 {{ color: #2980b9; margin-top: 30px; }}
            .card {{ background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }}
            ul {{ padding-left: 20px; }}
            li {{ margin-bottom: 10px; }}
        </style>
    </head>
    <body>
        <h1>Meeting Summary</h1>
        <p><strong>Meeting ID:</strong> {meeting_id}</p>
        <p><strong>Date:</strong> {datetime.now().strftime("%B %d, %Y - %I:%M %p")}</p>
        <p><strong>Participants:</strong> {participants}</p>
        
        <div class="card">
            <h2>Executive Summary</h2>
            <p>{summary_data.get('summary', 'No summary generated.')}</p>
        </div>
        
        <div class="card">
            <h2>Decisions Made</h2>
            <ul>
                {decisions or "<li>No decisions recorded.</li>"}
            </ul>
        </div>
        
        <div class="card">
            <h2>Action Items</h2>
            <ul>
                {action_items or "<li>No action items recorded.</li>"}
            </ul>
        </div>
    </body>
    </html>
    """
    
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(html_content)
        
    print(f"\n[Report Service] Generated HTML Meeting Summary: {filepath}\n")
    return filepath
