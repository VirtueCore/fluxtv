import logging
import shutil
import os
import httpx
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session

from ..database import get_db, db_write_lock
from ..models import LogoSource, Channel, LogoSuggestion, LogoEntry
from ..schemas import LogoSourceCreate, LogoSourceUpdate, LogoSourceOut, LogoEntryOut
from ..services.logo_service import (
    refresh_logo_source,
    auto_match_logos,
    force_match_all_logos,
    fetch_github_directory,
)
from ..services.matching_service import normalize_name
from ..config import LOGOS_DIR

logger = logging.getLogger("fluxtv.logos")

router = APIRouter(prefix="/api/logos", tags=["logos"])

SOURCES_DIR = Path(LOGOS_DIR) / "sources"
os.makedirs(SOURCES_DIR, exist_ok=True)

# ---------- Logo Sources ----------

@router.get("/sources", response_model=list[LogoSourceOut])
def list_sources(db: Session = Depends(get_db)):
    return db.query(LogoSource).order_by(LogoSource.priority, LogoSource.name).all()

@router.post("/sources", response_model=LogoSourceOut, status_code=201)
def create_source(source: LogoSourceCreate, db: Session = Depends(get_db)):
    obj = LogoSource(**source.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj

@router.get("/sources/{source_id}", response_model=LogoSourceOut)
def get_source(source_id: int, db: Session = Depends(get_db)):
    obj = db.get(LogoSource, source_id)
    if not obj:
        raise HTTPException(404, "Logo source not found")
    return obj

@router.put("/sources/{source_id}", response_model=LogoSourceOut)
def update_source(source_id: int, source: LogoSourceUpdate, db: Session = Depends(get_db)):
    obj = db.get(LogoSource, source_id)
    if not obj:
        raise HTTPException(404, "Logo source not found")
    for key, value in source.model_dump().items():
        setattr(obj, key, value)
    db.commit()
    db.refresh(obj)
    return obj

@router.delete("/sources/{source_id}")
def delete_source(source_id: int, db: Session = Depends(get_db)):
    obj = db.get(LogoSource, source_id)
    if not obj:
        raise HTTPException(404, "Logo source not found")
    db.delete(obj)
    db.commit()
    return {"ok": True}

@router.post("/sources/{source_id}/refresh")
def refresh_source(source_id: int, db: Session = Depends(get_db)):
    if not refresh_logo_source(source_id):
        raise HTTPException(400, "Refresh failed")
    return {"ok": True}

@router.post("/upload-source")
async def upload_logo_source(
    file: UploadFile = File(...),
    name: str = Form(...),
    db: Session = Depends(get_db)
):
    safe_name = "".join(c for c in name if c.isalnum() or c in (" ", "_", "-")).rstrip().replace(" ", "_")
    if not safe_name:
        safe_name = "uploaded_source"
    filename = f"{safe_name}.json"
    dest = SOURCES_DIR / filename
    with dest.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    obj = LogoSource(
        name=name,
        source_type="local_file",
        url=str(dest),
        enabled=True,
        priority=0,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj

@router.post("/automatch")
def automatch(db: Session = Depends(get_db)):
    auto_match_logos()
    return {"ok": True}

@router.post("/force-match")
def force_match(replace: bool = False, db: Session = Depends(get_db)):
    assigned = force_match_all_logos(replace)
    return {"ok": True, "assigned": assigned}

@router.post("/clear-auto")
def clear_auto_logos(db: Session = Depends(get_db)):
    with db_write_lock:
        updated = 0
        channels = db.query(Channel).filter(Channel.logo_assignment_mode == "automatic").all()
        for channel in channels:
            channel.logo_url = None
            channel.logo_source = None
            channel.alternate_logo_url = None
            channel.logo_assignment_mode = "none"
            updated += 1
        db.commit()
        return {"ok": True, "cleared": updated}

@router.post("/upload")
async def upload_logo(file: UploadFile = File(...), channel_id: int | None = None, db: Session = Depends(get_db)):
    suffix = Path(file.filename).suffix or ".png"
    filename = f"logo_{channel_id or 'temp'}_{abs(hash(file.filename))}{suffix}"
    dest = Path(LOGOS_DIR) / filename
    with dest.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    url = f"/static/logos/{filename}"
    return {"url": url}

@router.get("/suggestions")
def get_suggestions(channel_id: int | None = None, db: Session = Depends(get_db)):
    query = db.query(LogoSuggestion).filter(LogoSuggestion.status == "pending")
    if channel_id:
        query = query.filter(LogoSuggestion.channel_id == channel_id)
    return query.all()

@router.post("/suggestions/{suggestion_id}/accept")
def accept_suggestion(suggestion_id: int, db: Session = Depends(get_db)):
    with db_write_lock:
        suggestion = db.get(LogoSuggestion, suggestion_id)
        if not suggestion:
            raise HTTPException(404, "Suggestion not found")
        channel = db.get(Channel, suggestion.channel_id)
        if channel:
            channel.logo_url = suggestion.logo_url
            channel.logo_assignment_mode = "automatic"
            channel.logo_source = str(suggestion.logo_source_id) if suggestion.logo_source_id else "suggestion"
        suggestion.status = "accepted"
        db.commit()
        return {"ok": True}

@router.post("/suggestions/{suggestion_id}/reject")
def reject_suggestion(suggestion_id: int, db: Session = Depends(get_db)):
    with db_write_lock:
        suggestion = db.get(LogoSuggestion, suggestion_id)
        if not suggestion:
            raise HTTPException(404, "Suggestion not found")
        suggestion.status = "rejected"
        db.commit()
        return {"ok": True}

# ---------- Logo Entries & Assignment ----------

@router.get("/entries", response_model=list[LogoEntryOut])
def list_logo_entries(
    search: str = "",
    source_id: int | None = None,
    db: Session = Depends(get_db)
):
    """
    Returns logo entries, optionally filtered by source.
    If source_id is None (All Sources), combine static entries and live GitHub directory entries.
    """
    # If a specific source is selected
    if source_id is not None:
        source = db.get(LogoSource, source_id)
        if not source:
            raise HTTPException(404, "Logo source not found")
        if source.source_type == "github_dir":
            entries = fetch_github_directory(source)
            if search:
                q = search.lower()
                entries = [e for e in entries if q in e["name"].lower()]
            return [
                LogoEntryOut(
                    id=0,
                    logo_source_id=source.id,
                    name=e["name"],
                    normalized_name=normalize_name(e["name"]),
                    url=e["url"],
                    priority=e.get("priority", 0),
                    created_at=datetime.now(timezone.utc).replace(tzinfo=None)
                )
                for e in entries
            ]
        else:
            query = db.query(LogoEntry).filter(LogoEntry.logo_source_id == source_id)
            if search:
                q = f"%{search}%"
                query = query.filter(LogoEntry.name.ilike(q) | LogoEntry.normalized_name.ilike(q))
            return query.order_by(LogoEntry.name).limit(200).all()

    # All sources: combine static + live GitHub
    combined = []

    # Static entries
    static_query = db.query(LogoEntry)
    if search:
        q = f"%{search}%"
        static_query = static_query.filter(LogoEntry.name.ilike(q) | LogoEntry.normalized_name.ilike(q))
    static_entries = static_query.order_by(LogoEntry.name).all()
    for e in static_entries:
        combined.append(LogoEntryOut(
            id=e.id,
            logo_source_id=e.logo_source_id,
            name=e.name,
            normalized_name=e.normalized_name,
            url=e.url,
            priority=e.priority,
            created_at=e.created_at
        ))

    # Live GitHub entries from enabled sources
    gh_sources = db.query(LogoSource).filter(
        LogoSource.enabled == True,
        LogoSource.source_type == "github_dir"
    ).all()
    for source in gh_sources:
        try:
            gh_entries = fetch_github_directory(source)
        except Exception as e:
            logger.warning(f"Failed to fetch GitHub directory {source.name}: {e}")
            continue
        for e in gh_entries:
            if search and search.lower() not in e["name"].lower():
                continue
            combined.append(LogoEntryOut(
                id=0,
                logo_source_id=source.id,
                name=e["name"],
                normalized_name=normalize_name(e["name"]),
                url=e["url"],
                priority=e.get("priority", 0),
                created_at=datetime.now(timezone.utc).replace(tzinfo=None)
            ))

    # Sort combined by name and limit
    combined.sort(key=lambda x: x.name)
    return combined[:200]

@router.post("/assign")
def assign_logo(payload: dict, db: Session = Depends(get_db)):
    channel_id = payload.get("channel_id")
    logo_entry_id = payload.get("logo_entry_id")
    if not channel_id or not logo_entry_id:
        raise HTTPException(400, "channel_id and logo_entry_id are required")
    with db_write_lock:
        channel = db.get(Channel, channel_id)
        if not channel:
            raise HTTPException(404, "Channel not found")
        entry = db.get(LogoEntry, logo_entry_id)
        if not entry:
            raise HTTPException(404, "Logo entry not found")
        channel.logo_url = entry.url
        channel.logo_assignment_mode = "manual"
        channel.logo_source = str(entry.logo_source_id)
        db.commit()
        return {"ok": True}

@router.post("/assign-custom")
def assign_custom_logo(payload: dict, db: Session = Depends(get_db)):
    channel_id = payload.get("channel_id")
    logo_url = payload.get("logo_url")
    if not channel_id or not logo_url:
        raise HTTPException(400, "channel_id and logo_url are required")
    if logo_url.lower().startswith(("javascript:", "data:", "file:")):
        raise HTTPException(400, "Invalid URL scheme")
    with db_write_lock:
        channel = db.get(Channel, channel_id)
        if not channel:
            raise HTTPException(404, "Channel not found")
        channel.logo_url = logo_url
        channel.logo_assignment_mode = "manual"
        channel.logo_source = None
        db.commit()
        return {"ok": True}

# ---------- Check logo URLs ----------

@router.get("/check")
def check_logo_urls(db: Session = Depends(get_db)):
    broken = []
    channels = db.query(Channel).filter(Channel.logo_url != None).all()
    for ch in channels:
        url = ch.logo_url
        try:
            resp = httpx.head(url, follow_redirects=True, timeout=5)
            if resp.status_code >= 400:
                resp = httpx.get(url, follow_redirects=True, timeout=5)
            status = resp.status_code
        except Exception:
            status = 0
        if status >= 400 or status == 0:
            broken.append({
                "channel_id": ch.id,
                "name": ch.name,
                "logo_url": url,
                "status": status,
            })
    return {"broken": broken, "count": len(broken)}
