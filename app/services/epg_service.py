import asyncio
import gzip
import logging
import re
from datetime import datetime, timedelta, timezone
from xml.etree import ElementTree
from zoneinfo import ZoneInfo

import httpx

from ..database import SessionLocal, db_write_lock
from ..models import EPGSource, EPGChannel, EPGProgram, Channel, ChannelEPGMapping
from ..services.matching_service import epg_confidence
from ..config import EPG_RETENTION_DAYS, EPG_SCHEDULER_ENABLED

logger = logging.getLogger("fluxtv.epg")

def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)

def _decompress_if_gzip(content: bytes) -> bytes:
    if content[:2] == b'\x1f\x8b':
        try:
            return gzip.decompress(content)
        except Exception:
            logger.warning("Failed to decompress gzip data; returning raw content")
    return content

def _parse_xmltv(content: bytes) -> tuple[list[dict], list[dict]]:
    root = ElementTree.fromstring(content)
    channels = []
    programmes = []
    for ch in root.findall("channel"):
        channels.append({
            "external_id": ch.get("id", ""),
            "display_name": ch.findtext("display-name", ""),
            "icon_url": ch.findtext("icon", ""),
        })
    for prog in root.findall("programme"):
        programmes.append({
            "channel": prog.get("channel", ""),
            "start": prog.get("start", ""),
            "stop": prog.get("stop", ""),
            "title": prog.findtext("title", ""),
            "subtitle": prog.findtext("sub-title", ""),
            "desc": prog.findtext("desc", ""),
            "category": prog.findtext("category", ""),
            "rating": prog.findtext("rating/value", ""),
            "episode_title": prog.findtext("episode-num", ""),
        })
    return channels, programmes

def _parse_timezone(tz_str: str | None):
    """
    Parse a timezone string into a tzinfo object.
    Supports:
      - IANA names (e.g., "America/New_York")
      - "UTC" or "UTC+0" or "UTC-5" style offsets
    """
    if not tz_str:
        return timezone.utc
    tz_str = tz_str.strip()
    if tz_str.upper() == "UTC":
        return timezone.utc
    # Match UTC±HH:MM or UTC±HH
    m = re.match(r'^UTC([+-])(\d{1,2})(?::(\d{2}))?$', tz_str, re.IGNORECASE)
    if m:
        sign = 1 if m.group(1) == '+' else -1
        hours = int(m.group(2))
        minutes = int(m.group(3) or 0)
        return timezone(timedelta(hours=hours, minutes=minutes) * sign)
    # Try IANA timezone
    try:
        return ZoneInfo(tz_str)
    except Exception:
        logger.warning(f"Invalid timezone '{tz_str}', falling back to UTC")
        return timezone.utc

def _parse_time_with_offset(value: str, tzinfo) -> datetime | None:
    """
    Parse XMLTV time.
    - If explicit offset present, use it.
    - If no offset, use provided tzinfo.
    Returns naive UTC datetime.
    """
    if not value:
        return None

    # ISO format with offset or Z
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=tzinfo)
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    except ValueError:
        pass

    # XMLTV with offset: YYYYMMDDHHMMSS +ZZZZ
    m = re.match(r'^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})$', value.strip())
    if m:
        year, month, day, hour, minute, second, offset = m.groups()
        sign = 1 if offset[0] == '+' else -1
        offset_hours = int(offset[1:3])
        offset_minutes = int(offset[3:5])
        tz = timezone(timedelta(hours=offset_hours, minutes=offset_minutes) * sign)
        dt = datetime(
            int(year), int(month), int(day),
            int(hour), int(minute), int(second),
            tzinfo=tz
        )
        return dt.astimezone(timezone.utc).replace(tzinfo=None)

    # XMLTV without offset: use provided tzinfo
    m = re.match(r'^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$', value.strip())
    if m:
        year, month, day, hour, minute, second = m.groups()
        dt = datetime(int(year), int(month), int(day), int(hour), int(minute), int(second), tzinfo=tzinfo)
        return dt.astimezone(timezone.utc).replace(tzinfo=None)

    return None

