import { useState } from "react";
import Library from "./components/Library.tsx";
import AddSong from "./components/AddSong.tsx";
import FindSimilar from "./components/FindSimilar.tsx";

type Tab = "library" | "add" | "find";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "library", label: "Library", icon: "🎵" },
  { id: "add", label: "Add Song", icon: "➕" },
  { id: "find", label: "Find Similar", icon: "🔍" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("library");

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🎧</span>
            <h1 className="text-lg font-bold tracking-tight">Audio Analyzer</h1>
          </div>
          <nav className="flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === t.id
                    ? "bg-indigo-600 text-white"
                    : "text-gray-400 hover:text-white hover:bg-gray-800"
                }`}
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {tab === "library" && <Library />}
        {tab === "add" && <AddSong />}
        {tab === "find" && <FindSimilar />}
      </main>
    </div>
  );
}
