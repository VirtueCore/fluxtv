import os
from pathlib import Path

HOST = os.getenv("FLUXTV_HOST", "0.0.0.0")
PORT = int(os.getenv("FLUXTV_PORT", "8080"))
DEFAULT_TIMEZONE = os.getenv("FLUXTV_DEFAULT_TIMEZONE", "America/New_York")

# EPG retention in days (programmes older than this are deleted)
EPG_RETENTION_DAYS = int(os.getenv("FLUXTV_EPG_RETENTION_DAYS", "7"))

# Set to "false" to disable the EPG scheduler (if you prefer manual refreshes only)
EPG_SCHEDULER_ENABLED = os.getenv("FLUXTV_EPG_SCHEDULER_ENABLED", "true").lower() == "true"

# Determine data directory
DATA_DIR = os.getenv("FLUXTV_DATA_DIR")
if DATA_DIR:
    DATA_DIR = Path(DATA_DIR)
elif os.access("/data", os.W_OK):
    DATA_DIR = Path("/data")
else:
    project_root = Path(__file__).resolve().parent.parent
    DATA_DIR = project_root / "data"

os.makedirs(DATA_DIR, exist_ok=True)
LOGOS_DIR = DATA_DIR / "logos"
os.makedirs(LOGOS_DIR, exist_ok=True)

DATABASE_PATH = os.getenv("FLUXTV_DATABASE", str(DATA_DIR / "fluxtv.db"))

STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "static")
TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), "..", "templates")
