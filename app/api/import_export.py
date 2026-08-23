import csv
import json
from io import StringIO
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Channel, Group
from ..schemas import ImportResult
from ..services.matching_service import normalize_name

router = APIRouter(prefix="/api", tags=["import-export"])

# --- Pydantic model for execute import ---
class ImportExecuteRequest(BaseModel):
    rows: list[dict]
    duplicate_mode: str = "skip"  # skip | update | import_new

# --- Preview endpoints (unchanged) ---
@router.post("/import/preview/csv")
async def preview_csv(file: UploadFile = File(...), db: Session = Depends(get_db)):
    content = await file.read()
    reader = csv.DictReader(StringIO(content.decode()))
    rows = []
    for row in reader:
        rows.append(row)
    return {"rows": rows, "count": len(rows)}

@router.post("/import/preview/json")
async def preview_json(file: UploadFile = File(...), db: Session = Depends(get_db)):
    content = await file.read()
    data = json.loads(content)
    rows = data if isinstance(data, list) else data.get("channels", [])
    return {"rows": rows, "count": len(rows)}

# --- Execute import (fixed) ---
@router.post("/import/execute", response_model=ImportResult)
def execute_import(payload: ImportExecuteRequest, db: Session = Depends(get_db)):
    result = ImportResult()
    for row in payload.rows:
        name = row.get("name")
        if not name:
            result.failed += 1
            result.errors.append("Missing name")
            continue
        norm = normalize_name(name)
        existing = db.query(Channel).filter(Channel.normalized_name == norm).first()
        group_name = row.get("group")
        group = None
        if group_name:
            group = db.query(Group).filter(Group.name == group_name).first()
            if not group:
                group = Group(name=group_name)
                db.add(group)
                db.flush()

        if existing:
            if payload.duplicate_mode == "skip":
                result.skipped += 1
                continue
            elif payload.duplicate_mode == "update":
                existing.name = name
                existing.normalized_name = norm
                if group:
                    existing.group_id = group.id
                for key in ["embed_url", "logo_url", "description", "enabled", "favorite", "sort_order"]:
                    if key in row and row[key] is not None:
                        setattr(existing, key, row[key])
                if "logo_assignment_mode" in row:
                    existing.logo_assignment_mode = row["logo_assignment_mode"]
                if "epg_assignment_mode" in row:
                    existing.epg_assignment_mode = row["epg_assignment_mode"]
                db.commit()
                result.updated += 1
                continue
            elif payload.duplicate_mode == "import_new":
                # Fall through to create a new channel with a suffix
                name = f"{name} (imported)"
                norm = normalize_name(name)

        # Create new channel
        channel = Channel(
            name=name,
            normalized_name=norm,
            group_id=group.id if group else None,
            embed_url=row.get("embed_url"),
            logo_url=row.get("logo_url"),
            description=row.get("description"),
            enabled=row.get("enabled", True),
            favorite=row.get("favorite", False),
            sort_order=row.get("sort_order", 0),
            logo_assignment_mode=row.get("logo_assignment_mode", "manual"),
            epg_assignment_mode=row.get("epg_assignment_mode", "unassigned"),
        )
        db.add(channel)
        db.commit()
        result.imported += 1

    return result

# --- Export endpoints (unchanged) ---
@router.get("/export/csv")
def export_csv(db: Session = Depends(get_db)):
    channels = db.query(Channel).order_by(Channel.sort_order).all()
    output = StringIO()
    fieldnames = ["name", "group", "embed_url", "logo_url", "description", "enabled", "favorite", "sort_order", "logo_assignment_mode", "epg_assignment_mode"]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for ch in channels:
        writer.writerow({
            "name": ch.name,
            "group": ch.group.name if ch.group else "",
            "embed_url": ch.embed_url or "",
            "logo_url": ch.logo_url or "",
            "description": ch.description or "",
            "enabled": ch.enabled,
            "favorite": ch.favorite,
            "sort_order": ch.sort_order,
            "logo_assignment_mode": ch.logo_assignment_mode,
            "epg_assignment_mode": ch.epg_assignment_mode,
        })
    return output.getvalue()

@router.get("/export/json")
def export_json(db: Session = Depends(get_db)):
    channels = db.query(Channel).order_by(Channel.sort_order).all()
    data = []
    for ch in channels:
        data.append({
            "name": ch.name,
            "group": ch.group.name if ch.group else None,
            "embed_url": ch.embed_url,
            "logo_url": ch.logo_url,
            "description": ch.description,
            "enabled": ch.enabled,
            "favorite": ch.favorite,
            "sort_order": ch.sort_order,
            "logo_assignment_mode": ch.logo_assignment_mode,
            "epg_assignment_mode": ch.epg_assignment_mode,
            "epg_source_id": ch.epg_source_id,
            "epg_channel_id": ch.epg_channel_id,
            "epg_display_name": ch.epg_display_name,
        })
    return data
