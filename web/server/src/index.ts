import express from "express";
import cors from "cors";
import songsRouter from "./routes/songs.js";
import analyzeRouter from "./routes/analyze.js";

const app = express();
const PORT = parseInt(process.env.PORT ?? "3001", 10);

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

app.use("/api/songs", songsRouter);
app.use("/api/analyze", analyzeRouter);

app.listen(PORT, () => {
  console.log(`Audio Analyzer server running at http://localhost:${PORT}`);
});
