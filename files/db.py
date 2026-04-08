from motor.motor_asyncio import AsyncIOMotorClient
from .config import settings

client: AsyncIOMotorClient = None

def get_db():
    return client[settings.DB_NAME]

async def connect():
    global client
    client = AsyncIOMotorClient(settings.MONGODB_URI)
    db = get_db()

    # Indexes
    await db.chunks.create_index([("meetingId", 1), ("timestamp", 1)])
    await db.chunks.create_index("timestamp", expireAfterSeconds=604800)  # 7-day TTL
    await db.meetings.create_index("startedAt")
    await db.summaries.create_index([("meetingId", 1), ("type", 1)])

    print("[DB] Connected to MongoDB")

async def disconnect():
    global client
    if client:
        client.close()
        print("[DB] Disconnected")
