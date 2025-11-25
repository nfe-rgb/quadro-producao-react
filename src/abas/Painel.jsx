import React from "react";
import Etiqueta from "../components/Etiqueta";
import { MAQUINAS, STATUS } from "../lib/constants";
import { statusClass, jaIniciou } from "../lib/utils";
import "../styles/Barrademeta.css";

// Helper para formatar HH:MM:SS
function formatHHMMSS(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export default function Painel({
  ativosPorMaquina,
  paradas,
  tick,
  onStatusChange,
  setStartModal,
  setFinalizando,
  lastFinalizadoPorMaquina,
  metaPercent = 67,
}) {
  // Normaliza metaPercent para 0..100 e adiciona formatação
  const pct = Math.max(0, Math.min(100, Math.round(metaPercent)));
  const pctText = `${pct}%`;

  return (
    <div className="board-wrapper">
      {/* Faixa fixa no topo (aparece somente nesta tela - como este é o componente Painel) */}
      <div className="meta-banner" role="status" aria-live="polite">
        <div className="meta-banner-inner" aria-hidden="false">
          <span className="meta-msg">🚀 Estamos a&nbsp;</span>
          <span className="meta-percent">{pctText}</span>
          <span className="meta-msg">&nbsp;da meta! 🚀</span>
        </div>
      </div>

      <div className="board">
        {MAQUINAS .filter((m) => m !== "P4") .map((m) => {
          const lista = ativosPorMaquina[m] ?? [];
          const ativa = lista[0] || null;

          // Parada aberta -> cronômetro vermelho no cabeçalho
          const openStop = ativa
            ? paradas.find((p) => p.order_id === ativa.id && !p.resumed_at)
            : null;
          const sinceMs = openStop ? new Date(openStop.started_at).getTime() : null;
          const stopReason = openStop?.reason || null;
          const stopNotes = openStop?.notes || null;
          const durText = sinceMs
            ? (() => {
                // força re-render pelo tick
                // eslint-disable-next-line no-unused-vars
                const _ = tick;
                const total = Math.max(
                  0,
                  Math.floor((Date.now() - sinceMs) / 1000)
                );
                const h = String(Math.floor(total / 3600)).padStart(2, "0");
                const mn = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
                const s = String(total % 60).padStart(2, "0");
                return `${h}:${mn}:${s}`;
              })()
            : null;

          // Baixa eficiência -> cronômetro amarelo no cabeçalho (igual ao de parada)
          const lowEffText =
            ativa?.status === "BAIXA_EFICIENCIA" && ativa?.loweff_started_at
              ? (() => {
                  // força re-render pelo tick
                  // eslint-disable-next-line no-unused-vars
                  const _ = tick;
                  const secs =
                    (Date.now() -
                      new Date(ativa.loweff_started_at).getTime()) / 1000;
                  return formatHHMMSS(secs);
                })()
              : null;

          // ⬇️ NOVO: cronômetro “Sem programação” (azul) no cabeçalho
          let semProgText = null;
          if (!ativa) {
            const lastFinISO = lastFinalizadoPorMaquina?.[m] || null;
            if (lastFinISO) {
              // força re-render pelo tick
              // eslint-disable-next-line no-unused-vars
              const _ = tick;
              const sinceMs = new Date(lastFinISO).getTime();
              const total = Math.max(0, Math.floor((Date.now() - sinceMs) / 1000));
              semProgText = formatHHMMSS(total);
            }
          }

          // O.P no cabeçalho (lado direito)
          const opCode =
            ativa?.o?.code ??
            ativa?.code ??
            ativa?.ordem?.code ??
            ativa?.order?.code ??
            "";

          return (
            <div key={m} className="column">
              {/* ===== Cabeçalho: máquina, cronômetros e O.P ===== */}
              <div
                className={
                  "column-header " + (ativa?.status === "PARADA" && stopReason !== "FIM DE SEMANA" ? "blink-red" : "")
                }
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                <div
                  className="hdr-left"
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  {m}

                  {/* Cronômetro de PARADA (vermelho) */}
                  {ativa?.status === "PARADA" && durText && (
                    <span className="parada-timer">{durText}</span>
                  )}

                  {/* Cronômetro de BAIXA_EFICIENCIA (amarelo) — mesmo lugar e formato */}
                  {lowEffText && (
                    <span
                      className="loweff-timer"
                      title={ativa?.loweff_by ? `Operador: ${ativa.loweff_by}` : ""}
                    >
                      {lowEffText}
                    </span>
                  )}
                  {/* ⬇️ NOVO: Cronômetro SEM PROGRAMAÇÃO (azul) */}
                  {!ativa && semProgText && (
                    <span className="semprog-timer" title="Sem programação desde a última finalização">
                      {semProgText}
                    </span>
                  )}
                </div>

                {/* lado direito: O.P */}
                {opCode && (
                  <div className="hdr-right op-inline" style={{ marginLeft: "auto" }}>
                    O.P - {opCode}
                  </div>
                )}
              </div>

              {/* ===== Corpo ===== */}
              <div className="column-body">
                {ativa ? (
                  <div className={statusClass(ativa.status)}>
                    {/* Detalhes da O.P */}
                    <Etiqueta
                      o={ativa.o || ativa}
                      variant="painel"
                      lidasCaixas={['P1','P2','P3'].includes(m) ? (ativa._scansCount || 0) : undefined}
                      saldoCaixas={['P1','P2','P3'].includes(m) ? Math.max(0, (ativa.boxes || 0) - (ativa._scansCount || 0)) : undefined}
                      paradaReason={stopReason}
                      paradaNotes={stopNotes}
                    />
                    {/* Motivo da PARADA, centralizado, sem cronômetro */}
                    {ativa?.status === "PARADA" && stopReason && (
                      <div className="stop-reason-below">{stopReason}</div>
                    )}
                    <div className="sep"></div>
                    <div className="grid2">
                      <div>
                        <div className="label">Situação</div>
                        <select
                          className="select"
                          value={ativa.status}
                          onChange={(e) => onStatusChange(ativa, e.target.value)}
                          disabled={ativa.status === "AGUARDANDO"}
                        >
                          {STATUS.filter((s) =>
                            jaIniciou(ativa) ? s !== "AGUARDANDO" : true
                          ).map((s) => (
                            <option key={s} value={s}>
                              {s === "AGUARDANDO"
                                ? "Aguardando"
                                : s === "PRODUZINDO"
                                ? "Produzindo"
                                : s === "BAIXA_EFICIENCIA"
                                ? "Baixa Eficiência"
                                : "Parada"}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div
                        className="flex"
                        style={{ justifyContent: "flex-end", gap: 8 }}
                      >
                        {ativa.status === "AGUARDANDO" ? (
                          <button
                            className="btn"
                            onClick={() => {
                              const now = new Date();
                              setStartModal({
                                ordem: ativa,
                                operador: "",
                                data: now.toISOString().slice(0, 10),
                                hora: now.toTimeString().slice(0, 5),
                              });
                            }}
                          >
                            Iniciar Produção
                          </button>
                        ) : (
                          <>
                            <button
                              className="btn"
                              onClick={() => setFinalizando(ativa)}
                            >
                              Finalizar
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="muted">Sem Programação</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
