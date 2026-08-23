import logging
import json
import httpx
from urllib.parse import urljoin
from difflib import SequenceMatcher
from ..database import SessionLocal, db_write_lock
from ..models import LogoSource, LogoEntry, Channel, LogoSuggestion
from ..services.matching_service import normalize_name, similarity

logger = logging.getLogger("fluxtv.logo")

def _looks_like_url(value):
    if not isinstance(value, str):
        return False
    v = value.lower().strip()
    return v.startswith(("http://", "https://", "/", "./", "../")) or v.endswith((".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"))

def _guess_name(item):
    if isinstance(item, dict):
        for key in ("name", "channel", "channel_name", "title", "display_name", "id"):
            if key in item and item[key]:
                return str(item[key])
    return None

def _guess_url(item):
    if isinstance(item, dict):
        for key in ("url", "logo", "logo_url", "image", "img", "path", "logo_path", "icon", "icon_url"):
            if key in item and item[key]:
                value = item[key]
                if isinstance(value, str) and _looks_like_url(value):
                    return value
                if isinstance(value, dict):
                    for subkey in ("url", "logo", "path", "src"):
                        if subkey in value and value[subkey]:
                            return str(value[subkey])
        for key, value in item.items():
            if isinstance(value, str) and _looks_like_url(value):
                return value
    elif isinstance(item, str):
        return item if _looks_like_url(item) else None
    return None

def _extract_entries(data):
    entries = []

    if isinstance(data, list):
        for item in data:
            name = _guess_name(item)
            url = _guess_url(item)
            if name and url:
                entries.append({"name": name, "url": url, "priority": len(entries)})

    elif isinstance(data, dict):
        for key in ("entries", "channels", "logos", "data"):
            if key in data and isinstance(data[key], (list, dict)):
                entries.extend(_extract_entries(data[key]))
                if entries:
                    return entries

        for key, value in data.items():
            if isinstance(value, str):
                if _looks_like_url(value):
                    entries.append({"name": key, "url": value, "priority": len(entries)})
            elif isinstance(value, dict):
                name = _guess_name(value) or key
                url = _guess_url(value)
                if url:
                    entries.append({"name": name, "url": url, "priority": len(entries)})
            elif isinstance(value, list):
                pass

    return entries

def _load_source_data(source: LogoSource):
    if source.source_type == "local_file":
        with open(source.url, "r", encoding="utf-8") as f:
            return json.load(f)
    else:
        resp = httpx.get(source.url, follow_redirects=True, timeout=15)
        resp.raise_for_status()
        return resp.json()

def parse_github_tree_url(url: str):
    import re
    m = re.match(r'https?://github\.com/([^/]+)/([^/]+)/tree/([^/]+)/(.+)', url)
    if not m:
        return None
    owner, repo, branch, path = m.groups()
    return owner, repo, branch, path

def fetch_github_directory(source: LogoSource) -> list[dict]:
    parsed = parse_github_tree_url(source.url)
    if not parsed:
        raise ValueError("Invalid GitHub tree URL")
    owner, repo, branch, path = parsed
    api_url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={branch}"
    resp = httpx.get(api_url, follow_redirects=True, timeout=15)
    resp.raise_for_status()
    items = resp.json()
    entries = []
    for item in items:
        if item.get('type') != 'file':
            continue
        name = item.get('name', '')
        if not name.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp')):
            continue
        raw_url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}/{name}"
        entries.append({
            "name": name.rsplit('.', 1)[0],
            "url": raw_url,
            "priority": 0,
        })
    return entries

def refresh_logo_source(source_id: int) -> bool:
    with db_write_lock:
        db = SessionLocal()
        try:
            source = db.get(LogoSource, source_id)
            if not source:
                return False
            if source.source_type == "github_dir":
                fetch_github_directory(source)
                logger.info(f"Logo source {source.name}: GitHub directory validated")
                return True
            data = _load_source_data(source)
            entries = _extract_entries(data)
            logger.info(f"Logo source {source.name}: parsed {len(entries)} raw entries")
            if not entries:
                sample = json.dumps(data, indent=2)[:500]
                logger.error(f"Logo source {source.name}: could not parse. Sample:\n{sample}")
            else:
                logger.info(f"First entry sample: {entries[0]}")
            db.query(LogoEntry).filter(LogoEntry.logo_source_id == source.id).delete()
            for item in entries:
                if source.source_type == "local_file":
                    full_url = item["url"]
                else:
                    full_url = urljoin(source.url, item["url"])
                entry = LogoEntry(
                    logo_source_id=source.id,
                    name=item["name"],
                    normalized_name=normalize_name(item["name"]),
                    url=full_url,
                    priority=item.get("priority", 0),
                )
                db.add(entry)
            db.commit()
            logger.info(f"Logo source {source.name}: imported {len(entries)} entries")
            return True
        except Exception as exc:
            logger.error(f"Logo source {source_id} refresh failed: {exc}")
            return False
        finally:
            db.close()

