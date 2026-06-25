"""Genre detection via Acoustid fingerprinting + MusicBrainz tags.

Requires:
  - fpcalc binary: brew install chromaprint
  - ACOUSTID_API_KEY in .env file or environment
"""

import json
import os
from pathlib import Path
import re
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

# Canonical genre vocabulary — must match the names in sql/seed_genres.sql
# (stored as lowercase in songs.genres; the seed file has Title Case for display).
GENRE_VOCAB = [
    "alternative", "ambient", "blues", "classical", "country", "disco",
    "drum & bass", "dubstep", "edm", "electronic", "emo", "folk", "funk",
    "gospel", "grunge", "hardcore", "hip-hop", "house", "indie", "jazz",
    "latin", "metal", "new wave", "opera", "pop", "post-rock", "progressive",
    "psychedelic", "punk", "r&b", "reggae", "rock", "singer-songwriter",
    "ska", "soul", "synth-pop", "techno", "trance", "trap", "world",
]

# Lower-case lookup → vocab entry (for case-insensitive exact matching)
_VOCAB_SET = set(GENRE_VOCAB)

# Raw MusicBrainz tag strings → canonical GENRE_VOCAB entry.
# Keys are lower-cased. Longer/more-specific keys take priority (matched longest-first).
_TAG_MAP: dict[str, str] = {
    # --- Electronic subgenres (most important to get right) ---
    "house music":            "house",
    "deep house":             "house",
    "progressive house":      "house",
    "tech house":             "house",
    "tropical house":         "house",
    "future house":           "house",
    "electro house":          "house",
    "chicago house":          "house",
    "techno music":           "techno",
    "progressive trance":     "trance",
    "psytrance":              "trance",
    "psy-trance":             "trance",
    "uplifting trance":       "trance",
    "vocal trance":           "trance",
    "drum and bass":          "drum & bass",
    "drum & bass":            "drum & bass",
    "d'n'b":                  "drum & bass",
    "dnb":                    "drum & bass",
    "brostep":                "dubstep",
    "electro-pop":            "synth-pop",
    "electropop":             "synth-pop",
    "electro pop":            "synth-pop",
    "synth pop":              "synth-pop",
    "synthpop":               "synth-pop",
    "electronic dance music": "edm",
    "dance music":            "edm",
    "dance-pop":              "pop",
    "eurodance":              "edm",
    "club music":             "edm",
    "electronica":            "electronic",
    "electronic music":       "electronic",
    "idm":                    "electronic",
    "intelligent dance music":"electronic",
    "ambient electronic":     "ambient",
    "ambient music":          "ambient",
    "chillout":               "ambient",
    "chillwave":              "ambient",
    "new age":                "ambient",
    "nu-disco":               "disco",
    "nu disco":               "disco",
    # --- Rock subgenres ---
    "alternative rock":       "alternative",
    "indie rock":             "indie",
    "post-punk":              "punk",
    "pop punk":               "punk",
    "punk rock":              "punk",
    "hardcore punk":          "hardcore",
    "progressive rock":       "progressive",
    "prog rock":              "progressive",
    "progressive metal":      "metal",
    "art rock":               "progressive",
    "psychedelic rock":       "psychedelic",
    "blues rock":             "blues",
    "folk rock":              "folk",
    "country rock":           "country",
    "classic rock":           "rock",
    "hard rock":              "rock",
    "soft rock":              "rock",
    "glam rock":              "rock",
    "garage rock":            "rock",
    "post-rock":              "post-rock",
    "shoegaze":               "indie",
    "dream pop":              "indie",
    "dream-pop":              "indie",
    "indie pop":              "indie",
    "indie folk":             "indie",
    # --- Metal ---
    "heavy metal":            "metal",
    "death metal":            "metal",
    "black metal":            "metal",
    "thrash metal":           "metal",
    "power metal":            "metal",
    "doom metal":             "metal",
    "metalcore":              "metal",
    "nu-metal":               "metal",
    # --- Hip-hop ---
    "hip hop":                "hip-hop",
    "trap music":             "trap",
    "gangsta rap":            "hip-hop",
    "boom bap":               "hip-hop",
    "grime":                  "hip-hop",
    "drill":                  "hip-hop",
    # --- Soul / R&B ---
    "rhythm and blues":       "r&b",
    "rnb":                    "r&b",
    "neo soul":               "soul",
    "soul music":             "soul",
    "motown":                 "soul",
    "gospel music":           "gospel",
    "funk music":             "funk",
    # --- Jazz ---
    "jazz rock":              "jazz",
    "jazz fusion":            "jazz",
    "smooth jazz":            "jazz",
    "bebop":                  "jazz",
    "big band":               "jazz",
    "swing":                  "jazz",
    # --- Folk / Country ---
    "singer-songwriter":      "singer-songwriter",
    "singer/songwriter":      "singer-songwriter",
    "americana":              "country",
    "bluegrass":              "folk",
    "acoustic":               "folk",
    # --- Latin ---
    "latin pop":              "latin",
    "bossa nova":             "latin",
    "salsa":                  "latin",
    "samba":                  "latin",
    "reggaeton":              "latin",
    "cumbia":                 "latin",
    # --- Reggae / Ska ---
    "dub":                    "reggae",
    "dancehall":              "reggae",
    "ska":                    "ska",
    "rocksteady":             "reggae",
    # --- Other ---
    "world music":            "world",
    "classical music":        "classical",
    "new wave":               "new wave",
    "grunge":                 "grunge",
    "emo":                    "emo",
    # Simple single-word aliases that differ from vocab key
    "rap":                    "hip-hop",
    "trap":                   "trap",
    "house":                  "house",
    "techno":                 "techno",
    "trance":                 "trance",
    "dubstep":                "dubstep",
    "disco":                  "disco",
    "funk":                   "funk",
    "punk":                   "punk",
    "dance":                  "edm",
    "club":                   "edm",
    "edm":                    "edm",
    "electronic":             "electronic",
    "ambient":                "ambient",
    "blues":                  "blues",
    "jazz":                   "jazz",
    "folk":                   "folk",
    "country":                "country",
    "gospel":                 "gospel",
    "soul":                   "soul",
    "reggae":                 "reggae",
    "metal":                  "metal",
    "rock":                   "rock",
    "pop":                    "pop",
    "classical":              "classical",
    "opera":                  "opera",
    "latin":                  "latin",
    "world":                  "world",
    "hardcore":               "hardcore",
    "alternative":            "alternative",
    "indie":                  "indie",
    "grunge":                 "grunge",
    "trap":                   "trap",
    "emo":                    "emo",
}

