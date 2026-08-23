from pydantic import BaseModel, Field, field_validator
from datetime import datetime
from typing import Optional

def validate_http_url(v):
    if v and not v.startswith(("http://", "https://")):
        raise ValueError("URL must start with http:// or https://")
    return v

def validate_safe_url(v):
    """Allow any URL except dangerous schemes."""
    if v and v.lower().startswith(("javascript:", "data:", "file:")):
        raise ValueError("Invalid URL scheme")
    return v

class GroupBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    sort_order: int = 0

class GroupCreate(GroupBase):
    pass

class GroupUpdate(GroupBase):
    pass

class GroupOut(GroupBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class ChannelBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    group_id: Optional[int] = None
    embed_url: Optional[str] = None
    logo_url: Optional[str] = None
    alternate_logo_url: Optional[str] = None
    logo_source: Optional[str] = None
    logo_assignment_mode: str = "manual"
    description: Optional[str] = None
    enabled: bool = True
    favorite: bool = False
    sort_order: int = 0
    epg_source_id: Optional[int] = None
    epg_channel_id: Optional[int] = None
    epg_display_name: Optional[str] = None
    epg_assignment_mode: str = "unassigned"
    epg_confidence: Optional[float] = None
    timezone: Optional[str] = None

    @field_validator("embed_url")
    @classmethod
    def validate_embed_url(cls, v):
        return validate_http_url(v)

    @field_validator("logo_url", "alternate_logo_url")
    @classmethod
    def validate_logo_url(cls, v):
        return validate_safe_url(v)

class ChannelCreate(ChannelBase):
    pass

class ChannelUpdate(ChannelBase):
    pass

class ChannelOut(ChannelBase):
    id: int
    created_at: datetime
    updated_at: datetime
    group: Optional[GroupOut] = None

    class Config:
        from_attributes = True

class EPGSourceBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    url: str
    source_type: str = "xmltv"
    format: str = "xml"
    enabled: bool = True
    priority: int = 0
    update_interval: str = "every_24_hours"
    timezone: Optional[str] = None

    @field_validator("url")
    @classmethod
    def validate_url(cls, v):
        return validate_http_url(v)

class EPGSourceCreate(EPGSourceBase):
    pass

class EPGSourceUpdate(EPGSourceBase):
    pass

class EPGSourceOut(EPGSourceBase):
    id: int
    last_updated: Optional[datetime] = None
    last_success: Optional[datetime] = None
    last_error: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class EPGChannelOut(BaseModel):
    id: int
    epg_source_id: int
    external_id: str
    display_name: str
    normalized_name: str
    icon_url: Optional[str] = None
    language: Optional[str] = None
    country: Optional[str] = None
    timezone: Optional[str] = None

    class Config:
        from_attributes = True

class EPGMappingBase(BaseModel):
    channel_id: int
    epg_source_id: int
    epg_channel_id: int
    assignment_mode: str = "manual"
    confidence: Optional[float] = None

class EPGMappingCreate(EPGMappingBase):
    pass

class EPGMappingUpdate(EPGMappingBase):
    pass

class EPGMappingOut(EPGMappingBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class LogoSourceBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    source_type: str = "json_map"
    url: Optional[str] = None
    enabled: bool = True
    priority: int = 0

    @field_validator("url")
    @classmethod
    def validate_url(cls, v):
        if v and v.lower().startswith(("javascript:", "data:", "file:")):
            raise ValueError("Invalid URL scheme")
        return v

class LogoSourceCreate(LogoSourceBase):
    pass

class LogoSourceUpdate(LogoSourceBase):
    pass

class LogoSourceOut(LogoSourceBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class LogoEntryOut(BaseModel):
    id: int
    logo_source_id: int
    name: str
    normalized_name: str
    url: str
    priority: int
    created_at: datetime

    class Config:
        from_attributes = True

class ImportRow(BaseModel):
    name: str
    group: Optional[str] = None
    embed_url: Optional[str] = None
    logo_url: Optional[str] = None
    description: Optional[str] = None
    epg_source: Optional[str] = None
    epg_channel_id: Optional[str] = None
    epg_display_name: Optional[str] = None
    epg_assignment_mode: Optional[str] = None
    logo_assignment_mode: Optional[str] = None
    favorite: Optional[bool] = False
    enabled: Optional[bool] = True
    sort_order: Optional[int] = 0

class ImportResult(BaseModel):
    imported: int = 0
    updated: int = 0
    skipped: int = 0
    failed: int = 0
    errors: list[str] = []

class SettingOut(BaseModel):
    key: str
    value: str

class SettingsUpdate(BaseModel):
    settings: dict[str, str]
