#!/usr/bin/env python3
"""Audio similarity tool — analyze songs and find the closest matches."""

import os
import subprocess
import sys
from pathlib import Path

import click
import numpy as np

from analyzer import extract_features, weighted_similarity, WEIGHTS, VECTOR_DIM
from database import SongDatabase
from genre_lookup import fetch_genres, blend_with_genre

AUDIO_EXTENSIONS = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".wma", ".opus"}
DEFAULT_DB = str(Path.home() / ".audio_analyzer.db")


# ---------------------------------------------------------------------------
# CLI root
# ---------------------------------------------------------------------------

@click.group()
@click.option(
    "--db",
    default=DEFAULT_DB,
    show_default=True,
    help="Path to the SQLite database file.",
)
@click.option(
    "--acoustid-key",
    default=lambda: os.environ.get("ACOUSTID_API_KEY", ""),
    show_default=False,
    help="Acoustid API key for genre lookup (or set ACOUSTID_API_KEY env var).",
)
@click.pass_context
def cli(ctx, db, acoustid_key):
    """Analyze audio tracks and find similar songs by weighted feature comparison.

    \b
    Feature weights (acoustic):
      Mood        30%
      Harmonic    35%
      Genre/Style 25%
      Instruments 10%

    Genre tags (via Acoustid) apply a ±20% modifier on top.
    Set ACOUSTID_API_KEY to enable genre detection.
    """
    ctx.ensure_object(dict)
    ctx.obj["db"] = SongDatabase(db)
    ctx.obj["acoustid_key"] = acoustid_key


# ---------------------------------------------------------------------------
# add
# ---------------------------------------------------------------------------

@cli.command()
@click.argument("path")
@click.pass_context
def add(ctx, path):
    """Add a song or every audio file in a folder to the database."""
    db: SongDatabase = ctx.obj["db"]
    p = Path(path)

    if p.is_file():
        files = [p] if p.suffix.lower() in AUDIO_EXTENSIONS else []
    elif p.is_dir():
        files = sorted(f for f in p.rglob("*") if f.suffix.lower() in AUDIO_EXTENSIONS)
    else:
        click.echo(f"Error: '{path}' not found.", err=True)
        sys.exit(1)

    if not files:
        click.echo("No supported audio files found.")
        return

    added, skipped, failed = 0, 0, 0

    # Determine where to move analyzed files.
    # If the source is already AnalyzedSongs (or a file inside it), skip moving.
    source_root = p if p.is_dir() else p.parent
    dest_dir = source_root.parent / "AnalyzedSongs"
    dest_dir.mkdir(exist_ok=True)
    already_in_dest = source_root.resolve() == dest_dir.resolve()

    for f in files:
        abs_path = str(f.resolve())
        if db.exists(abs_path):
            click.echo(f"  skip    {f.name}")
            skipped += 1
            continue

        click.echo(f"  analyze {f.name} ... ", nl=False)
        try:
            vec = extract_features(abs_path)

            api_key = ctx.obj.get("acoustid_key", "")
            genres = fetch_genres(abs_path, api_key) if api_key else []
            genre_str = f" [{', '.join(genres)}]" if genres else " [genres: unknown]"

            if already_in_dest:
                final_path = abs_path
            else:
                dest = dest_dir / f.name
                if dest.exists():
                    dest = dest_dir / f"{f.stem}__{f.parent.name}{f.suffix}"
                f.rename(dest)
                final_path = str(dest.resolve())

            db.add(final_path, f.stem, vec, genres)
            click.echo(f"ok{genre_str}")
            added += 1
        except Exception as exc:
            click.echo(f"FAILED ({exc})")
            failed += 1

    click.echo(f"\nDone — added: {added}  skipped: {skipped}  failed: {failed}")


# ---------------------------------------------------------------------------
# find
# ---------------------------------------------------------------------------

@cli.command()
@click.argument("path")
@click.option("-n", "--results", default=5, show_default=True, help="How many matches to show.")
@click.pass_context
def find(ctx, path, results):
    """Find the most similar songs in the database to the given audio file."""
    db: SongDatabase = ctx.obj["db"]

    if db.count() == 0:
        click.echo("Database is empty. Run 'add' first.")
        return

    p = Path(path)
    if not p.exists():
        click.echo(f"Error: '{path}' not found.", err=True)
        sys.exit(1)

    click.echo(f"Analyzing '{p.name}' ...")
    try:
        query_vec = extract_features(str(p.resolve()))
    except Exception as exc:
        click.echo(f"Error: {exc}", err=True)
        sys.exit(1)

    api_key = ctx.obj.get("acoustid_key", "")
    query_abs = str(p.resolve())
    query_genres = fetch_genres(query_abs, api_key) if api_key else []
    if api_key:
        if query_genres:
            click.echo(f"  Detected genres: {', '.join(query_genres)}")
        else:
            click.echo("  Genres: not found in database (acoustic match only)")

    songs = db.get_all()

    matches = []
    for _, file_path, title, vec, genres in songs:
        if file_path == query_abs:
            continue
        if len(vec) != VECTOR_DIM:
            click.echo(f"  (skipping '{title}' — old vector format, re-add to update)")
            continue
        acoustic = weighted_similarity(query_vec, vec)
        blended  = blend_with_genre(acoustic, query_genres, genres)
        matches.append((blended, acoustic, title, file_path, genres))

    if not matches:
        click.echo("No other songs in the database to compare against.")
        return

    matches.sort(reverse=True)
    top = matches[:results]

    click.echo(f"\nTop {len(top)} match(es) for '{p.stem}':\n")
    for rank, (sim, acoustic, title, file_path, genres) in enumerate(top, 1):
        filled = int(sim * 20)
        bar = "█" * filled + "░" * (20 - filled)
        genre_str = ", ".join(genres) if genres else "unknown"
        click.echo(f"  {rank}. {title}")
        click.echo(f"     {bar} {sim:.1%}  (acoustic {acoustic:.1%})")
        click.echo(f"     Genres: {genre_str}")
        click.echo(f"     {file_path}")
        click.echo()


