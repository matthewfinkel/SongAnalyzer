# AudioAnalyzer

Analyze your music library and find similar songs using audio feature extraction. Songs are compared across mood, harmonic content, genre/style, and instrumentation — with optional genre tagging via Acoustid fingerprinting.

---

## Setup

### Prerequisites

Install these before anything else.

**Homebrew packages**

```bash
brew install python ffmpeg chromaprint yt-dlp
```

- `ffmpeg` — audio decoding (required by librosa)
- `chromaprint` — provides `fpcalc` for Acoustid audio fingerprinting (optional, enables genre detection)
- `yt-dlp` — YouTube downloading (optional, enables the YouTube features)

**Node.js** — v18 or later. Install via [nodejs.org](https://nodejs.org) or `brew install node`.

---

### 1. Clone and enter the project

```bash
git clone https://github.com/matthewfinkel/SongAnalyzer
```

### 2. Create the Python virtual environment

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

> Essentia must be installed separately — it is not on PyPI for all platforms. On macOS:
> ```bash
> .venv/bin/pip install essentia
> ```
> If that fails, try `essentia-tensorflow` or install from source following the [Essentia docs](https://essentia.upf.edu/installing.html).

### 3. Activate the virtual environment

**Mac / Linux**
```bash
source .venv/bin/activate
```

**Windows**
```bat
.venv\Scripts\activate
```

Your prompt will show `(.venv)` when active. You need to activate once per terminal session — all `python` commands in this guide assume the venv is active.

### 4. Install Node modules

```bash
./bin/install
```

This installs dependencies for the web server, the React client, and the shared `concurrently` runner.

### 5. Initialize the database

```bash
python main.py init-db
```

Creates `~/.audio_analyzer.db` with the songs table and the fixed genre tag vocabulary. Safe to run repeatedly — already-existing data is never overwritten.

### 6. (Optional) Set up genre detection

Genre detection uses [Acoustid](https://acoustid.org) fingerprinting to look up tags from MusicBrainz. It is entirely optional — the similarity algorithm works without it.

1. Create a free API key at [acoustid.org/api-key](https://acoustid.org/api-key)
2. Save it to the project:

```bash
python main.py keys --acoustid YOUR_KEY
```

The key is stored in `.env` at the project root (already gitignored).

---

### 7. Start the app

```bash
./bin/web
```

This initializes the database, then starts the Express API server (port 3001) and the Vite dev server (port 5173) concurrently. Open **http://localhost:5173** in your browser.

---

## Web App

### Library tab

Browse and search all songs in your database.

- **Search** — filters by title in real time
- **Click any song** — opens a detail panel showing BPM, genres, the date it was added, its file path, and a heatmap visualization of its full 106-dimension feature vector
- **Edit genres** — hover any genre badge and click the **×** that appears to remove it; click **+** to open a searchable dropdown of all available genres and add one
- **Delete** — click **Delete** in the detail panel header, then **Confirm** to remove the song from the database (the audio file on disk is not deleted)

### Add Song tab

Three modes, selectable via the tab strip at the top.

**Upload File**
Drag or click to select a local audio file (MP3, WAV, FLAC, M4A, OGG, and others). Click **Analyze & Add to Database** — the file is analyzed and moved to the `AnalyzedSongs/` folder.

**YouTube URL**
Paste a single YouTube video URL. Click **Download & Add to Database** — the audio is downloaded, analyzed, and added automatically.

**YouTube Playlist**
Paste a YouTube playlist URL. Click **Import Playlist** to begin bulk import. Each song is downloaded and analyzed in sequence. A live progress list shows the status of every track.

- The import can be **cancelled** at any time using the **Cancel Import** button. Any songs that were added during the current session are automatically removed from the database on cancellation.

### Find Similar tab

Two modes.

**Upload File**
Upload any audio file. The app extracts features and compares it against every song in your database, returning the closest matches ranked by similarity score.

**YouTube URL**
Paste a YouTube video URL. The audio is downloaded and analyzed on the fly, then matched against your database.

After results appear:
- **Click any result card** to open a comparison window showing exactly why the algorithm considers the songs similar — a radar chart of per-category scores (Mood, Harmonic, Genre/Style, Instruments) and a feature-by-feature breakdown within each category
- **Add this song to the database** — a green button that appears after results are found; adds the query song without re-analyzing it

---

## Similarity Algorithm

Songs are compared using a weighted Euclidean distance across four feature categories extracted by librosa and Essentia:

| Category | Weight | Features |
|---|---|---|
| Mood | 30% | Tempo, danceability, onset flux, consonance, brightness, harmonic ratio, dynamics |
| Harmonic | 35% | Chroma (12 pitch classes), tonnetz (6 tonal geometry dims), key strength, chord change rate, consonance |
| Genre / Style | 25% | MFCCs (mean, std, delta × 20), spectral rolloff/bandwidth, rhythmic entropy, tempo clarity |
| Instruments | 10% | Spectral contrast (7 bands), percussiveness, sub-bass/bass/mid/upper-mid/presence energy |

Distance is converted to a 0–100% similarity score via `exp(−2 × distance)`.

If genre tags are available (via Acoustid + MusicBrainz), a ±20% Jaccard-similarity modifier is applied on top of the acoustic score.

---

## Command Line

All commands are run from the project root. Activate the virtual environment first if you haven't already (see Setup step 3), then use `python` directly.

### Add songs

```bash
# Add a single file
python main.py add path/to/song.mp3

# Add an entire folder (recursive)
python main.py add path/to/music/

# Files are moved to AnalyzedSongs/ after analysis
```

### Find similar songs

```bash
# Top 5 matches (default)
python main.py find path/to/query.mp3

# Show more results
python main.py find path/to/query.mp3 -n 10
```

### Download from YouTube

```bash
# Download to NewSongs/ (does not add to database)
python main.py download "https://www.youtube.com/watch?v=..."

# Then add from NewSongs/
python main.py add NewSongs/
```

### List and remove

```bash
# List all songs in the database
python main.py list

# Remove a song by file path
python main.py remove path/to/song.mp3
```

### Database utilities

```bash
# Show song count and feature weight summary
python main.py info

# Initialize/repair the database and seed genre tags
python main.py init-db

# Backfill BPM for songs that are missing it
python main.py backfill-bpm
```

### API keys

```bash
# Save your Acoustid key
python main.py keys --acoustid YOUR_KEY

# Show currently stored keys (masked)
python main.py keys --show
```

### Global options

```bash
# Use a different database file
python main.py --db /path/to/custom.db list

# Pass an Acoustid key directly instead of using .env
python main.py --acoustid-key YOUR_KEY add song.mp3
```

---

## Supported Audio Formats

MP3, WAV, FLAC, M4A, AAC, OGG, WMA, Opus

---

## Project Structure

```
AudioAnalyzer/
├── analyzer.py          # Feature extraction (librosa + Essentia)
├── database.py          # SQLite schema and queries
├── genre_lookup.py      # Acoustid fingerprinting + MusicBrainz genre tags
├── main.py              # CLI entry point (Click)
├── requirements.txt     # Python dependencies
├── sql/
│   └── seed_genres.sql  # Fixed genre tag vocabulary (40 genres)
├── bin/
│   ├── install          # Install all Node.js dependencies
│   └── web              # Start the web app (init DB + npm run dev)
├── web/
│   ├── client/          # React + TypeScript + Vite frontend
│   └── server/          # Express + TypeScript API server
├── NewSongs/            # Staging area for downloaded/uploaded files
└── AnalyzedSongs/       # Songs that have been analyzed and added
```
