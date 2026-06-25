import { Router, Request, Response } from "express";
import { getAllSongs, getSongById, searchSongs, deleteSong, getGenreTags, updateSongGenres } from "../db.js";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  try {
    res.json(await getAllSongs());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Must be before /:id to avoid "genres" being captured as an id param
router.get("/genres", async (_req: Request, res: Response) => {
  try {
    res.json(await getGenreTags());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/search", async (req: Request, res: Response) => {
  const q = String(req.query.q ?? "");
  try {
    res.json(q ? await searchSongs(q) : await getAllSongs());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const song = await getSongById(id);
    if (!song) { res.status(404).json({ error: "Song not found" }); return; }
    res.json(song);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.patch("/:id/genres", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { genres } = req.body as { genres?: unknown };
  if (!Array.isArray(genres) || !genres.every((g) => typeof g === "string")) {
    res.status(400).json({ error: "genres must be an array of strings" });
    return;
  }
  try {
    const updated = await updateSongGenres(id, genres as string[]);
    if (!updated) { res.status(404).json({ error: "Song not found" }); return; }
    res.json({ genres });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const deleted = await deleteSong(id);
    if (!deleted) { res.status(404).json({ error: "Song not found" }); return; }
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
