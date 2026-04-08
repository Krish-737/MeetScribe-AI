from pydantic_settings import BaseSettings
from pathlib import Path

class Settings(BaseSettings):
    MONGODB_URI: str = "mongodb://localhost:27017"
    DB_NAME: str = "meetscribe"
    DEEPGRAM_API_KEY: str = ""
    GROQ_API_KEY: str = ""
    SUMMARY_INTERVAL_MINUTES: int = 5

    class Config:
        env_file = str(Path(__file__).resolve().parent.parent / ".env")

settings = Settings()
