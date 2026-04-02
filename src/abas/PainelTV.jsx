import React, { useEffect, useState } from "react";
import Etiqueta from "../components/Etiqueta";
import { MAQUINAS } from "../lib/constants";
import { fmtElapsedSince, getOrderStopDisplay, getProductionStartedAt, statusClass } from "../lib/utils";
import "../styles/PainelTV.css";

function ItemResumo({
  title,
  ordem,
  machineId,
  stopReason,
  fallback = "Sem programação",
}) {
  if (!ordem) {
    return (
      <div className="tv-item-wrap">
        <div className="tv-item-title tv-item-title-muted">{title}</div>
        <div className="tv-item-empty">{fallback}</div>
      </div>
    );
  }

  const opCode = ordem?.code || ordem?.o?.code || ordem?.op_code || "-";
  const lidas = Number(ordem?.scanned_count || 0);
  const saldo = Math.max(0, (Number(ordem?.boxes) || 0) - lidas);

  return (
    <div className="tv-item-wrap">
      <div className="tv-item-title">{title}</div>
      <div className={statusClass(ordem?.status)}>
        {opCode && <div className="hdr-right op-inline tv-op-inline">O.P - {opCode}</div>}

        <Etiqueta
          o={ordem}
          variant="painel"
          lidasCaixas={["P1", "P2", "P3"].includes(machineId) ? lidas : undefined}
          saldoCaixas={["P1", "P2", "P3"].includes(machineId) ? saldo : undefined}
          compactPills={true}
        />

        {ordem?.status === "PARADA" && stopReason && (
          <div className="stop-reason-below">{stopReason}</div>
        )}
      </div>
    </div>
  );
}

export default function PainelTV({
  ativosPorMaquina,
  paradas,
  lastFinalizadoPorMaquina,
}) {
  const source = ativosPorMaquina || {};
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = setInterval(() => setCurrentTimeMs(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, []);

  return (
    <div className="tv-wrapper">
      <div className="tv-header">
        <h1 className="tv-title">Painel Geral de Produção</h1>
      </div>

      <div className="tv-board">
        {MAQUINAS.map((machineId) => {
          const lista = source[machineId] || [];
          const atual = lista[0] || null;
          const proximo = lista[1] || null;

          const { stopStartedAt, stopReason } = getOrderStopDisplay(atual, paradas)

          const stopText = stopStartedAt
            ? fmtElapsedSince(stopStartedAt, currentTimeMs)
            : null;

          const produzindoText =
            atual?.status === "PRODUZINDO"
              ? fmtElapsedSince(getProductionStartedAt(atual), currentTimeMs)
              : null;

          const semProgText = !atual
            ? (() => {
                const lastFinISO = lastFinalizadoPorMaquina?.[machineId] || null;
                if (!lastFinISO) return null;
                return fmtElapsedSince(lastFinISO, currentTimeMs);
              })()
            : null;

          const lowEffText =
            atual?.status === "BAIXA_EFICIENCIA" && atual?.loweff_started_at
              ? fmtElapsedSince(atual.loweff_started_at, currentTimeMs)
              : null;

          return (
            <section key={machineId} className="column tv-column">
              <div className="column-header tv-column-header">
                <div className="tv-machine-name">{machineId}</div>
                <div className="tv-header-timers">
                  {stopText && <span className="parada-timer">{stopText}</span>}
                  {produzindoText && <span className="produzindo-timer">{produzindoText}</span>}
                  {lowEffText && <span className="loweff-timer">{lowEffText}</span>}
                  {semProgText && <span className="semprog-timer">{semProgText}</span>}
                </div>
              </div>

              <div className="column-body tv-column-body">
                <div className="tv-items-grid">
                  <ItemResumo
                    title="Atual"
                    ordem={atual}
                    machineId={machineId}
                    stopReason={stopReason}
                  />
                  <ItemResumo
                    title="Próximo"
                    ordem={proximo}
                    machineId={machineId}
                    stopReason=""
                  />
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
