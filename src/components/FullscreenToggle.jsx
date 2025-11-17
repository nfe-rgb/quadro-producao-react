// src/components/FullscreenToggle.jsx
import { Maximize2, Minimize2 } from "lucide-react";

export default function FullscreenToggle({ isFullscreen, toggle }) {
  return (
    <button
      onClick={toggle}
      style={{
        background: "#444",
        border: "none",
        padding: "8px 12px",
        color: "white",
        cursor: "pointer",
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
      Tela Cheia (Ctrl+Alt+F)
    </button>
  );
}
