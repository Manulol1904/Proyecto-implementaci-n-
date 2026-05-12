from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.core.config import settings


class Mongo:
    client: AsyncIOMotorClient | None = None
    db: AsyncIOMotorDatabase | None = None


mongo = Mongo()


async def connect_mongo() -> None:
    mongo.client = AsyncIOMotorClient(settings.mongodb_uri)
    mongo.db = mongo.client[settings.mongodb_db]

    # Indexes
    await mongo.db.users.create_index("email", unique=True)
    await mongo.db.units.create_index("code", unique=True)
    await mongo.db.invoices.create_index([("unit_id", 1), ("period", 1)], unique=True)
    await mongo.db.payments.create_index([("invoice_id", 1), ("provider", 1), ("provider_ref", 1)])
    await mongo.db.amenities.create_index("code", unique=True)
    await mongo.db.reservations.create_index([("amenity_id", 1), ("start_at", 1), ("end_at", 1)])
    await mongo.db.reservations.create_index([("user_id", 1), ("status", 1)])
    await mongo.db.gym_subscriptions.create_index([("user_id", 1), ("period", 1)])


async def disconnect_mongo() -> None:
    if mongo.client:
        mongo.client.close()
    mongo.client = None
    mongo.db = None

