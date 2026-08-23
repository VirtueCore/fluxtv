import json
from datetime import datetime, date
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..database import get_db, db_write_lock
from ..models import (
    Group,
    Channel,
    EPGSource,
    EPGChannel,
    EPGProgram,
    ChannelEPGMapping,
    LogoSource,
    LogoEntry,
    LogoSuggestion,
    Setting,
)

router = APIRouter(prefix="/api/backup", tags=["backup"])


def serialize_value(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def model_to_dict(obj):
    return {c.name: serialize_value(getattr(obj, c.name)) for c in obj.__table__.columns}


def insert_models(db, model, items):
    for item in items:
        valid_keys = {c.name for c in model.__table__.columns}
        filtered = {k: v for k, v in item.items() if k in valid_keys}
        db.add(model(**filtered))


@router.get("/export")
def export_backup(db: Session = Depends(get_db)):
    """
    Export all FluxTV data as a downloadable JSON file.
    Uses StreamingResponse to handle large datasets (EPGPrograms) without memory spikes.
    """
    def generate():
        yield '{"groups": '
        yield json.dumps([model_to_dict(g) for g in db.query(Group).all()])
        
        yield ', "channels": '
        yield json.dumps([model_to_dict(c) for c in db.query(Channel).all()])
        
        yield ', "epg_sources": '
        yield json.dumps([model_to_dict(s) for s in db.query(EPGSource).all()])
        
        yield ', "epg_channels": '
        yield json.dumps([model_to_dict(c) for c in db.query(EPGChannel).all()])
        
        # Stream EPG Programs in chunks to save memory
        yield ', "epg_programs": ['
        programs = db.query(EPGProgram).yield_per(5000) # Fetch in batches of 5000
        first_program = True
        for p in programs:
            if not first_program:
                yield ', '
            yield json.dumps(model_to_dict(p))
            first_program = False
        yield ']'
        
        yield ', "channel_epg_mappings": '
        yield json.dumps([model_to_dict(m) for m in db.query(ChannelEPGMapping).all()])
        
        yield ', "logo_sources": '
        yield json.dumps([model_to_dict(s) for s in db.query(LogoSource).all()])
        
        yield ', "logo_entries": '
        yield json.dumps([model_to_dict(e) for e in db.query(LogoEntry).all()])
        
        yield ', "logo_suggestions": '
        yield json.dumps([model_to_dict(s) for s in db.query(LogoSuggestion).all()])
        
        yield ', "settings": '
        yield json.dumps([model_to_dict(s) for s in db.query(Setting).all()])
        
        yield '}'

    return StreamingResponse(
        generate(),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=fluxtv_backup.json"},
    )


@router.post("/import")
def import_backup(payload: dict, db: Session = Depends(get_db)):
    """
    Replace the current database with the provided backup data.
    """
    with db_write_lock:
        # Delete in reverse dependency order
        db.query(LogoSuggestion).delete()
        db.query(LogoEntry).delete()
        db.query(LogoSource).delete()
        db.query(ChannelEPGMapping).delete()
        db.query(EPGProgram).delete()
        db.query(EPGChannel).delete()
        db.query(EPGSource).delete()
        db.query(Channel).delete()
        db.query(Group).delete()
        db.query(Setting).delete()
        db.commit()

        # Insert in dependency order
        insert_models(db, Group, payload.get("groups", []))
        db.commit()
        insert_models(db, EPGSource, payload.get("epg_sources", []))
        db.commit()
        insert_models(db, LogoSource, payload.get("logo_sources", []))
        db.commit()
        insert_models(db, Channel, payload.get("channels", []))
        db.commit()
        insert_models(db, EPGChannel, payload.get("epg_channels", []))
        db.commit()
        insert_models(db, EPGProgram, payload.get("epg_programs", []))
        db.commit()
        insert_models(db, ChannelEPGMapping, payload.get("channel_epg_mappings", []))
        db.commit()
        insert_models(db, LogoEntry, payload.get("logo_entries", []))
        db.commit()
        insert_models(db, LogoSuggestion, payload.get("logo_suggestions", []))
        db.commit()
        insert_models(db, Setting, payload.get("settings", []))
        db.commit()

        return {"ok": True, "message": "Backup restored successfully"}
