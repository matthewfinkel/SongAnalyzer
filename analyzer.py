import numpy as np
import librosa
import essentia.standard as es

WEIGHTS = {
    'mood':        0.30,
    'harmonic':    0.35,
    'genre':       0.25,
    'instruments': 0.10,
}

# Boundaries within the stored vector — update if feature dims change.
VECTOR_LAYOUT = {
    'mood':        (0,   7),    # 7  dims
    'harmonic':    (7,   28),   # 21 dims
    'genre':       (28,  93),   # 65 dims
    'instruments': (93,  106),  # 13 dims
}

VECTOR_DIM = 106

# Krumhansl-Kessler key profiles — weight each scale degree by perceived importance.
# Unlike binary templates, these let major and minor actually differ for the same
# note set (C major ≠ A natural minor) because they assign different weights to
# the tonic, third, fifth, etc.
_KK_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_KK_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
# Zero-mean so correlation measures shape match, not overall level
_KK_MAJOR_NM = _KK_MAJOR - _KK_MAJOR.mean()
_KK_MINOR_NM = _KK_MINOR - _KK_MINOR.mean()

# Consonant intervals from tonic: P1, m3, M3, P4, P5, m6, M6
_CONSONANT = [0, 3, 4, 5, 7, 8, 9]
# Dissonant intervals: m2, M2, tritone, m7, M7
_DISSONANT  = [1, 2, 6, 10, 11]

_SEGMENT_SECONDS  = 45
_INTRO_SKIP_SECONDS = 15


# ---------------------------------------------------------------------------
# Feature sub-routines
# ---------------------------------------------------------------------------

def _key_mode_strength(chroma_mean: np.ndarray):
    """Return (mode, key_strength, tonic) using Krumhansl-Kessler profiles.

    mode: 1.0 = major, 0.0 = minor
    key_strength: how clearly the music sits in a single key [0, 1]
    tonic: pitch class index (0=C, 1=C#, ...) of the detected key
    """
    norm = chroma_mean / (chroma_mean.sum() + 1e-6)
    nm   = norm - norm.mean()  # zero-mean for shape-based correlation

    major_scores = [float(np.correlate(np.roll(nm, -k), _KK_MAJOR_NM)[0]) for k in range(12)]
    minor_scores = [float(np.correlate(np.roll(nm, -k), _KK_MINOR_NM)[0]) for k in range(12)]

    best_m_val = max(major_scores)
    best_n_val = max(minor_scores)

    mode = float(best_m_val / (best_m_val + best_n_val + 1e-6))
    tonic = int(np.argmax(major_scores) if best_m_val >= best_n_val else np.argmax(minor_scores))

    all_scores = major_scores + minor_scores
    mean_score  = float(np.mean(all_scores))
    key_strength = float(np.clip((max(best_m_val, best_n_val) - mean_score) / (mean_score + 1e-6) / 3.0, 0, 1))

    return mode, key_strength, tonic


def _consonance(chroma_mean: np.ndarray, tonic: int) -> float:
    """Ratio of energy on consonant intervals from the KK-detected tonic."""
    norm = chroma_mean / (chroma_mean.sum() + 1e-6)
    con = sum(norm[(tonic + i) % 12] for i in _CONSONANT)
    dis = sum(norm[(tonic + i) % 12] for i in _DISSONANT)
    return float(con / (con + dis + 1e-6))


def _harmonic_change_rate(chroma: np.ndarray) -> float:
    """Mean frame-to-frame chroma distance — high means chords move often."""
    diff_norms = np.linalg.norm(np.diff(chroma, axis=1), axis=0)
    return float(np.clip(np.mean(diff_norms) / 0.8, 0, 1))


def _rhythm_features(onset_env: np.ndarray, sr: int):
    """Summarise the rhythmic fingerprint as three scalars.

    rhythmic_entropy:   0 = very regular beat, 1 = complex/irregular
    tempo_clarity:      how strongly one tempo dominates the tempogram
    dominant_tempo:     normalised position of the strongest BPM bin
    """
    tg = librosa.feature.tempogram(onset_envelope=onset_env, sr=sr, hop_length=512)
    profile = np.mean(tg, axis=1)
    profile_norm = profile / (profile.sum() + 1e-6)

    entropy = float(-np.sum(profile_norm * np.log(profile_norm + 1e-10)))
    rhythmic_entropy = float(np.clip(entropy / np.log(len(profile)), 0, 1))

    clarity = float(np.max(profile_norm) / (np.mean(profile_norm) + 1e-6))
    tempo_clarity = float(np.tanh(clarity / 10.0))

    dominant_tempo = float(np.argmax(profile)) / len(profile)

    return rhythmic_entropy, tempo_clarity, dominant_tempo


