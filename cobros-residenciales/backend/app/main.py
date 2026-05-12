from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.logging import configure_logging
from app.db.mongo import connect_mongo, disconnect_mongo
from app.routers import admin, amenities, auth, factus, gym, invoices, reports, reservations, units


configure_logging()

app = FastAPI(title="Cobros Residenciales - Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(admin.router, prefix="/admin", tags=["admin"])
app.include_router(units.router, prefix="/units", tags=["units"])
app.include_router(invoices.router, prefix="/invoices", tags=["invoices"])
app.include_router(reports.router, prefix="/reports", tags=["reports"])
app.include_router(factus.router, prefix="/factus", tags=["factus"])
app.include_router(amenities.router, prefix="/amenities", tags=["amenities"])
app.include_router(reservations.router, prefix="/reservations", tags=["reservations"])
app.include_router(gym.router, prefix="/gym", tags=["gym"])


@app.on_event("startup")
async def _startup():
    await connect_mongo()


@app.on_event("shutdown")
async def _shutdown():
    await disconnect_mongo()


@app.get("/health")
async def health():
    return {"status": "ok"}