def test_source(source: EPGSource) -> tuple[bool, str]:
    try:
        resp = httpx.get(source.url, follow_redirects=True, timeout=15)
        if resp.status_code != 200:
            return False, f"HTTP {resp.status_code}"
        content = _decompress_if_gzip(resp.content)
        _parse_xmltv(content)
        return True, "OK"
    except Exception as exc:
        return False, str(exc)

def cleanup_old_programs(db):
    cutoff = _utcnow() - timedelta(days=EPG_RETENTION_DAYS)
    deleted = db.query(EPGProgram).filter(EPGProgram.end_time < cutoff).delete(synchronize_session=False)
    if deleted:
        logger.info(f"Cleaned up {deleted} old EPG programmes")
    return deleted

def refresh_source(source_id: int) -> bool:
    with db_write_lock:
        db = SessionLocal()
        try:
            source = db.get(EPGSource, source_id)
            if not source:
                return False
            tzinfo = _parse_timezone(source.timezone)
            logger.info(f"Refreshing EPG source {source.name} with timezone/offset {source.timezone or 'UTC'}")
            try:
                resp = httpx.get(source.url, follow_redirects=True, timeout=20)
                resp.raise_for_status()
                content = _decompress_if_gzip(resp.content)
                xml_channels, xml_programmes = _parse_xmltv(content)
            except Exception as exc:
                source.last_error = str(exc)
                db.commit()
                logger.error(f"EPG source {source.name} failed: {exc}")
                return False

            # Clear old data for this source
            existing_channels = db.query(EPGChannel).filter(EPGChannel.epg_source_id == source.id).all()
            for ch in existing_channels:
                db.query(EPGProgram).filter(EPGProgram.epg_channel_id == ch.id).delete()
                db.delete(ch)
            db.commit()

            channel_map: dict[str, int] = {}
            for item in xml_channels:
                norm = item["display_name"].lower().strip()
                epg_channel = EPGChannel(
                    epg_source_id=source.id,
                    external_id=item["external_id"],
                    display_name=item["display_name"],
                    normalized_name=norm,
                    icon_url=item.get("icon_url"),
                    timezone=source.timezone,
                )
                db.add(epg_channel)
                db.flush()
                channel_map[item["external_id"]] = epg_channel.id

            imported_programmes = 0
            for item in xml_programmes:
                epg_channel_id = channel_map.get(item["channel"])
                if not epg_channel_id:
                    continue
                start = _parse_time_with_offset(item["start"], tzinfo)
                end = _parse_time_with_offset(item["stop"], tzinfo)
                if not start or not end:
                    continue
                program = EPGProgram(
                    epg_channel_id=epg_channel_id,
                    start_time=start,
                    end_time=end,
                    title=item["title"],
                    subtitle=item["subtitle"],
                    description=item["desc"],
                    category=item["category"],
                    rating=item["rating"],
                    episode_title=item["episode_title"],
                )
                db.add(program)
                imported_programmes += 1

            source.last_success = _utcnow()
            source.last_updated = _utcnow()
            source.last_error = None
            db.commit()

            cleanup_old_programs(db)
            db.commit()

            logger.info(f"EPG source {source.name}: imported {len(xml_channels)} channels, {imported_programmes} programmes")
            auto_match_all_locked(source.id, db)
            return True
        finally:
            db.close()

def auto_match_all(source_id: int | None = None):
    with db_write_lock:
        db = SessionLocal()
        try:
            auto_match_all_locked(source_id, db)
        finally:
            db.close()

def auto_match_all_locked(source_id: int | None, db):
    query = db.query(Channel).filter(Channel.enabled == True)
    if source_id is not None:
        query = query.filter(Channel.epg_assignment_mode == "automatic", Channel.epg_source_id == source_id)
    else:
        query = query.filter(Channel.epg_assignment_mode != "manual")
    for channel in query.all():
        auto_match_channel(channel.id, db)
        db.commit()

