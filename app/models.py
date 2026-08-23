from datetime import datetime, timezone
from sqlalchemy import String, Integer, Boolean, Text, Float, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base

def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)

class Group(Base):
    __tablename__ = "groups"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    channels: Mapped[list["Channel"]] = relationship(back_populates="group")

class Channel(Base):
    __tablename__ = "channels"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(200), index=True)
    group_id: Mapped[int | None] = mapped_column(ForeignKey("groups.id"), nullable=True)
    embed_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    alternate_logo_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    logo_source: Mapped[str | None] = mapped_column(String(100), nullable=True)
    logo_assignment_mode: Mapped[str] = mapped_column(String(20), default="manual")  # manual/automatic/none
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    epg_source_id: Mapped[int | None] = mapped_column(ForeignKey("epg_sources.id"), nullable=True)
    epg_channel_id: Mapped[int | None] = mapped_column(ForeignKey("epg_channels.id"), nullable=True)
    epg_display_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    epg_assignment_mode: Mapped[str] = mapped_column(String(20), default="unassigned")  # manual/automatic/unassigned
    epg_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    timezone: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    group: Mapped[Group | None] = relationship(back_populates="channels")
    epg_mappings: Mapped[list["ChannelEPGMapping"]] = relationship(back_populates="channel", cascade="all, delete-orphan")

class EPGSource(Base):
    __tablename__ = "epg_sources"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    source_type: Mapped[str] = mapped_column(String(50), default="xmltv")
    format: Mapped[str] = mapped_column(String(50), default="xml")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    update_interval: Mapped[str] = mapped_column(String(50), default="every_24_hours")
    timezone: Mapped[str | None] = mapped_column(String(100), nullable=True)
    last_updated: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_success: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

class EPGChannel(Base):
    __tablename__ = "epg_channels"
    id: Mapped[int] = mapped_column(primary_key=True)
    epg_source_id: Mapped[int] = mapped_column(ForeignKey("epg_sources.id"), nullable=False)
    external_id: Mapped[str] = mapped_column(String(200), nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(200), index=True)
    icon_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    language: Mapped[str | None] = mapped_column(String(20), nullable=True)
    country: Mapped[str | None] = mapped_column(String(50), nullable=True)
    timezone: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

class EPGProgram(Base):
    __tablename__ = "epg_programs"
    id: Mapped[int] = mapped_column(primary_key=True)
    epg_channel_id: Mapped[int] = mapped_column(ForeignKey("epg_channels.id"), nullable=False, index=True)
    start_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    end_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    subtitle: Mapped[str | None] = mapped_column(String(500), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str | None] = mapped_column(String(200), nullable=True)
    rating: Mapped[str | None] = mapped_column(String(50), nullable=True)
    episode_title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    season: Mapped[int | None] = mapped_column(Integer, nullable=True)
    episode: Mapped[int | None] = mapped_column(Integer, nullable=True)

class ChannelEPGMapping(Base):
    __tablename__ = "channel_epg_mappings"
    id: Mapped[int] = mapped_column(primary_key=True)
    channel_id: Mapped[int] = mapped_column(ForeignKey("channels.id"), nullable=False, index=True)
    epg_source_id: Mapped[int] = mapped_column(ForeignKey("epg_sources.id"), nullable=False)
    epg_channel_id: Mapped[int] = mapped_column(ForeignKey("epg_channels.id"), nullable=False)
    assignment_mode: Mapped[str] = mapped_column(String(20), default="suggested")  # manual/automatic/suggested/rejected
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    channel: Mapped[Channel] = relationship(back_populates="epg_mappings")

class LogoSource(Base):
    __tablename__ = "logo_sources"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    source_type: Mapped[str] = mapped_column(String(50), default="json_map")
    url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

class LogoEntry(Base):
    __tablename__ = "logo_entries"
    id: Mapped[int] = mapped_column(primary_key=True)
    logo_source_id: Mapped[int] = mapped_column(ForeignKey("logo_sources.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(200), index=True)
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

class LogoSuggestion(Base):
    __tablename__ = "logo_suggestions"
    id: Mapped[int] = mapped_column(primary_key=True)
    channel_id: Mapped[int] = mapped_column(ForeignKey("channels.id"), nullable=False, index=True)
    logo_source_id: Mapped[int | None] = mapped_column(ForeignKey("logo_sources.id"), nullable=True)
    logo_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending/accepted/rejected
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(String(500), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
