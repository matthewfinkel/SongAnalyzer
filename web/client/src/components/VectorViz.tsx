import { useState } from "react";
import { VECTOR_CATEGORIES } from "../types.ts";

interface Props {
  vector: number[];
}

// Diverging colormap: blue → yellow → red
function valueToColor(v: number): string {
  const t = Math.max(0, Math.min(1, v));
  let r: number, g: number, b: number;
  if (t < 0.5) {
    const u = t * 2;
    r = Math.round(49 + u * (254 - 49));
    g = Math.round(130 + u * (224 - 130));
    b = Math.round(189 + u * (139 - 189));
  } else {
    const u = (t - 0.5) * 2;
    r = Math.round(254 + u * (165 - 254));
    g = Math.round(224 + u * (0 - 224));
    b = Math.round(139 + u * (38 - 139));
  }
  return `rgb(${r},${g},${b})`;
}

export default function VectorViz({ vector }: Props) {
  const [tooltip, setTooltip] = useState<{
    label: string;
    value: number;
    x: number;
    y: number;
  } | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span>Low</span>
        <div className="flex h-3 flex-1 rounded overflow-hidden">
          {Array.from({ length: 40 }, (_, i) => (
            <div
              key={i}
              className="flex-1"
              style={{ background: valueToColor(i / 39) }}
            />
          ))}
        </div>
        <span>High</span>
      </div>

      {VECTOR_CATEGORIES.map((cat) => {
        const slice = vector.slice(cat.start, cat.end);
        return (
          <div key={cat.name}>
            <div className="flex items-baseline gap-2 mb-1">
              <span
                className="text-xs font-semibold uppercase tracking-wide"
                style={{ color: cat.color }}
              >
                {cat.name}
              </span>
              <span className="text-xs text-gray-400">{cat.weight} weight</span>
              <span className="text-xs text-gray-400 ml-auto">
                {slice.length} features
              </span>
            </div>

            <div className="flex flex-wrap gap-0.5">
              {slice.map((v, i) => {
                const label = cat.labels[i] ?? `dim ${cat.start + i}`;
                const absV = Math.abs(v);
                const displayV = Math.max(0, Math.min(1, absV));
                return (
                  <div
                    key={i}
                    className="w-5 h-5 rounded-sm cursor-default transition-transform hover:scale-125 hover:z-10 relative"
                    style={{ background: valueToColor(displayV) }}
                    onMouseEnter={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setTooltip({ label, value: v, x: rect.left, y: rect.top });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {tooltip && (
        <div
          className="fixed z-50 bg-gray-900 text-white text-xs rounded px-2 py-1 pointer-events-none shadow-lg"
          style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
        >
          <div className="font-medium">{tooltip.label}</div>
          <div className="text-gray-300">{tooltip.value.toFixed(4)}</div>
        </div>
      )}
    </div>
  );
}