def _get_all_logo_entries(db):
    """
    Returns combined list of logo entries from static DB entries and live GitHub directories.
    """
    entries = list(db.query(LogoEntry).all())
    sources = db.query(LogoSource).filter(LogoSource.enabled == True, LogoSource.source_type == "github_dir").all()
    for source in sources:
        try:
            live_entries = fetch_github_directory(source)
            for e in live_entries:
                entries.append(LogoEntry(
                    id=0,  # placeholder for live entries
                    logo_source_id=source.id,
                    name=e["name"],
                    normalized_name=normalize_name(e["name"]),
                    url=e["url"],
                    priority=0,
                ))
        except Exception as e:
            logger.warning(f"Failed to fetch GitHub directory source {source.name}: {e}")
    return entries

def _find_best_match(channel_name, entries):
    channel_norm = normalize_name(channel_name)
    for entry in entries:
        if entry.normalized_name == channel_norm:
            return entry, 1.0
    best = None
    best_score = 0.0
    for entry in entries:
        score = similarity(channel_name, entry.name)
        if score > best_score:
            best_score = score
            best = entry
    return best, best_score

def auto_match_logos(channel_id: int | None = None):
    with db_write_lock:
        db = SessionLocal()
        try:
            channels = db.query(Channel).filter(Channel.enabled == True)
            if channel_id:
                channels = channels.filter(Channel.id == channel_id)
            entries = _get_all_logo_entries(db)
            logger.info(f"Auto-match logos: {len(entries)} logo entries available (including GitHub dirs)")
            auto_assigned = 0
            suggestions = 0
            manual_skipped = 0
            unmatched = 0
            unmatched_samples = []
            for channel in channels:
                if channel.logo_assignment_mode == "manual":
                    manual_skipped += 1
                    continue
                db.query(LogoSuggestion).filter(
                    LogoSuggestion.channel_id == channel.id,
                    LogoSuggestion.status == "pending"
                ).delete()
                best_entry, best_score = _find_best_match(channel.name, entries)
                if best_entry is None:
                    unmatched += 1
                    continue
                if best_score >= 0.90:
                    channel.logo_url = best_entry.url
                    channel.logo_source = str(best_entry.logo_source_id)
                    channel.logo_assignment_mode = "automatic"
                    auto_assigned += 1
                elif best_score >= 0.70:
                    suggestion = LogoSuggestion(
                        channel_id=channel.id,
                        logo_source_id=best_entry.logo_source_id,
                        logo_url=best_entry.url,
                        name=best_entry.name,
                        confidence=best_score * 100,
                        status="pending",
                    )
                    db.add(suggestion)
                    suggestions += 1
                else:
                    unmatched += 1
                    if len(unmatched_samples) < 5:
                        unmatched_samples.append(f"{channel.name} (best: {best_entry.name}, score: {best_score:.2f})")
            db.commit()
            logger.info(
                f"Auto-match summary: {auto_assigned} auto-assigned, {suggestions} suggestions, "
                f"{manual_skipped} manual skipped, {unmatched} unmatched"
            )
            if unmatched_samples:
                logger.info(f"Unmatched samples: {unmatched_samples}")
        finally:
            db.close()

def force_match_all_logos(replace: bool = False):
    with db_write_lock:
        db = SessionLocal()
        try:
            entries = _get_all_logo_entries(db)
            if not entries:
                return 0
            query = db.query(Channel).filter(Channel.enabled == True)
            if not replace:
                query = query.filter(Channel.logo_url == None)
            channels = query.all()
            assigned = 0
            for channel in channels:
                if not replace and channel.logo_assignment_mode == "manual":
                    continue
                best_entry, best_score = _find_best_match(channel.name, entries)
                if best_entry:
                    channel.logo_url = best_entry.url
                    channel.logo_source = str(best_entry.logo_source_id)
                    channel.logo_assignment_mode = "automatic"
                    assigned += 1
            db.commit()
            logger.info(f"Force match: assigned {assigned} logos (replace={replace})")
            return assigned
        finally:
            db.close()

def auto_match_logos_single(channel_id: int):
    with db_write_lock:
        db = SessionLocal()
        try:
            channel = db.get(Channel, channel_id)
            if not channel or channel.logo_assignment_mode == "manual":
                return
            entries = _get_all_logo_entries(db)
            db.query(LogoSuggestion).filter(
                LogoSuggestion.channel_id == channel.id,
                LogoSuggestion.status == "pending"
            ).delete()
            best_entry, best_score = _find_best_match(channel.name, entries)
            if best_entry is None:
                return
            if best_score >= 0.90:
                channel.logo_url = best_entry.url
                channel.logo_source = str(best_entry.logo_source_id)
                channel.logo_assignment_mode = "automatic"
            elif best_score >= 0.70:
                suggestion = LogoSuggestion(
                    channel_id=channel.id,
                    logo_source_id=best_entry.logo_source_id,
                    logo_url=best_entry.url,
                    name=best_entry.name,
                    confidence=best_score * 100,
                    status="pending",
                )
                db.add(suggestion)
            db.commit()
        finally:
            db.close()
