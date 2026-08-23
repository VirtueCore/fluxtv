from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Setting
from ..schemas import SettingsUpdate

router = APIRouter(prefix="/api/settings", tags=["settings"])

DEFAULTS = {
    "default_timezone": "America/New_York",
    "epg_auto_match_enabled": "true",
    "logo_auto_match_enabled": "true",
    "epg_confidence_high": "95",
    "epg_confidence_review": "80",
    "logo_confidence_high": "95",
    "logo_confidence_review": "80",
    "theme": "dark",
}

@router.get("")
def get_settings(db: Session = Depends(get_db)):
    settings = db.query(Setting).all()
    result = dict(DEFAULTS)
    for s in settings:
        result[s.key] = s.value
    return result

@router.put("")
def update_settings(payload: SettingsUpdate, db: Session = Depends(get_db)):
    for key, value in payload.settings.items():
        setting = db.query(Setting).filter(Setting.key == key).first()
        if setting:
            setting.value = value
        else:
            db.add(Setting(key=key, value=value))
    db.commit()
    return {"ok": True}
