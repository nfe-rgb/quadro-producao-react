import React from "react";
import { MAQUINAS } from "../lib/constants";

export default function Prioridade({ machinePriorities = {}, onChangePriority, loading, authUser }) {
  const canEdit = authUser?.email?.toLowerCase() === "nfe@savantiplasticos.com.br";

  function toneClass(value) {
    if (value == null || Number.isNaN(Number(value))) return "priority-chip-gray";
    const n = Number(value);
    if (n >= 5) return "priority-chip-green";
    if (n >= 3) return "priority-chip-yellow";
    if (n >= 1) return "priority-chip-red";
    return "priority-chip-gray";
  }

  return (
    <div style={{ padding: 24, maxWidth: 640, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 12 }}>Prioridades por Máquina</h1>
      <p style={{ marginBottom: 16, color: "#475569" }}>
        As prioridades aparecem no painel para todos. Somente o e-mail autorizado pode alterar.
      </p>

      {loading && <div style={{ marginBottom: 12 }}>Carregando prioridades…</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {MAQUINAS.map((m) => {
          const val = machinePriorities[m] ?? "";
          return (
            <div
              key={m}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                background: "#fff",
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
              }}
            >
              <div style={{ fontWeight: 800, width: 60 }}>{m}</div>
              <span className={`priority-chip ${toneClass(val)}`}>PRIORIDADE: {val === "" ? "-" : val}</span>
              <input
                type="number"
                min="0"
                max="10"
                step="1"
                value={val}
                onChange={(e) => { if (canEdit) onChangePriority(m, e.target.value); }}
                className="priority-input"
                style={{ marginLeft: "auto", width: 100 }}
                disabled={!canEdit}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
