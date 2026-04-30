from pymongo import MongoClient

from app.config import settings


class Mongo:
    client: MongoClient | None = None
    db = None


mongo = Mongo()


def connect_mongo() -> None:
    mongo.client = MongoClient(settings.mongodb_uri)
    mongo.db = mongo.client[settings.mongodb_db]
    mongo.db.users.create_index("email", unique=True)
    mongo.db.units.create_index("code", unique=True)
    mongo.db.invoices.create_index([("unit_id", 1), ("period", 1)], unique=True)


def disconnect_mongo() -> None:
    if mongo.client:
        mongo.client.close()
    mongo.client = None
    mongo.db = None