def auto_match_channel(channel_id: int, db=None):
    if db is None:
        raise Exception("auto_match_channel should be called with an active db session inside lock")
    channel = db.get(Channel, channel_id)
    if not channel:
        return None

    if channel.epg_assignment_mode == "manual":
        return None

    db.query(ChannelEPGMapping).filter(
        ChannelEPGMapping.channel_id == channel_id,
        ChannelEPGMapping.assignment_mode.in_(["automatic", "suggested"])
    ).delete(synchronize_session=False)

    candidates = db.query(EPGChannel).all()
    best = None
    best_score = 0.0
    for epg_ch in candidates:
        score = epg_confidence(channel.name, epg_ch.display_name)
        if score > best_score:
            best_score = score
            best = epg_ch

    if best is None:
        return None

    threshold_high = 90.0
    threshold_review = 80.0

    if best_score >= threshold_high:
        channel.epg_assignment_mode = "automatic"
        channel.epg_source_id = best.epg_source_id
        channel.epg_channel_id = best.id
        channel.epg_display_name = best.display_name
        channel.epg_confidence = best_score
        mapping = ChannelEPGMapping(
            channel_id=channel.id,
            epg_source_id=best.epg_source_id,
            epg_channel_id=best.id,
            assignment_mode="automatic",
            confidence=best_score,
        )
        db.add(mapping)
    elif best_score >= threshold_review:
        mapping = ChannelEPGMapping(
            channel_id=channel.id,
            epg_source_id=best.epg_source_id,
            epg_channel_id=best.id,
            assignment_mode="suggested",
            confidence=best_score,
        )
        db.add(mapping)
        channel.epg_confidence = best_score
        if channel.epg_assignment_mode == "automatic":
            channel.epg_assignment_mode = "unassigned"
    return best_score

def auto_match_single_channel(channel_id: int):
    with db_write_lock:
        db = SessionLocal()
        try:
            auto_match_channel(channel_id, db)
            db.commit()
        finally:
            db.close()

def get_current_next_program(epg_channel_id: int, db=None) -> dict | None:
    if db is None:
        db = SessionLocal()
        close_db = True
    else:
        close_db = False
    try:
        now = _utcnow()
        current = db.query(EPGProgram).filter(
            EPGProgram.epg_channel_id == epg_channel_id,
            EPGProgram.start_time <= now,
            EPGProgram.end_time > now,
        ).order_by(EPGProgram.start_time.desc()).first()
        if not current:
            current = db.query(EPGProgram).filter(
                EPGProgram.epg_channel_id == epg_channel_id,
                EPGProgram.start_time <= now,
            ).order_by(EPGProgram.start_time.desc()).first()
        next_program = None
        if current:
            next_program = db.query(EPGProgram).filter(
                EPGProgram.epg_channel_id == epg_channel_id,
                EPGProgram.start_time >= current.end_time,
            ).order_by(EPGProgram.start_time.asc()).first()
        if not current and not next_program:
            return None
        return {
            "current": current,
            "next": next_program,
        }
    finally:
        if close_db:
            db.close()

def epg_scheduler():
    interval_map = {
        "every_15_minutes": 15 * 60,
        "every_30_minutes": 30 * 60,
        "every_hour": 60 * 60,
        "every_6_hours": 6 * 60 * 60,
        "every_12_hours": 12 * 60 * 60,
        "every_24_hours": 24 * 60 * 60,
        "manual_only": None,
    }

    async def _run():
        logger.info("EPG scheduler started")
        while True:
            try:
                db = SessionLocal()
                sources = db.query(EPGSource).filter(EPGSource.enabled == True).all()
                db.close()
                now = _utcnow()
                for source in sources:
                    if source.update_interval == "manual_only":
                        continue
                    seconds = interval_map.get(source.update_interval, 24 * 60 * 60)
                    if seconds is None:
                        continue
                    should_refresh = False
                    if source.last_updated is None:
                        should_refresh = True
                    else:
                        elapsed = (now - source.last_updated).total_seconds()
                        if elapsed >= seconds:
                            should_refresh = True
                    if should_refresh:
                        refresh_source(source.id)
                await asyncio.sleep(60)

                with db_write_lock:
                    db_cleanup = SessionLocal()
                    try:
                        cleanup_old_programs(db_cleanup)
                        db_cleanup.commit()
                    finally:
                        db_cleanup.close()

            except Exception as exc:
                logger.error(f"EPG scheduler error: {exc}")
                await asyncio.sleep(300)

    if not EPG_SCHEDULER_ENABLED:
        logger.info("EPG scheduler disabled by configuration")
        return asyncio.create_task(asyncio.sleep(3600))
    return asyncio.create_task(_run())
