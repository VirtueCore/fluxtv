import re
import unicodedata
from difflib import SequenceMatcher

def normalize_name(name: str) -> str:
    if not name:
        return ""
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    name = name.lower()
    name = re.sub(r"\[.*?\]|\(.*?\)", "", name)
    name = re.sub(r"[^a-z0-9\s]", "", name)
    name = re.sub(r"\b(hd|fhd|uhd|4k|sd)\b", "", name)
    name = re.sub(r"\b(us|usa|united states)\b", "", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name

def similarity(a: str, b: str) -> float:
    na = normalize_name(a)
    nb = normalize_name(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    return SequenceMatcher(None, na, nb).ratio()

def epg_confidence(channel_name: str, epg_display_name: str) -> float:
    score = similarity(channel_name, epg_display_name)
    return round(score * 100, 2)