# Sorted by key length descending so longer / more specific keys match first
_TAG_MAP_SORTED = sorted(_TAG_MAP.items(), key=lambda kv: len(kv[0]), reverse=True)

# YouTube IDs appear as [abc123] at the end (5-15 alphanumeric chars)
_YT_ID = re.compile(r'\s*\[[A-Za-z0-9_-]{5,15}\]\s*$')

# Parenthetical suffixes that don't help identify the song
_JUNK_PARENS = re.compile(
    r'\s*\('
    r'(?:official\s+(?:music\s+)?(?:video|audio|lyric\s+video|visuali[sz]er)|'
    r'lyrics?|audio|hd|hq|4k|'
    r'extended\s+(?:mix|version|edit)|'
    r'radio\s+(?:mix|edit|version)|'
    r'(?:single|album)\s+version|'
    r'remastered?(?:\s+\d{4})?|'
    r'topic'
    r')\s*\)',
    re.IGNORECASE,
)


def _normalize_tags(raw_tags: list[str]) -> list[str]:
    """Map raw MusicBrainz tag strings to canonical genre vocab entries."""
    found: set[str] = set()
    for tag in raw_tags:
        t = tag.lower().strip()
        if not t:
            continue

        # 1. Check TAG_MAP (longest key first = most specific match wins)
        matched = False
        for key, genre in _TAG_MAP_SORTED:
            if key == t or key in t:
                found.add(genre)
                matched = True
                break

        if matched:
            continue

        # 2. Exact match against vocab (catches entries not in TAG_MAP)
        if t in _VOCAB_SET:
            found.add(t)
            continue

        # 3. Word-boundary search for a vocab term inside the tag
        for vocab in GENRE_VOCAB:
            if re.search(r'\b' + re.escape(vocab) + r'\b', t):
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
        if best.get("score", 0) < 0.80:
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


