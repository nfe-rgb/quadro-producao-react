// src/routes/PainelTV.jsx
import { useEffect, useState } from "react";
import Painel from "../abas/Painel";
import MetaScreen from "../components/MetaScreen";

export default function PainelTV() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showMeta, setShowMeta] = useState(false);

  // ENTRAR SAIR DA TELA CHEIA
  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (err) {
      console.error("Erro ao alternar fullscreen", err);
    }
  };

  // ATAHO CTRL + ALT + F
  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === "f") {
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ALTERNÂNCIA AUTOMÁTICA
  useEffect(() => {
    const interval = setInterval(() => {
      setShowMeta(true);

      const timeout = setTimeout(() => {
        setShowMeta(false);
      }, 30000); // 30 segundos

      return () => clearTimeout(timeout);
    }, 30 * 60 * 1000); // 30 minutos

    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      {showMeta ? <MetaScreen /> : <Painel isTV />}
    </div>
  );
}
