from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Group, Channel
from ..schemas import GroupCreate, GroupUpdate, GroupOut

router = APIRouter(prefix="/api/groups", tags=["groups"])

@router.get("", response_model=list[GroupOut])
def list_groups(db: Session = Depends(get_db)):
    return db.query(Group).order_by(Group.sort_order, Group.name).all()

@router.post("", response_model=GroupOut, status_code=201)
def create_group(group: GroupCreate, db: Session = Depends(get_db)):
    exists = db.query(Group).filter(Group.name == group.name).first()
    if exists:
        raise HTTPException(409, "Group already exists")
    obj = Group(**group.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj

@router.get("/{group_id}", response_model=GroupOut)
def get_group(group_id: int, db: Session = Depends(get_db)):
    obj = db.get(Group, group_id)
    if not obj:
        raise HTTPException(404, "Group not found")
    return obj

@router.put("/{group_id}", response_model=GroupOut)
def update_group(group_id: int, group: GroupUpdate, db: Session = Depends(get_db)):
    obj = db.get(Group, group_id)
    if not obj:
        raise HTTPException(404, "Group not found")
    for key, value in group.model_dump().items():
        setattr(obj, key, value)
    db.commit()
    db.refresh(obj)
    return obj

@router.delete("/{group_id}")
def delete_group(group_id: int, db: Session = Depends(get_db)):
    obj = db.get(Group, group_id)
    if not obj:
        raise HTTPException(404, "Group not found")
    channels_count = db.query(Channel).filter(Channel.group_id == group_id).count()
    if channels_count > 0:
        raise HTTPException(409, "Group contains channels. Move them first.")
    db.delete(obj)
    db.commit()
    return {"ok": True}