def _parse_title_for_search(raw_title: str) -> tuple[str, str]:
    """Return (artist, song_title) parsed from a raw file stem."""
    title = _YT_ID.sub("", raw_title).strip()
    title = _JUNK_PARENS.sub("", title).strip()

    artist = ""
    if " - " in title:
        artist, _, title = title.partition(" - ")
        artist = artist.strip()
        title = _JUNK_PARENS.sub("", title).strip()

    return artist, title


def _mb_search_by_title(song_title: str, artist: str = "") -> list[str]:
    """Search MusicBrainz recordings by title (+ optional artist) for genre tags."""
    if not song_title.strip():
        return []

    def _escape(s: str) -> str:
        return re.sub(r'[+\-&|!(){}\[\]^"~*?:\\]', ' ', s).strip()

    parts = [f'recording:"{_escape(song_title)}"']
    if artist:
        parts.append(f'artistname:"{_escape(artist)}"')

    query = " AND ".join(parts)
    url = f"{_MB_URL}/recording?query={urllib.parse.quote(query)}&fmt=json&limit=5"
    try:
        req = urllib.request.Request(url, headers=_MB_HEADERS)
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())

        rg_ids: list[str] = []
        for rec in data.get("recordings", [])[:3]:
            for release in rec.get("releases", [])[:2]:
                rg_id = release.get("release-group", {}).get("id", "")
                if rg_id and rg_id not in rg_ids:
                    rg_ids.append(rg_id)

        raw: list[str] = []
        for rg_id in rg_ids[:4]:
            raw = _mb_tags_for("release-group", rg_id)
            if raw:
                break
        return _normalize_tags(raw)
    except Exception:
        return []


def fetch_genres(file_path: str, api_key: str | None = None, title: str = "") -> list[str]:
    """Return canonical genre strings for this audio file.

    Primary: Acoustid fingerprint → MusicBrainz recording/release-group tags.
    Fallback: MusicBrainz title search when fingerprint yields no genres.
    Returns empty list on any failure.
    """
    if not api_key:
        api_key = os.environ.get("ACOUSTID_API_KEY", "")
    if not api_key:
        return []

    duration, fingerprint = _run_fpcalc(file_path)
    genres: list[str] = []

    if duration and fingerprint:
        recording_ids, rg_ids = _acoustid_lookup(api_key, duration, fingerprint)

        raw: list[str] = []
        if recording_ids:
            raw = _mb_tags_for("recording", recording_ids[0])
        if not raw and rg_ids:
            for rg_id in rg_ids[:3]:
                raw = _mb_tags_for("release-group", rg_id)
                if raw:
                    break
        genres = _normalize_tags(raw)

    return genres


def genre_similarity(genres_a: list[str], genres_b: list[str]) -> float:
    """Jaccard similarity over canonical genre sets. Returns 1.0 if either is unknown."""
    a, b = set(genres_a), set(genres_b)
    if not a or not b:
        return 1.0
    intersection = len(a & b)
    union = len(a | b)
    return intersection / union if union > 0 else 0.0


def blend_with_genre(acoustic_sim: float, genres_a: list[str], genres_b: list[str]) -> float:
    """Apply genre as a similarity modifier capped at 20% influence."""
    g_sim = genre_similarity(genres_a, genres_b)
    modifier = 0.80 + 0.20 * g_sim
    return acoustic_sim * modifier
