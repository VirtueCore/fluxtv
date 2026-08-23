from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from ..database import get_db, db_write_lock
from ..models import Channel, Group
from ..schemas import ChannelCreate, ChannelUpdate, ChannelOut
from ..services.matching_service import normalize_name
from ..services.epg_service import auto_match_single_channel
from ..services.logo_service import auto_match_logos_single

router = APIRouter(prefix="/api/channels", tags=["channels"])

class BulkDeleteRequest(BaseModel):
    ids: list[int] = []
    delete_all: bool = False

# List channels
@router.get("", response_model=list[ChannelOut])
def list_channels(
    group_id: Optional[int] = None,
    search: Optional[str] = None,
    favorite: Optional[bool] = None,
    enabled: Optional[bool] = None,
    db: Session = Depends(get_db),
):
    query = db.query(Channel)
    if group_id is not None:
        query = query.filter(Channel.group_id == group_id)
    if favorite is not None:
        query = query.filter(Channel.favorite == favorite)
    if enabled is not None:
        query = query.filter(Channel.enabled == enabled)
    if search:
        q = f"%{search}%"
        query = query.filter(Channel.name.ilike(q) | Channel.normalized_name.ilike(q))
    query = query.order_by(Channel.sort_order, Channel.name)
    return query.all()

# Create channel
@router.post("", response_model=ChannelOut, status_code=201)
def create_channel(channel: ChannelCreate, db: Session = Depends(get_db)):
    data = channel.model_dump()
    data["normalized_name"] = normalize_name(channel.name)
    obj = Channel(**data)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    if obj.epg_assignment_mode == "automatic":
        auto_match_single_channel(obj.id)
    if obj.logo_assignment_mode == "automatic":
        auto_match_logos_single(obj.id)
    db.refresh(obj)
    return obj

# Bulk delete (must be before /{channel_id} to avoid path conflicts)
@router.post("/bulk-delete")
def bulk_delete_channels(payload: BulkDeleteRequest, db: Session = Depends(get_db)):
    with db_write_lock:
        if payload.delete_all:
            deleted = db.query(Channel).count()
            db.query(Channel).delete(synchronize_session=False)
        else:
            if not payload.ids:
                raise HTTPException(400, "No channel IDs provided")
            deleted = db.query(Channel).filter(Channel.id.in_(payload.ids)).delete(synchronize_session=False)
        db.commit()
        return {"ok": True, "deleted": deleted}

# Get single channel
@router.get("/{channel_id}", response_model=ChannelOut)
def get_channel(channel_id: int, db: Session = Depends(get_db)):
    obj = db.get(Channel, channel_id)
    if not obj:
        raise HTTPException(404, "Channel not found")
    return obj

# Update channel
@router.put("/{channel_id}", response_model=ChannelOut)
def update_channel(channel_id: int, channel: ChannelUpdate, db: Session = Depends(get_db)):
    obj = db.get(Channel, channel_id)
    if not obj:
        raise HTTPException(404, "Channel not found")
    data = channel.model_dump()
    data["normalized_name"] = normalize_name(channel.name)
    for key, value in data.items():
        setattr(obj, key, value)
    db.commit()
    if obj.epg_assignment_mode == "automatic":
        auto_match_single_channel(obj.id)
    if obj.logo_assignment_mode == "automatic":
        auto_match_logos_single(obj.id)
    db.refresh(obj)
    return obj

# Delete single channel
@router.delete("/{channel_id}")
def delete_channel(channel_id: int, db: Session = Depends(get_db)):
    obj = db.get(Channel, channel_id)
    if not obj:
        raise HTTPException(404, "Channel not found")
    db.delete(obj)
    db.commit()
    return {"ok": True}

# Toggle favorite
@router.put("/{channel_id}/favorite", response_model=ChannelOut)
def toggle_favorite(channel_id: int, db: Session = Depends(get_db)):
    obj = db.get(Channel, channel_id)
    if not obj:
        raise HTTPException(404, "Channel not found")
    obj.favorite = not obj.favorite
    db.commit()
    db.refresh(obj)
    return obj

# Toggle enabled
@router.put("/{channel_id}/enabled", response_model=ChannelOut)
def toggle_enabled(channel_id: int, db: Session = Depends(get_db)):
    obj = db.get(Channel, channel_id)
    if not obj:
        raise HTTPException(404, "Channel not found")
    obj.enabled = not obj.enabled
    db.commit()
    db.refresh(obj)
    return obj
