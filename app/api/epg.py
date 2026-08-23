from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime, timedelta, timezone

from ..database import get_db, db_write_lock
from ..models import EPGSource, EPGChannel, ChannelEPGMapping, Channel, EPGProgram
from ..schemas import (
    EPGSourceCreate,
    EPGSourceUpdate,
    EPGSourceOut,
    EPGChannelOut,
    EPGMappingCreate,
    EPGMappingUpdate,
    EPGMappingOut,
)
from ..services.epg_service import (
    refresh_source,
    test_source,
    auto_match_all,
    get_current_next_program,
)

router = APIRouter(prefix="/api/epg", tags=["epg"])

# ---------- EPG Sources ----------

@router.get("/sources", response_model=list[EPGSourceOut])
def list_sources(db: Session = Depends(get_db)):
    return db.query(EPGSource).order_by(EPGSource.priority, EPGSource.name).all()

@router.post("/sources", response_model=EPGSourceOut, status_code=201)
def create_source(source: EPGSourceCreate, db: Session = Depends(get_db)):
    obj = EPGSource(**source.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj

@router.get("/sources/{source_id}", response_model=EPGSourceOut)
def get_source(source_id: int, db: Session = Depends(get_db)):
    obj = db.get(EPGSource, source_id)
    if not obj:
        raise HTTPException(404, "EPG source not found")
    return obj

@router.put("/sources/{source_id}", response_model=EPGSourceOut)
def update_source(source_id: int, source: EPGSourceUpdate, db: Session = Depends(get_db)):
    obj = db.get(EPGSource, source_id)
    if not obj:
        raise HTTPException(404, "EPG source not found")
    for key, value in source.model_dump().items():
        setattr(obj, key, value)
    db.commit()
    db.refresh(obj)
    return obj

# UPDATED DELETE FUNCTION: Removes all associated channels and programs properly
@router.delete("/sources/{source_id}")
def delete_source(source_id: int, db: Session = Depends(get_db)):
    obj = db.get(EPGSource, source_id)
    if not obj:
        raise HTTPException(404, "EPG source not found")
    
    # FIX: Delete child records BEFORE deleting the source
    # 1. Find all EPG Channels associated with this source
    epg_channels = db.query(EPGChannel).filter(EPGChannel.epg_source_id == source_id).all()
    
    for epg_channel in epg_channels:
        # 2. Delete all programs for each channel
        db.query(EPGProgram).filter(EPGProgram.epg_channel_id == epg_channel.id).delete(synchronize_session=False)
        # 3. Delete the channel itself
        db.delete(epg_channel)

    # 4. Finally, delete the source
    db.delete(obj)
    db.commit()
    return {"ok": True}

@router.post("/sources/{source_id}/refresh")
def refresh_epg_source(source_id: int, db: Session = Depends(get_db)):
    result = refresh_source(source_id)
    if not result:
        raise HTTPException(400, "Refresh failed")
    return {"ok": True}

@router.post("/sources/{source_id}/test")
def test_epg_source(source_id: int, db: Session = Depends(get_db)):
    source = db.get(EPGSource, source_id)
    if not source:
        raise HTTPException(404, "EPG source not found")
    ok, message = test_source(source)
    return {"ok": ok, "message": message}

# ---------- EPG Channels ----------

@router.get("/channels", response_model=list[EPGChannelOut])
def list_epg_channels(
    source_id: Optional[int] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
):
    query = db.query(EPGChannel)
    if source_id:
        query = query.filter(EPGChannel.epg_source_id == source_id)
    if search:
        q = f"%{search}%"
        query = query.filter(EPGChannel.display_name.ilike(q) | EPGChannel.normalized_name.ilike(q))
    return query.limit(200).all()

# ---------- EPG Mappings ----------

@router.get("/mappings")
def list_mappings(db: Session = Depends(get_db)):
    mappings = db.query(ChannelEPGMapping).all()
    result = []
    for m in mappings:
        channel = db.get(Channel, m.channel_id)
        epg_channel = db.get(EPGChannel, m.epg_channel_id)
        result.append({
            "id": m.id,
            "channel_id": m.channel_id,
            "channel_name": channel.name if channel else f"Channel {m.channel_id}",
            "channel_logo": channel.logo_url if channel else None,
            "epg_channel_id": m.epg_channel_id,
            "epg_display_name": epg_channel.display_name if epg_channel else f"EPG {m.epg_channel_id}",
            "assignment_mode": m.assignment_mode,
            "confidence": m.confidence,
        })
    return result

@router.post("/mappings", response_model=EPGMappingOut, status_code=201)
def create_mapping(mapping: EPGMappingCreate, db: Session = Depends(get_db)):
    with db_write_lock:
        channel = db.get(Channel, mapping.channel_id)
        if not channel:
            raise HTTPException(404, "Channel not found")
        epg_channel = db.get(EPGChannel, mapping.epg_channel_id)
        if not epg_channel:
            raise HTTPException(404, "EPG channel not found")

        # Remove any existing mapping for this channel to prevent duplicates
        db.query(ChannelEPGMapping).filter(
            ChannelEPGMapping.channel_id == mapping.channel_id
        ).delete(synchronize_session=False)

        obj = ChannelEPGMapping(**mapping.model_dump())
        db.add(obj)

        channel.epg_source_id = mapping.epg_source_id
        channel.epg_channel_id = mapping.epg_channel_id
        channel.epg_assignment_mode = "manual"
        channel.epg_confidence = mapping.confidence
        db.commit()
        db.refresh(obj)
        return obj

@router.put("/mappings/{mapping_id}", response_model=EPGMappingOut)
def update_mapping(mapping_id: int, mapping: EPGMappingUpdate, db: Session = Depends(get_db)):
    with db_write_lock:
        obj = db.get(ChannelEPGMapping, mapping_id)
        if not obj:
            raise HTTPException(404, "Mapping not found")
        for key, value in mapping.model_dump().items():
            setattr(obj, key, value)
        channel = db.get(Channel, obj.channel_id)
        if channel:
            channel.epg_source_id = obj.epg_source_id
            channel.epg_channel_id = obj.epg_channel_id
            epg_channel = db.get(EPGChannel, obj.epg_channel_id)
            channel.epg_display_name = epg_channel.display_name if epg_channel else None
            channel.epg_assignment_mode = "manual"
            channel.epg_confidence = obj.confidence
        db.commit()
        db.refresh(obj)
        return obj

@router.delete("/mappings/{mapping_id}")
def delete_mapping(mapping_id: int, db: Session = Depends(get_db)):
    with db_write_lock:
        obj = db.get(ChannelEPGMapping, mapping_id)
        if not obj:
            raise HTTPException(404, "Mapping not found")
        channel = db.get(Channel, obj.channel_id)
        if channel:
            channel.epg_assignment_mode = "unassigned"
            channel.epg_source_id = None
            channel.epg_channel_id = None
        db.delete(obj)
        db.commit()
        return {"ok": True}

@router.post("/mappings/{mapping_id}/accept")
def accept_mapping(mapping_id: int, db: Session = Depends(get_db)):
    with db_write_lock:
        obj = db.get(ChannelEPGMapping, mapping_id)
        if not obj:
            raise HTTPException(404, "Mapping not found")
        obj.assignment_mode = "automatic"
        channel = db.get(Channel, obj.channel_id)
        if channel:
            channel.epg_assignment_mode = "automatic"
            channel.epg_source_id = obj.epg_source_id
            channel.epg_channel_id = obj.epg_channel_id
            channel.epg_confidence = obj.confidence
        db.commit()
        return {"ok": True}

@router.post("/mappings/{mapping_id}/reject")
def reject_mapping(mapping_id: int, db: Session = Depends(get_db)):
    with db_write_lock:
        obj = db.get(ChannelEPGMapping, mapping_id)
        if not obj:
            raise HTTPException(404, "Mapping not found")
        obj.assignment_mode = "rejected"
        channel = db.get(Channel, obj.channel_id)
        if channel:
            channel.epg_assignment_mode = "unassigned"
        db.commit()
        return {"ok": True}

@router.post("/automap")
def automap_all(source_id: Optional[int] = None, db: Session = Depends(get_db)):
    auto_match_all(source_id)
    return {"ok": True}

# ---------- EPG Guide (Cable Grid) ----------

@router.get("/guide")
def get_epg_guide(db: Session = Depends(get_db)):
    channels = db.query(Channel).filter(Channel.enabled == True).order_by(Channel.name).all()
    mappings = db.query(ChannelEPGMapping).all()
    mapping_by_channel = {}
    for m in mappings:
        mapping_by_channel.setdefault(m.channel_id, []).append(m)

    now = datetime.utcnow()
    start_range = now - timedelta(hours=2)
    end_range = now + timedelta(hours=6)

    result = []
    for ch in channels:
        item = {
            "id": ch.id,
            "name": ch.name,
            "group": ch.group.name if ch.group else None,
            "logo_url": ch.logo_url,
            "epg_assignment_mode": ch.epg_assignment_mode,
            "epg_source_id": ch.epg_source_id,
            "epg_channel_id": ch.epg_channel_id,
            "epg_display_name": ch.epg_display_name,
            "epg_confidence": ch.epg_confidence,
            "suggested": [],
            "current_program": None,
            "next_program": None,
            "programs": [],
        }

        active_mapping = None
        for m in mapping_by_channel.get(ch.id, []):
            if m.assignment_mode in ["manual", "automatic"]:
                active_mapping = m
                break

        for m in mapping_by_channel.get(ch.id, []):
            if m.assignment_mode == "suggested":
                epg_ch = db.get(EPGChannel, m.epg_channel_id)
                item["suggested"].append({
                    "mapping_id": m.id,
                    "epg_channel_id": m.epg_channel_id,
                    "display_name": epg_ch.display_name if epg_ch else "",
                    "confidence": m.confidence,
                })

        if active_mapping and active_mapping.epg_channel_id:
            epg_channel_id = active_mapping.epg_channel_id
            programs = db.query(EPGProgram).filter(
                EPGProgram.epg_channel_id == epg_channel_id,
                EPGProgram.start_time < end_range,
                EPGProgram.end_time > start_range,
            ).order_by(EPGProgram.start_time).all()

            item["programs"] = [
                {
                    "start_time": p.start_time.isoformat() + "Z",
                    "end_time": p.end_time.isoformat() + "Z",
                    "title": p.title,
                }
                for p in programs
            ]

            current = db.query(EPGProgram).filter(
                EPGProgram.epg_channel_id == epg_channel_id,
                EPGProgram.start_time <= now,
                EPGProgram.end_time > now,
            ).order_by(EPGProgram.start_time.desc()).first()
            next_prog = None
            if current:
                next_prog = db.query(EPGProgram).filter(
                    EPGProgram.epg_channel_id == epg_channel_id,
                    EPGProgram.start_time >= current.end_time,
                ).order_by(EPGProgram.start_time.asc()).first()
            item["current_program"] = current.title if current else None
            item["next_program"] = next_prog.title if next_prog else None

        result.append(item)

    return result

# ---------- Batch Current/Next Program ----------

@router.get("/now-next")
def get_now_next(channel_ids: str, db: Session = Depends(get_db)):
    ids = [int(x) for x in channel_ids.split(",") if x.strip().isdigit()]
    result = {}
    for cid in ids:
        channel = db.get(Channel, cid)
        if not channel or not channel.epg_channel_id:
            continue
        data = get_current_next_program(channel.epg_channel_id, db)
        if data:
            def prog_to_dict(prog):
                if not prog:
                    return None
                return {
                    "title": prog.title,
                    "start_time": prog.start_time.isoformat() + "Z",
                    "end_time": prog.end_time.isoformat() + "Z",
                    "subtitle": prog.subtitle,
                    "category": prog.category,
                }
            result[cid] = {
                "current": prog_to_dict(data.get("current")),
                "next": prog_to_dict(data.get("next")),
            }
    return result
