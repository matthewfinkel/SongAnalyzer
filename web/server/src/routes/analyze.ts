import { Router, Request, Response } from "express";
import multer from "multer";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { getMaxSongId, deleteSongsAfter } from "../db.js";

const router = Router();

const PROJECT_ROOT = path.resolve(__dirname, "../../../..");
const PYTHON = path.join(PROJECT_ROOT, ".venv", "bin", "python");
const MAIN_PY = path.join(PROJECT_ROOT, "main.py");
const NEW_SONGS_DIR = path.join(PROJECT_ROOT, "NewSongs");

fs.mkdirSync(NEW_SONGS_DIR, { recursive: true });

// Uploads for add go directly into NewSongs/
const addStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, NEW_SONGS_DIR),
  filename: (_req, file, cb) => cb(null, file.originalname),
});

// Uploads for find also land in NewSongs/ so the user can optionally add them
const findStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, NEW_SONGS_DIR),
  filename: (_req, file, cb) =>
    cb(null, `pending_${Date.now()}_${file.originalname}`),
});

const uploadForAdd  = multer({ storage: addStorage });
const uploadForFind = multer({ storage: findStorage });

function runPython(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, [MAIN_PY, ...args], { cwd: PROJECT_ROOT });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout || `exit code ${code}`));
    });
  });
}

