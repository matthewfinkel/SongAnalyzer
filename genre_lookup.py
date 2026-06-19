"""Genre detection via Acoustid fingerprinting + MusicBrainz tags.

Requires:
  - fpcalc binary: brew install chromaprint
  - ACOUSTID_API_KEY in .env file or environment
"""

import json
import os
from pathlib import Path
import subprocess
import urllib.parse
import urllib.request

# Project root is the directory containing this file
_PROJECT_ROOT = Path(__file__).parent
_ENV_FILE = _PROJECT_ROOT / ".env"


def _load_env_file():
    """Load key=value pairs from .env into os.environ (won't overwrite existing vars)."""
    if not _ENV_FILE.exists():
        return
    for line in _ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_env_file()

_ACOUSTID_URL = "https://api.acoustid.org/v2/lookup"
_MB_URL = "https://musicbrainz.org/ws/2"
_MB_HEADERS = {"User-Agent": "AudioAnalyzer/1.0 (matthewf9236@gmail.com)"}

# Broad genre categories used for similarity comparison.
# Raw MusicBrainz tags are mapped into these buckets.
GENRE_VOCAB = [
    "rock", "pop", "electronic", "hip-hop", "jazz", "classical",
    "folk", "metal", "soul", "progressive", "blues", "country",
    "punk", "ambient", "reggae", "latin", "funk", "r&b", "indie",
]

# Raw tag strings → canonical genre vocab entry.
# Entries are matched by substring (longest match wins).
_TAG_MAP = {
    "progressive rock":   "progressive",
    "prog rock":          "progressive",
    "art rock":           "progressive",
    "classic rock":       "rock",
    "hard rock":          "rock",
    "soft rock":          "rock",
    "alternative rock":   "rock",
    "indie rock":         "rock",
    "psychedelic rock":   "rock",
    "blues rock":         "blues",
    "folk rock":          "folk",
    "country rock":       "country",
    "punk rock":          "punk",
    "new wave":           "punk",
    "post-punk":          "punk",
    "heavy metal":        "metal",
    "death metal":        "metal",
    "progressive metal":  "metal",
    "hip hop":            "hip-hop",
    "hip-hop":            "hip-hop",
    "rap":                "hip-hop",
    "trap":               "hip-hop",
    "electronica":        "electronic",
    "synth-pop":          "electronic",
    "edm":                "electronic",
    "dance":              "electronic",
    "house":              "electronic",
    "techno":             "electronic",
    "ambient":            "ambient",
    "new age":            "ambient",
    "bossa nova":         "latin",
    "salsa":              "latin",
    "ska":                "reggae",
    "dub":                "reggae",
    "motown":             "soul",
    "funk":               "funk",
    "r&b":                "r&b",
    "rnb":                "r&b",
    "rhythm and blues":   "r&b",
    "singer-songwriter":  "folk",
    "acoustic":           "folk",
    "indie pop":          "indie",
    "indie folk":         "indie",
    "jazz rock":          "jazz",
    "jazz fusion":        "jazz",
}


def _normalize_tags(raw_tags: list[str]) -> list[str]:
    """Map raw MusicBrainz tag strings to canonical genre vocab entries."""
    found = set()
    for tag in raw_tags:
        t = tag.lower().strip()
        if t in _TAG_MAP:
            found.add(_TAG_MAP[t])
        elif t in GENRE_VOCAB:
            found.add(t)
        else:
            # Partial match: check if any vocab word is a substring
            for vocab in GENRE_VOCAB:
                if vocab in t:
                    found.add(vocab)
                    break
    return sorted(found)


def _run_fpcalc(file_path: str):
    """Return (duration_float, fingerprint_str) or (None, None)."""
    try:
        result = subprocess.run(
            ["fpcalc", "-json", file_path],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            return None, None
        data = json.loads(result.stdout)
        return data.get("duration"), data.get("fingerprint")
    except FileNotFoundError:
        return None, None
    except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError):
        return None, None


def _acoustid_lookup(api_key: str, duration: float, fingerprint: str):
    """Return (recording_ids, release_group_ids) from the best Acoustid match."""
    params = urllib.parse.urlencode({
        "client":      api_key,
        "duration":    int(duration),
        "fingerprint": fingerprint,
        "meta":        "recordings releasegroups",
    })
    try:
        with urllib.request.urlopen(f"{_ACOUSTID_URL}?{params}", timeout=10) as r:
            data = json.loads(r.read())
        if data.get("status") != "ok":
            return [], []
        results = data.get("results", [])
        if not results:
            return [], []
        best = max(results, key=lambda x: x.get("score", 0))
        if best.get("score", 0) < 0.5:
            return [], []
        recording_ids = [rec["id"] for rec in best.get("recordings", [])]
        rg_ids = [rg["id"] for rec in best.get("recordings", [])
                  for rg in rec.get("releasegroups", [])]
        return recording_ids, rg_ids
    except Exception:
        return [], []


def _mb_tags_for(entity: str, mb_id: str) -> list[str]:
    """Fetch genre + tag names from MusicBrainz for a recording or release-group ID."""
    url = f"{_MB_URL}/{entity}/{mb_id}?inc=genres+tags&fmt=json"
    try:
        req = urllib.request.Request(url, headers=_MB_HEADERS)
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())
        genres = [g["name"] for g in data.get("genres", [])]
        tags   = [t["name"] for t in data.get("tags", []) if t.get("count", 0) > 0]
        return list(set(genres + tags))
    except Exception:
        return []


def fetch_genres(file_path: str, api_key: str | None = None) -> list[str]:
    """Return canonical genre strings for this audio file.

    Queries recording-level tags first, then release-group tags if the
    recording has none — release groups are much more thoroughly tagged
    in MusicBrainz.
    Returns empty list (no error) on any failure.
    """
    if not api_key:
        api_key = os.environ.get("ACOUSTID_API_KEY", "")
    if not api_key:
        return []

    duration, fingerprint = _run_fpcalc(file_path)
    if not duration or not fingerprint:
        return []

    recording_ids, rg_ids = _acoustid_lookup(api_key, duration, fingerprint)
    if not recording_ids and not rg_ids:
        return []

    raw: list[str] = []

    # Try recording-level tags first
    if recording_ids:
        raw = _mb_tags_for("recording", recording_ids[0])

    # Fall back to release-group tags (much better coverage)
    if not raw and rg_ids:
        for rg_id in rg_ids[:3]:
            raw = _mb_tags_for("release-group", rg_id)
            if raw:
                break

    return _normalize_tags(raw)


def genre_similarity(genres_a: list[str], genres_b: list[str]) -> float:
    """Jaccard similarity over canonical genre sets. Returns 1.0 if either is unknown."""
    a, b = set(genres_a), set(genres_b)
    if not a or not b:
        return 1.0  # unknown genre → no penalty
    intersection = len(a & b)
    union = len(a | b)
    return intersection / union if union > 0 else 0.0


def blend_with_genre(acoustic_sim: float, genres_a: list[str], genres_b: list[str]) -> float:
    """Apply genre as a similarity modifier capped at 20% influence.

    Same genre:        modifier = 1.00  (no change)
    No overlap:        modifier = 0.80  (20% reduction)
    Either unknown:    modifier = 1.00  (no change)
    """
    g_sim = genre_similarity(genres_a, genres_b)
    modifier = 0.80 + 0.20 * g_sim
    return acoustic_sim * modifier
