/** Strip trailing YouTube-style ID tags: "Song Title [abc123]" → "Song Title" */
export function cleanTitle(title: string): string {
  return title.replace(/\s*\[[^\]]+\]\s*$/, "").trim();
}
