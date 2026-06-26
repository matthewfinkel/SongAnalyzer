import { Router, Request, Response } from "express";
import multer from "multer";
import { spawn, execSync } from "child_process";
import path from "path";
import fs from "fs";

const router = Router();

const PROJECT_ROOT = path.resolve(__dirname, "../../../..");
const PYTHON = path.join(PROJECT_ROOT, ".venv", "bin", "python");
const MAIN_PY = path.join(PROJECT_ROOT, "main.py");
const NEW_SONGS_DIR = path.join(PROJECT_ROOT, "NewSongs");

// npm strips /opt/homebrew/bin from PATH when it builds the child environment.
// Restore it so that yt-dlp (and other Homebrew tools) are findable by both
// Node spawn calls and Python subprocess.run calls.
const CHILD_ENV = {
  ...process.env,
  PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH ?? ""}`,
};

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

function runPython(
  args: string[],
  opts: { timeoutMs?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, [MAIN_PY, ...args], { cwd: PROJECT_ROOT, env: CHILD_ENV });
    proc.on("error", reject);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d));
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d;
      process.stderr.write(d); // mirror to server terminal in real-time
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`Python process timed out after ${opts.timeoutMs}ms`));
      }, opts.timeoutMs);
    }

    proc.on("close", (code) => {
      if (timer) clearTimeout(timer);
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
    const { stdout: dlOut } = await runPython(["download", url], { timeoutMs: 10 * 60 * 1000 });
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
    const { stdout: dlOut } = await runPython(["download", url], { timeoutMs: 10 * 60 * 1000 });
    const match = dlOut.match(/Saved to NewSongs\/(.+)/);
    if (!match) { res.json({ message: dlOut.trim() }); return; }
    const filePath = path.join(NEW_SONGS_DIR, match[1].trim());
    const { stdout: addOut } = await runPython(["add", "--source-url", url, filePath]);
    res.json({ message: dlOut.trim() + "\n" + addOut.trim() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// Playlist import (SSE streaming)
// ---------------------------------------------------------------------------

type ChildProcess = ReturnType<typeof spawn>;
const playlistJobs = new Map<string, { cancelled: boolean; proc?: ChildProcess }>();

function genJobId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Recursively kill a process and all its descendants by walking the PID tree.
 * Uses `pgrep -P` to find children by parent PID — this works regardless of
 * process group membership, so yt-dlp and ffmpeg are always caught.
 */
function killTree(pid: number): void {
  let children: number[] = [];
  try {
    const out = execSync(`pgrep -P ${pid}`, { stdio: ["ignore", "pipe", "ignore"] });
    children = out.toString().trim().split(/\s+/).map(Number).filter((n) => n > 0);
  } catch {
    // pgrep exits non-zero when there are no children — that's fine
  }
  for (const child of children) killTree(child);
  try { process.kill(pid, "SIGKILL"); } catch {}
}

function killGroup(proc: ChildProcess): void {
  if (proc.pid == null) return;
  killTree(proc.pid);
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
    ], { env: CHILD_ENV });
    proc.on("error", (err) => { clearTimeout(timer); reject(err); });
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

// GET /api/analyze/health — returns resolved paths for debugging
router.get("/health", (_req: Request, res: Response) => {
  const ytdlp = "/opt/homebrew/bin/yt-dlp";
  res.json({
    PROJECT_ROOT,
    PYTHON,
    MAIN_PY,
    ytdlpExists: fs.existsSync(ytdlp),
    pythonExists: fs.existsSync(PYTHON),
    PATH: CHILD_ENV.PATH,
  });
});


// POST /api/analyze/playlist — streams SSE while importing each song
router.post("/playlist", async (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };
  if (!url) { res.status(400).json({ error: "url is required" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  // Disable Nagle's algorithm so each SSE event is sent immediately (no TCP buffering).
  res.socket?.setNoDelay(true);

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const jobId = genJobId();
  const job: { cancelled: boolean; proc?: ChildProcess } = { cancelled: false };
  playlistJobs.set(jobId, job);
  send({ type: "job", jobId });

  let completed = false;

  const finish = (cancelled: boolean) => {
    if (completed) return;
    completed = true;
    playlistJobs.delete(jobId);
    if (cancelled) send({ type: "cancelled" });
    res.end();
  };

  // Stop the Python process if the client disconnects mid-import.
  // Already-added songs are kept.
  // In Node.js >=16, req.on("close") fires when the request BODY is consumed,
  // not when the client disconnects. Use res.on("close") instead — it fires
  // only when the underlying socket is closed (i.e. the client went away).
  res.on("close", () => {
    if (!completed) {
      job.cancelled = true;
      if (job.proc) killGroup(job.proc);
      playlistJobs.delete(jobId);
      completed = true;
    }
  });

  try {
    send({ type: "fetching" });
    const videos = await getPlaylistVideos(url);

    // Cancel might have arrived while the playlist was being fetched.
    if (job.cancelled) { finish(true); return; }

    // Deduplicate in case the playlist lists the same video more than once.
    const seen = new Set<string>();
    const deduped = videos.filter((v) => { if (seen.has(v.id)) return false; seen.add(v.id); return true; });
    send({ type: "playlist", videos: deduped });
    const videoIds = deduped.map((v) => v.id);
    const proc = spawn(PYTHON, [MAIN_PY, "import-playlist", "--", ...videoIds], {
      cwd: PROJECT_ROOT,
      env: CHILD_ENV,
    });
    job.proc = proc;

    // Cancel might have arrived in the tiny gap between spawn and assignment.
    if (job.cancelled) { killGroup(proc); finish(true); return; }

    // Mirror Python's stderr to the server terminal in real-time.
    proc.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));

    let lineBuffer = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed) as Record<string, unknown>;
          if (job.cancelled) return;
          send(event);
          if (event.type === "complete") finish(false);
        } catch {}
      }
    });

    proc.on("close", (code) => {
      if (job.cancelled) {
        finish(true);
      } else if (!completed) {
        send({ type: "error", error: `Import process exited unexpectedly (code ${code})` });
        finish(false);
      }
    });

  } catch (e) {
    send({ type: "error", error: String(e) });
    finish(false);
  }
});

// POST /api/analyze/playlist/cancel
router.post("/playlist/cancel", (req: Request, res: Response) => {
  const { jobId } = req.body as { jobId?: string };
  const job = jobId ? playlistJobs.get(jobId) : undefined;
  if (job) {
    job.cancelled = true;
    if (job.proc) killGroup(job.proc);
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: "Job not found or already complete" });
  }
});

export default router;