# ---------------------------------------------------------------------------
# Whole-song essentia analysis
# ---------------------------------------------------------------------------

def _essentia_global(file_path: str):
    """Reliable whole-song features that librosa cannot compute well.

    Returns (mode, key_strength, danceability) where
      mode: 1.0 = major, 0.0 = minor  (Temperley key-finding, works on real music)
      key_strength: 0–1 tonal clarity
      danceability: normalised 0–1 (Essentia raw score / 3, clipped)
    """
    audio = es.MonoLoader(filename=file_path, sampleRate=44100)()
    _, scale, strength = es.KeyExtractor()(audio)
    mode = 1.0 if scale == 'major' else 0.0
    dance_raw, _ = es.Danceability()(audio)
    danceability = float(np.clip(dance_raw / 3.0, 0, 1))
    return float(mode), float(strength), danceability


# ---------------------------------------------------------------------------
# Per-segment extraction
# ---------------------------------------------------------------------------

def _segment_features(y: np.ndarray, sr: int,
                      es_mode: float = 0.5,
                      es_key_strength: float = 0.5,
                      es_danceability: float = 0.5) -> np.ndarray:
    """Return the 106-dim feature vector for one audio segment."""
    y_harm, _ = librosa.effects.hpss(y)
    harm_ratio = float(np.mean(np.abs(y_harm)) / (np.mean(np.abs(y)) + 1e-6))

    # Shared
    rms        = librosa.feature.rms(y=y)[0]
    rms_mean   = float(np.mean(rms))
    rms_std    = float(np.std(rms))
    onset_env  = librosa.onset.onset_strength(y=y, sr=sr, hop_length=512)
    flux_mean  = float(np.mean(onset_env))
    tempo_raw, _ = librosa.beat.beat_track(y=y, sr=sr)
    tempo      = float(np.atleast_1d(tempo_raw)[0])
    chroma      = librosa.feature.chroma_cqt(y=y_harm, sr=sr)
    chroma_mean = np.mean(chroma, axis=1)
    mode, key_strength, tonic = _key_mode_strength(chroma_mean)
    consonance  = _consonance(chroma_mean, tonic)

    # ------------------------------------------------------------------
    # Mood (7 dims)
    # Arousal: tempo, danceability, onset flux
    # Valence: consonance, brightness, tonal/percussive balance, dynamics
    # ------------------------------------------------------------------
    centroid = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))

    mood = np.array([
        np.clip(tempo / 200.0, 0, 1),                          # arousal — speed
        es_danceability,                                        # arousal — groove/danceability
        np.clip(flux_mean / 10.0, 0, 1),                       # arousal — onset intensity
        consonance,                                             # valence — harmonic warmth
        np.clip(centroid / 8000.0, 0, 1),                      # valence — tonal brightness
        np.clip(harm_ratio, 0, 1),                             # tonal vs percussive
        np.clip(rms_std / (rms_mean + 1e-6) / 2.0, 0, 1),     # dynamic variation
    ])  # 7 dims

    # ------------------------------------------------------------------
    # Harmonic (21 dims) — 35% weight
    # Chroma + tonnetz capture tonal fingerprint naturally, without
    # the binary mode feature that was over-penalizing major-key songs.
    # ------------------------------------------------------------------
    tonnetz      = librosa.feature.tonnetz(y=y_harm, sr=sr)
    tonnetz_mean = np.mean(tonnetz, axis=1)                    # 6 dims
    harm_change  = _harmonic_change_rate(chroma)

    harmonic = np.concatenate([
        chroma_mean,         # 12 — pitch class distribution
        tonnetz_mean,        # 6  — tonal geometry (fifths, major/minor thirds)
        [es_key_strength],   # 1  — tonal clarity (Essentia)
        [harm_change],       # 1  — chord change rate
        [consonance],        # 1  — harmonic consonance
    ])  # 21 dims

    # ------------------------------------------------------------------
    # Genre / Style (65 dims) — 25% weight
    # Timbre fingerprint (MFCCs) + rhythmic fingerprint (tempogram).
    # Adding rhythm separates hip-hop's locked groove from prog rock's
    # complex polyrhythm even when both use similar instruments.
    # ------------------------------------------------------------------
    mfcc       = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=20)
    mfcc_delta = librosa.feature.delta(mfcc)
    rolloff    = float(np.mean(librosa.feature.spectral_rolloff(y=y, sr=sr)))
    bw         = float(np.mean(librosa.feature.spectral_bandwidth(y=y, sr=sr)))
    r_entropy, t_clarity, dom_tempo = _rhythm_features(onset_env, sr)

    genre = np.concatenate([
        np.tanh(np.mean(mfcc, axis=1) / 100.0),       # 20 — timbre shape
        np.tanh(np.std(mfcc, axis=1) / 50.0),          # 20 — timbre variance
        np.tanh(np.mean(mfcc_delta, axis=1) / 50.0),   # 20 — timbre dynamics
        [np.clip(rolloff / 11025.0, 0, 1)],             # 1
        [np.clip(bw / 4000.0, 0, 1)],                   # 1
        [r_entropy],                                    # 1 — rhythm complexity
        [t_clarity],                                    # 1 — beat regularity
        [dom_tempo],                                    # 1 — dominant tempo position
    ])  # 65 dims

    # ------------------------------------------------------------------
    # Instruments (13 dims) — 10% weight
    # Reduced weight: sub-band energy is easily confused by production
    # style (electronic Gorillaz ≈ electronic Kanye). Kept as a tiebreaker.
    # ------------------------------------------------------------------
    contrast = librosa.feature.spectral_contrast(y=y, sr=sr, n_bands=6)
    stft     = np.abs(librosa.stft(y))
    freqs    = librosa.fft_frequencies(sr=sr)

    bands = [(0, 80), (80, 250), (250, 2000), (2000, 6000), (6000, 12000)]
    band_e = np.array([
        np.mean(stft[(freqs >= lo) & (freqs < hi)])
        if np.any((freqs >= lo) & (freqs < hi)) else 0.0
        for lo, hi in bands
    ])
    band_norm = band_e / (band_e.sum() + 1e-6)

    instruments = np.concatenate([
        np.tanh(np.mean(contrast, axis=1) / 20.0),  # 7
        [1.0 - harm_ratio],                           # 1
        band_norm,                                    # 5
    ])  # 13 dims

    return np.concatenate([mood, harmonic, genre, instruments]).astype(np.float32)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def extract_features(file_path: str) -> np.ndarray:
    """Return a 106-dim feature vector, averaged across 3 segments of the track.

    Two-pass approach:
    - Essentia analyses the full song for reliable key/mode and danceability.
    - Librosa analyses 3 segments (skipping intro) for timbre, rhythm, and harmony.
    """
    # Whole-song reliable features (Essentia)
    es_mode, es_key_strength, es_dance = _essentia_global(file_path)

    # Multi-segment librosa features
    y_full, sr = librosa.load(file_path, sr=22050, mono=True)
    total   = len(y_full)
    seg_len = sr * _SEGMENT_SECONDS
    skip    = sr * _INTRO_SKIP_SECONDS

    kwargs = dict(es_mode=es_mode, es_key_strength=es_key_strength, es_danceability=es_dance)

    if total <= seg_len + skip:
        return _segment_features(y_full, sr, **kwargs)

    usable_len = total - skip - seg_len
    n_seg = 3
    offsets = [
        skip + int(i * usable_len / (n_seg - 1))
        for i in range(n_seg)
    ]

    vecs = [_segment_features(y_full[off: off + seg_len], sr, **kwargs) for off in offsets]
    return np.mean(vecs, axis=0).astype(np.float32)


