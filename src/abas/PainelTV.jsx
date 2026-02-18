import React from "react";
import Etiqueta from "../components/Etiqueta";
import { MAQUINAS } from "../lib/constants";
import { statusClass } from "../lib/utils";
import "../styles/PainelTV.css";

function formatHHMMSS(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function ItemResumo({ title, ordem, machineId, openStop, fallback = "Sem programação" }) {
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
          paradaReason={openStop?.reason}
          paradaNotes={openStop?.notes}
        />
      </div>
    </div>
  );
}

export default function PainelTV({
  ativosPorMaquina,
  paradas,
  tick,
  lastFinalizadoPorMaquina,
}) {
  const source = ativosPorMaquina || {};

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

          const openStop = atual
            ? paradas.find((p) => p.order_id === String(atual.id) && !p.resumed_at)
            : null;

          const stopText = openStop
            ? (() => {
                const _ = tick;
                const total = Math.max(
                  0,
                  Math.floor((Date.now() - new Date(openStop.started_at).getTime()) / 1000)
                );
                return formatHHMMSS(total);
              })()
            : null;

          const semProgText = !atual
            ? (() => {
                const lastFinISO = lastFinalizadoPorMaquina?.[machineId] || null;
                if (!lastFinISO) return null;
                const _ = tick;
                const total = Math.max(
                  0,
                  Math.floor((Date.now() - new Date(lastFinISO).getTime()) / 1000)
                );
                return formatHHMMSS(total);
              })()
            : null;

          return (
            <section key={machineId} className="column tv-column">
              <div className="column-header tv-column-header">
                <div className="tv-machine-name">{machineId}</div>
                <div className="tv-header-timers">
                  {stopText && <span className="parada-timer">{stopText}</span>}
                  {semProgText && <span className="semprog-timer">{semProgText}</span>}
                </div>
              </div>

              <div className="column-body tv-column-body">
                <div className="tv-items-grid">
                  <ItemResumo title="Atual" ordem={atual} machineId={machineId} openStop={openStop} />
                  <ItemResumo title="Próximo" ordem={proximo} machineId={machineId} openStop={null} />
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