// POST /api/analyze/add — upload a file, analyze, add to DB
router.post("/add", uploadForAdd.single("file"), async (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
  try {
    const { stdout } = await runPython(["add", req.file.path]);
    res.json({ message: stdout.trim() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/analyze/add-from-path — add a file already sitting in NewSongs/
router.post("/add-from-path", async (req: Request, res: Response) => {
  const { filePath } = req.body as { filePath?: string };
  if (!filePath) { res.status(400).json({ error: "filePath is required" }); return; }

  // Safety: only allow paths inside the project root
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(PROJECT_ROOT)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  try {
    const { stdout } = await runPython(["add", resolved]);
    res.json({ message: stdout.trim() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/analyze/find — upload a file, find similar, keep file for optional add
router.post("/find", uploadForFind.single("file"), async (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
  const filePath = req.file.path;
  const n = parseInt(String(req.query.n ?? "5"), 10);
  try {
    const { stdout } = await runPython(["find", "--json", "-n", String(n), filePath]);
    const data = JSON.parse(stdout.trim());
    if (data.error) { res.status(400).json(data); return; }
    res.json({ ...data, source_path: filePath });
  } catch (err) {
    fs.unlink(filePath, () => {});
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/analyze/find-from-url — download YouTube audio, find similar, keep for optional add
router.post("/find-from-url", async (req: Request, res: Response) => {
  const { url, n } = req.body as { url?: string; n?: number };
  if (!url) { res.status(400).json({ error: "url is required" }); return; }
  try {
    const { stdout: dlOut } = await runPython(["download", url]);
    const match = dlOut.match(/Saved to NewSongs\/(.+)/);
    if (!match) { res.status(500).json({ error: "Could not parse downloaded filename" }); return; }
    const filePath = path.join(NEW_SONGS_DIR, match[1].trim());

    const count = parseInt(String(n ?? 5), 10);
    const { stdout } = await runPython(["find", "--json", "-n", String(count), filePath]);
    const data = JSON.parse(stdout.trim());
    if (data.error) { res.status(400).json(data); return; }
    res.json({ ...data, source_path: filePath });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/analyze/download — download from YouTube then analyze & add to DB
router.post("/download", async (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };
  if (!url) { res.status(400).json({ error: "url is required" }); return; }
  try {
    const { stdout: dlOut } = await runPython(["download", url]);
    const match = dlOut.match(/Saved to NewSongs\/(.+)/);
    if (!match) { res.json({ message: dlOut.trim() }); return; }
    const filePath = path.join(NEW_SONGS_DIR, match[1].trim());
    const { stdout: addOut } = await runPython(["add", filePath]);
    res.json({ message: dlOut.trim() + "\n" + addOut.trim() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// Playlist import (SSE streaming)
// ---------------------------------------------------------------------------

const playlistJobs = new Map<string, { cancelled: boolean }>();

function genJobId(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function getPlaylistVideos(
  playlistUrl: string
): Promise<{ id: string; title: string }[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", [
      "--flat-playlist",
      "--ignore-errors",
      "--no-warnings",
      "-j",
      playlistUrl,
    ]);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("Playlist fetch timed out after 2 minutes"));
    }, 120_000);

    proc.stdout.on("data", (d: Buffer) => (stdout += d));
    proc.stderr.on("data", (d: Buffer) => (stderr += d));
    proc.on("close", () => {
      clearTimeout(timer);
      const videos: { id: string; title: string }[] = [];
      for (const line of stdout.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try {
          const obj = JSON.parse(t);
          if (obj.id && obj.title) videos.push({ id: obj.id, title: obj.title });
        } catch {}
      }
      if (videos.length > 0) resolve(videos);
      else reject(new Error(stderr.trim() || "No videos found in playlist — check the URL"));
    });
  });
}

// POST /api/analyze/playlist — streams SSE while importing each song
router.post("/playlist", async (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };
  if (!url) { res.status(400).json({ error: "url is required" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const jobId = genJobId();
  const job = { cancelled: false };
  playlistJobs.set(jobId, job);
  send({ type: "job", jobId });

  const initialMaxId = await getMaxSongId();
  let completed = false;

  const finish = async (cancelled: boolean) => {
    completed = true;
    playlistJobs.delete(jobId);
    if (cancelled) {
      try {
        const removed = await deleteSongsAfter(initialMaxId);
        send({ type: "cancelled", removed });
      } catch {
        send({ type: "cancelled", removed: 0 });
      }
    }
    res.end();
  };

  // Roll back silently if the client disconnects mid-import
  req.on("close", async () => {
    if (!completed) {
      job.cancelled = true;
      playlistJobs.delete(jobId);
      try { await deleteSongsAfter(initialMaxId); } catch {}
    }
  });

  try {
    send({ type: "fetching" });
    const videos = await getPlaylistVideos(url);
    send({ type: "playlist", videos });

    let added = 0, skipped = 0, failed = 0;

    for (let i = 0; i < videos.length; i++) {
      if (job.cancelled) { await finish(true); return; }

      send({ type: "progress", index: i, step: "downloading" });

      let filePath: string;
      try {
        const { stdout: dlOut } = await runPython(["download", `https://www.youtube.com/watch?v=${videos[i].id}`]);
        const match = dlOut.match(/Saved to NewSongs\/(.+)/);
        if (!match) throw new Error("Could not parse downloaded filename from yt-dlp output");
        filePath = path.join(NEW_SONGS_DIR, match[1].trim());
      } catch (e) {
        send({ type: "result", index: i, status: "error", error: String(e) });
        failed++;
        continue;
      }

      if (job.cancelled) { await finish(true); return; }

      send({ type: "progress", index: i, step: "analyzing" });
      try {
        const { stdout: addOut } = await runPython(["add", filePath]);
        const wasSkipped = /\bskip\b/.test(addOut);
        send({ type: "result", index: i, status: wasSkipped ? "skipped" : "added" });
        if (wasSkipped) skipped++; else added++;
      } catch (e) {
        send({ type: "result", index: i, status: "error", error: String(e) });
        failed++;
      }
    }

    send({ type: "complete", added, skipped, failed });
    await finish(false);
  } catch (e) {
    send({ type: "error", error: String(e) });
    await finish(false);
  }
});

// POST /api/analyze/playlist/cancel
router.post("/playlist/cancel", (req: Request, res: Response) => {
  const { jobId } = req.body as { jobId?: string };
  const job = jobId ? playlistJobs.get(jobId) : undefined;
  if (job) {
    job.cancelled = true;
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: "Job not found or already complete" });
  }
});

export default router;