def extract_bpm(file_path: str) -> float | None:
    """Return the estimated BPM for a track, or None on failure.

    Primary: Essentia RhythmExtractor2013 (multifeature) — designed for this
    task and far more accurate across genres than librosa beat_track.
    Loads seconds 5–95 to skip silent intros.

    Fallback: librosa median over 30-second windows (kept for edge cases
    where essentia raises an exception on unusual audio formats).
    """
    try:
        audio = es.MonoLoader(filename=file_path, sampleRate=44100,
                              startTime=5.0, endTime=95.0)()
        bpm, _, confidence, _, _ = es.RhythmExtractor2013(method="multifeature")(audio)
        bpm = float(bpm)
        if confidence > 0.0 and 40.0 <= bpm <= 250.0:
            return round(bpm, 1)
    except Exception:
        pass

    try:
        y, sr = librosa.load(file_path, sr=22050, mono=True, duration=90)
        seg = sr * 30
        tempos = []
        for start in range(0, len(y) - seg, seg):
            t, _ = librosa.beat.beat_track(y=y[start: start + seg], sr=sr)
            v = float(np.atleast_1d(t)[0])
            if v > 0:
                tempos.append(v)
        if tempos:
            return round(float(np.median(tempos)), 1)
    except Exception:
        pass

    return None


def weighted_similarity(v1: np.ndarray, v2: np.ndarray) -> float:
    """Weighted Euclidean distance converted to a similarity score in (0, 1].

    Euclidean distance captures actual differences in feature values.
    exp(-2 * dist) maps distance to a bounded similarity score.
    """
    total_dist = 0.0
    for name, (start, end) in VECTOR_LAYOUT.items():
        dist = float(np.linalg.norm(v1[start:end] - v2[start:end]))
        total_dist += WEIGHTS[name] * dist
    return float(np.exp(-2.0 * total_dist))
