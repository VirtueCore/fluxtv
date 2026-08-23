import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

from .database import init_db
from .services.epg_service import epg_scheduler
from .config import STATIC_DIR, TEMPLATE_DIR, LOGOS_DIR

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("fluxtv")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing database...")
    init_db()
    logger.info("Starting EPG scheduler...")
    task = epg_scheduler()
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

app = FastAPI(title="FluxTV", lifespan=lifespan)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/static/logos", StaticFiles(directory=LOGOS_DIR), name="logos")

from .api import health, groups, channels, epg, logos, import_export, settings, backup

app.include_router(health.router)
app.include_router(groups.router)
app.include_router(channels.router)
app.include_router(epg.router)
app.include_router(logos.router)
app.include_router(import_export.router)
app.include_router(settings.router)
app.include_router(backup.router)

@app.get("/")
async def index():
    return FileResponse(Path(TEMPLATE_DIR) / "index.html")
