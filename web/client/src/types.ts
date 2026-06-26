export interface Song {
  id: number;
  file_path: string;
  title: string;
  artist?: string;
  source_url?: string | null;
  genres: string[];
  bpm: number | null;
  added_at: string;
  vector?: number[];
}

export interface SimilarResult {
  title: string;
  file_path: string;
  similarity: number;
  acoustic_similarity: number;
  genres: string[];
  bpm: number | null;
  vector: number[];
}

export interface FindResponse {
  query_genres: string[];
  query_vector: number[];
  results: SimilarResult[];
}

// Vector layout mirrors analyzer.py VECTOR_LAYOUT
export const VECTOR_CATEGORIES = [
  {
    name: "Mood",
    weight: "30%",
    color: "#8B5CF6",
    start: 0,
    end: 7,
    labels: [
      "Tempo",
      "Danceability",
      "Onset Flux",
      "Consonance",
      "Brightness",
      "Harm Ratio",
      "Dynamics",
    ],
  },
  {
    name: "Harmonic",
    weight: "35%",
    color: "#3B82F6",
    start: 7,
    end: 28,
    labels: [
      "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
      "Tz 1", "Tz 2", "Tz 3", "Tz 4", "Tz 5", "Tz 6",
      "Key Strength", "Harm Change", "Consonance",
    ],
  },
  {
    name: "Genre / Style",
    weight: "25%",
    color: "#10B981",
    start: 28,
    end: 93,
    labels: [
      ...Array.from({ length: 20 }, (_, i) => `MFCC Mean ${i + 1}`),
      ...Array.from({ length: 20 }, (_, i) => `MFCC Std ${i + 1}`),
      ...Array.from({ length: 20 }, (_, i) => `MFCC Δ ${i + 1}`),
      "Rolloff", "Bandwidth", "Rhythmic Entropy", "Tempo Clarity", "Dom Tempo",
    ],
  },
  {
    name: "Instruments",
    weight: "10%",
    color: "#F59E0B",
    start: 93,
    end: 106,
    labels: [
      "Contrast 1", "Contrast 2", "Contrast 3", "Contrast 4",
      "Contrast 5", "Contrast 6", "Contrast 7",
      "Percussive",
      "Sub-Bass (0–80 Hz)", "Bass (80–250 Hz)",
      "Midrange (250–2k Hz)", "Upper Mid (2–6k Hz)", "Presence (6–12k Hz)",
    ],
  },
] as const;
