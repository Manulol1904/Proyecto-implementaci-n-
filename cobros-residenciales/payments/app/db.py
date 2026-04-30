from pymongo import MongoClient

from app.core.config import settings


class Mongo:
    client: MongoClient | None = None
    db = None


mongo = Mongo()


def connect_mongo() -> None:
    mongo.client = MongoClient(settings.mongodb_uri)
    mongo.db = mongo.client[settings.mongodb_db]
    mongo.db.invoices.create_index([("unit_id", 1), ("period", 1)], unique=True)
    mongo.db.payments.create_index([("invoice_id", 1), ("provider", 1), ("provider_ref", 1)])


def disconnect_mongo() -> None:
    if mongo.client:
        mongo.client.close()
    mongo.client = None
    mongo.db = None

