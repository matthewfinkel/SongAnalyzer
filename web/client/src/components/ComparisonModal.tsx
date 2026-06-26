import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { VECTOR_CATEGORIES } from "../types.ts";
import { cleanTitle } from "../utils.ts";

interface Props {
  queryTitle: string;
  matchTitle: string;
  queryVector: number[];
  matchVector: number[];
  similarity: number;
  onClose: () => void;
}

// Per-category similarity: exp(-2 * euclidean_dist)
function categorySimilarity(v1: number[], v2: number[], start: number, end: number) {
  const sq = v1
    .slice(start, end)
    .reduce((s, val, i) => s + (val - v2[start + i]) ** 2, 0);
  return Math.exp(-2 * Math.sqrt(sq));
}

// Colour a 0-1 similarity value: green (high) → amber → red (low)
function simColor(sim: number) {
  if (sim >= 0.7) return "#34d399"; // emerald
  if (sim >= 0.45) return "#fbbf24"; // amber
  return "#f87171"; // red
}

function absDiff(a: number, b: number) {
  return Math.abs(a - b);
}

export default function ComparisonModal({
  queryTitle,
  matchTitle,
  queryVector,
  matchVector,
  similarity,
  onClose,
}: Props) {
  const radarData = VECTOR_CATEGORIES.map((cat) => {
    const sim = categorySimilarity(queryVector, matchVector, cat.start, cat.end);
    return { category: cat.name, similarity: Math.round(sim * 100), fullMark: 100 };
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="bg-gray-900 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 px-6 py-4 rounded-t-2xl flex items-start justify-between gap-4">
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">
              Similarity breakdown
            </div>
            <div className="text-white font-semibold leading-tight">
              {cleanTitle(queryTitle)}
            </div>
            <div className="text-gray-400 text-sm mt-0.5 flex items-center gap-1">
              <span>vs</span>
              <span className="text-indigo-300 font-medium">
                {cleanTitle(matchTitle)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4 flex-shrink-0">
            <div className="text-right">
              <div
                className="text-3xl font-bold"
                style={{ color: simColor(similarity) }}
              >
                {(similarity * 100).toFixed(1)}%
              </div>
              <div className="text-gray-500 text-xs">overall match</div>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors text-xl leading-none mt-1"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Radar chart */}
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">
              Category overview
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData} outerRadius="70%">
                  <PolarGrid stroke="#374151" />
                  <PolarAngleAxis
                    dataKey="category"
                    tick={{ fill: "#9ca3af", fontSize: 12 }}
                  />
                  <Tooltip
                    formatter={(v: number) => `${v}%`}
                    contentStyle={{
                      background: "#111827",
                      border: "1px solid #374151",
                      borderRadius: 8,
                      color: "#f3f4f6",
                    }}
                  />
                  <Radar
                    name={cleanTitle(queryTitle)}
                    dataKey="similarity"
                    stroke="#818cf8"
                    fill="#818cf8"
                    fillOpacity={0.25}
                    dot={{ fill: "#818cf8", r: 3 }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            {/* Category legend */}
            <div className="grid grid-cols-2 gap-2 mt-1">
              {VECTOR_CATEGORIES.map((cat) => {
                const sim = categorySimilarity(
                  queryVector,
                  matchVector,
                  cat.start,
                  cat.end
                );
                return (
                  <div
                    key={cat.name}
                    className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: cat.color }}
                      />
                      <span className="text-sm text-gray-300">{cat.name}</span>
                      <span className="text-xs text-gray-600">{cat.weight}</span>
                    </div>
                    <span
                      className="text-sm font-semibold"
                      style={{ color: simColor(sim) }}
                    >
                      {(sim * 100).toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Per-category feature breakdown */}
          {VECTOR_CATEGORIES.map((cat) => {
            const qSlice = queryVector.slice(cat.start, cat.end);
            const mSlice = matchVector.slice(cat.start, cat.end);

            // Sort features by difference descending so most divergent appear first
            const features = cat.labels.map((label, i) => ({
              label,
              qVal: qSlice[i] ?? 0,
              mVal: mSlice[i] ?? 0,
              diff: absDiff(qSlice[i] ?? 0, mSlice[i] ?? 0),
            }));
            const sorted = [...features].sort((a, b) => b.diff - a.diff);
            // Show top 8 most different, always
            const top8 = sorted.slice(0, 8);
            const catSim = categorySimilarity(
              queryVector,
              matchVector,
              cat.start,
              cat.end
            );

            return (
              <div key={cat.name}>
                <div className="flex items-baseline gap-2 mb-2">
                  <span
                    className="text-xs font-semibold uppercase tracking-wide"
                    style={{ color: cat.color }}
                  >
                    {cat.name}
                  </span>
                  <span className="text-xs text-gray-500">
                    top 8 most divergent features
                  </span>
                  <span
                    className="ml-auto text-xs font-semibold"
                    style={{ color: simColor(catSim) }}
                  >
                    {(catSim * 100).toFixed(0)}% match
                  </span>
                </div>

                <div className="space-y-1.5">
                  {/* Legend row */}
                  <div className="flex items-center gap-3 text-xs text-gray-600 px-1 mb-2">
                    <div className="w-36 shrink-0" />
                    <div className="flex gap-3">
                      <span className="flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-sm bg-indigo-500" />
                        {cleanTitle(queryTitle).slice(0, 14)}
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-sm bg-emerald-500" />
                        {cleanTitle(matchTitle).slice(0, 14)}
                      </span>
                    </div>
                  </div>

                  {top8.map(({ label, qVal, mVal, diff }) => {
                    const scale = Math.max(Math.abs(qVal), Math.abs(mVal), 0.01);
                    const qPct = (Math.abs(qVal) / scale) * 100;
                    const mPct = (Math.abs(mVal) / scale) * 100;
                    const diffPct = Math.min(diff / 1.0, 1);
                    const rowColor =
                      diffPct < 0.15
                        ? "text-emerald-400"
                        : diffPct < 0.4
                        ? "text-amber-400"
                        : "text-red-400";

                    return (
                      <div
                        key={label}
                        className="flex items-center gap-3 text-xs"
                      >
                        <div className="w-36 text-gray-400 truncate shrink-0 text-right">
                          {label}
                        </div>
                        <div className="flex-1 space-y-0.5">
                          {/* Query bar */}
                          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-indigo-500 opacity-80"
                              style={{ width: `${qPct}%` }}
                            />
                          </div>
                          {/* Match bar */}
                          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-emerald-500 opacity-80"
                              style={{ width: `${mPct}%` }}
                            />
                          </div>
                        </div>
                        <div className={`w-10 text-right font-mono shrink-0 ${rowColor}`}>
                          Δ{diff.toFixed(2)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