# ---------------------------------------------------------------------------
# list
# ---------------------------------------------------------------------------

@cli.command("list")
@click.pass_context
def list_songs(ctx):
    """List all songs currently in the database."""
    db: SongDatabase = ctx.obj["db"]
    songs = db.get_all()

    if not songs:
        click.echo("Database is empty.")
        return

    click.echo(f"{len(songs)} song(s) in database:\n")
    for id_, file_path, title, _, genres in songs:
        genre_str = ", ".join(genres) if genres else "unknown"
        click.echo(f"  {id_:>4}.  {title}")
        click.echo(f"         Genres: {genre_str}")
        click.echo(f"         {file_path}")


# ---------------------------------------------------------------------------
# remove
# ---------------------------------------------------------------------------

@cli.command()
@click.argument("path")
@click.pass_context
def remove(ctx, path):
    """Remove a song from the database by its file path."""
    db: SongDatabase = ctx.obj["db"]
    abs_path = str(Path(path).resolve())
    if db.remove(abs_path):
        click.echo(f"Removed: {abs_path}")
    else:
        click.echo(f"Not found in database: {abs_path}")


# ---------------------------------------------------------------------------
# download
# ---------------------------------------------------------------------------

@cli.command()
@click.argument("url")
@click.pass_context
def download(ctx, url):
    """Download a YouTube video as audio and save it to NewSongs."""
    new_songs_dir = Path("NewSongs")
    new_songs_dir.mkdir(exist_ok=True)

    click.echo(f"Downloading {url} ...")

    result = subprocess.run(
        [
            "yt-dlp",
            "--extract-audio",
            "--audio-format", "mp3",
            "--audio-quality", "0",
            "--output", str(new_songs_dir / "%(title)s [%(id)s].%(ext)s"),
            "--no-playlist",
            url,
        ],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        click.echo("Download failed:\n" + result.stderr, err=True)
        sys.exit(1)

    # Find the file that was just written
    downloads = sorted(new_songs_dir.glob("*.mp3"), key=lambda f: f.stat().st_mtime, reverse=True)
    if not downloads:
        click.echo("Download appeared to succeed but no mp3 was found in NewSongs.", err=True)
        sys.exit(1)

    latest = downloads[0]
    click.echo(f"Saved to NewSongs/{latest.name}")
    click.echo("Run 'add NewSongs' to analyze and move it to the database.")


# ---------------------------------------------------------------------------
# keys
# ---------------------------------------------------------------------------

@cli.command()
@click.option("--acoustid", "acoustid_key", default=None, help="Set the Acoustid API key.")
@click.option("--show", is_flag=True, help="Print current key values.")
def keys(acoustid_key, show):
    """Manage API keys stored in the project .env file."""
    env_file = Path(__file__).parent / ".env"

    # Read existing entries
    entries: dict[str, str] = {}
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            entries[k.strip()] = v.strip().strip('"').strip("'")

    if show:
        if not entries:
            click.echo("No keys set. Run: python main.py keys --acoustid YOUR_KEY")
        for k, v in entries.items():
            masked = v[:4] + "*" * (len(v) - 4) if len(v) > 4 else "****"
            click.echo(f"  {k} = {masked}")
        return

    if acoustid_key is not None:
        entries["ACOUSTID_API_KEY"] = acoustid_key
        lines = [f'{k}={v}' for k, v in entries.items()]
        env_file.write_text("\n".join(lines) + "\n")
        click.echo(f"Saved ACOUSTID_API_KEY to {env_file}")
        return

    click.echo("Usage:")
    click.echo("  Set a key  : python main.py keys --acoustid YOUR_KEY")
    click.echo("  Show keys  : python main.py keys --show")


# ---------------------------------------------------------------------------
# info
# ---------------------------------------------------------------------------

@cli.command()
@click.pass_context
def info(ctx):
    """Show database statistics."""
    db: SongDatabase = ctx.obj["db"]
    n = db.count()
    click.echo(f"Songs in database : {n}")
    click.echo(f"Database file     : {ctx.obj['db'].db_path}")
    click.echo()
    click.echo("Feature weights:")
    for name, w in WEIGHTS.items():
        bar = "█" * int(w * 40)
        click.echo(f"  {name:<12} {bar} {w:.0%}")


# ---------------------------------------------------------------------------

if __name__ == "__main__":
    cli()
