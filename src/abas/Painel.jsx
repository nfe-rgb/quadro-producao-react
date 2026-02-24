// src/pages/Painel.jsx

import React, { useEffect, useState } from "react";
import Etiqueta from "../components/Etiqueta";
import { MAQUINAS, STATUS } from "../lib/constants";
import { statusClass, jaIniciou } from "../lib/utils";
import "../styles/Barrademeta.css";
import { DateTime } from "luxon";
import { supabase } from "../lib/supabaseClient";

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
  metaPercent = 46.22,
  onScanned, // opcional: callback do pai para re-fetch geral
  authUser,
  machinePriorities = {},
}) {
  const pct = Math.max(0, Math.min(100, Math.round(metaPercent)));
  const pctText = `${pct}%`;

  // localAtivos é o estado usado para render e será atualizado via realtime
  const [localAtivos, setLocalAtivos] = useState(ativosPorMaquina || {});

  // Sincroniza props -> localAtivos, mas preservando scanned_count vindo do realtime (merge)
  useEffect(() => {
    const incoming = ativosPorMaquina || {};
    setLocalAtivos((prev) => {
      if (!prev || Object.keys(prev).length === 0) return incoming;

      const merged = {};
      for (const m of Object.keys(incoming)) {
        const incomingList = incoming[m] || [];
        const prevList = prev[m] || [];
        merged[m] = incomingList.map((inItem) => {
          const match = prevList.find(
            (p) =>
              String(p?.id) === String(inItem?.id) ||
              String(p?.code) === String(inItem?.code) ||
              String(p?.op_code) === String(inItem?.op_code)
          );
          if (match && typeof match.scanned_count !== "undefined") {
            return { ...inItem, scanned_count: match.scanned_count };
          }
          // normalize scanned_count to number (0 if missing)
          return {
            ...inItem,
            scanned_count:
              typeof inItem.scanned_count === "number"
                ? inItem.scanned_count
                : Number(inItem.scanned_count || 0),
          };
        });
      }
      // keep previous machines not present in incoming (rare)
      for (const m of Object.keys(prev)) {
        if (!(m in merged)) merged[m] = prev[m];
      }
      return merged;
    });
  }, [ativosPorMaquina]);

  // util helper para testar se um item corresponde a um order_id / code
  function matchesOrder(item, orderIdOrCode) {
    if (!item || !orderIdOrCode) return false;
    const candidates = [
      item?.id,
      item?.order_id,
      item?.ordem?.id,
      item?.order?.id,
      item?.o?.id,
      item?.op_code,
      item?.code,
      item?.ordem?.code,
    ]
      .filter(Boolean)
      .map(String);
    const target = String(orderIdOrCode);
    return candidates.includes(target);
  }

  // Realtime subscription: quando houver INSERT em production_scans, atualiza counted scans e chama onScanned
  useEffect(() => {
    const channel = supabase
      .channel("scans-ch")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "production_scans" },
        async (payload) => {
          try {
            const newRow = payload.new;
            if (!newRow) return;

            // prefer machine_id informado no scan; se não vier, deixamos procurar em todas
            const scanOrderId = newRow.order_id;
            const scanMachineId = newRow.machine_id;

            // obtém count atual de production_scans para essa order_id
            let scannedCount = 0;
            try {
              const { error: countErr, count } = await supabase
                .from("production_scans")
                .select("*", { head: true, count: "exact" })
                .eq("order_id", scanOrderId);

              if (!countErr) scannedCount = Number(count || 0);
              else {
                console.warn("Painel: falha ao calcular scanned_count:", countErr);
              }
            } catch (err) {
              console.error("Painel: erro ao consultar scanned_count:", err);
            }

            // Atualiza localAtivos apenas na máquina afetada (se souber) ou procura em todas
            setLocalAtivos((prev) => {
              if (!prev) return prev;
              const copy = { ...prev };
              const orderIdStr = String(scanOrderId);
              let found = false;

              // prioridade: aplicar apenas na machine informada pelo scan (evita percorrer tudo)
              const machinesToCheck =
                scanMachineId && copy[scanMachineId]
                  ? [scanMachineId]
                  : Object.keys(copy);

              for (const machine of machinesToCheck) {
                copy[machine] = (copy[machine] || []).map((item) => {
                  if (matchesOrder(item, orderIdStr)) {
                    found = true;
                    return { ...item, scanned_count: scannedCount };
                  }
                  return item;
                });
              }

              // fallback: se não encontrou e scan não informou machine_id, tente procurar em todas
              if (!found) {
                for (const machine of Object.keys(copy)) {
                  copy[machine] = (copy[machine] || []).map((item) => {
                    if (matchesOrder(item, orderIdStr)) {
                      found = true;
                      return { ...item, scanned_count: scannedCount };
                    }
                    return item;
                  });
                }
              }

              // se nada for encontrado, retorna prev (sem alteração)
              return found ? copy : prev;
            });

            // opcional: avisa o pai (App) para, se quiser, refazer fetch completo
            if (typeof onScanned === "function") {
              try {
                onScanned(newRow);
              } catch (err) {
                console.warn("onScanned callback falhou:", err);
              }
            }
          } catch (err) {
            console.error("Erro no handler realtime scans:", err);
          }
        }
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch (err) {
        console.warn("Falha ao remover canal realtime:", err);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Estado para armazenar o started_at do log aberto de baixa eficiência por máquina
  const [lowEffStartedAt, setLowEffStartedAt] = useState({});

  function priorityTone(value) {
    if (value == null || Number.isNaN(Number(value))) return "priority-chip-gray";
    const n = Number(value);
    if (n >= 5) return "priority-chip-green";
    if (n >= 3) return "priority-chip-yellow";
    if (n >= 1) return "priority-chip-red";
    return "priority-chip-gray";
  }

  // Efeito para buscar o log aberto de baixa eficiência para cada máquina ativa
  useEffect(() => {
    async function fetchLowEffLogs() {
      const result = {};
      for (const m of MAQUINAS) {
        const lista = (localAtivos && localAtivos[m]) || [];
        const ativa = lista[0] || null;
        if (ativa && ativa.status === "BAIXA_EFICIENCIA") {
          // Busca log aberto para essa ordem/máquina
          let query = supabase
            .from("low_efficiency_logs")
            .select("started_at")
            .is("ended_at", null)
            .eq("machine_id", m);
          if (ativa.id) query = query.eq("order_id", ativa.id);
          const { data, error } = await query;
          if (!error && data && data.length > 0) {
            result[m] = data[0].started_at;
          }
        }
      }
      setLowEffStartedAt(result);
    }
    fetchLowEffLogs();
    // Executa sempre que localAtivos ou status mudam
  }, [localAtivos, tick]);
  
  async function insertLowEfficiencyLog({ order_id = null, machine_id, started_by = null, notes = null }) {
    try {
      const payload = {
        order_id: order_id || null,
        machine_id,
        started_at: new Date().toISOString(),
        started_by,
        notes,
      };
      const { data, error } = await supabase.from("low_efficiency_logs").insert(payload).select();
      if (error) {
        console.error("Erro inserindo low_efficiency_logs:", error);
        return { error };
      }
      return { data };
    } catch (err) {
      console.error("Exception insertLowEfficiencyLog:", err);
      return { error: err };
    }
  }

  async function endLowEfficiencyLog({ order_id = null, machine_id, ended_by = null, notes = null }) {
    try {
      const updates = {
        ended_at: new Date().toISOString(),
        ended_by,
        notes,
      };

      // Se order_id estiver disponível, preferimos usá-lo para encontrar o log aberto.
      // Caso contrário, usamos machine_id e ended_at IS NULL.
      let query = supabase.from("low_efficiency_logs").update(updates).is("ended_at", null);

      if (order_id) {
        query = query.eq("order_id", order_id);
      } else {
        query = query.eq("machine_id", machine_id);
      }

      // Executa update
      const { data, error } = await query.select();
      if (error) {
        console.error("Erro ao encerrar low_efficiency_logs:", error);
        return { error };
      }
      return { data };
    } catch (err) {
      console.error("Exception endLowEfficiencyLog:", err);
      return { error: err };
    }
  }

  const source = localAtivos || {};

  return (
    <div className="board-wrapper">
      <div className="meta-banner" role="status" aria-live="polite">
        <div className="meta-banner-inner">
          <span className="meta-msg">🚀 Alcançamos&nbsp;</span>
          <span className="meta-percent">{pctText}</span>
          <span className="meta-msg">&nbsp;da meta! 🚀</span>
        </div>
      </div>

      <div className="board">
        {MAQUINAS.map((m) => {
          const lista = source[m] ?? [];
          const ativa = lista[0] || null;

          const openStop = ativa
            ? paradas.find((p) => p.order_id === String(ativa.id) && !p.resumed_at)
            : null;

          const sinceMs = openStop ? new Date(openStop.started_at).getTime() : null;

          const durText = sinceMs
            ? (() => {
                const _ = tick;
                const total = Math.max(0, Math.floor((Date.now() - sinceMs) / 1000));
                return formatHHMMSS(total);
              })()
            : null;

          // Timer de baixa eficiência usando started_at do log aberto
          const lowEffText =
            ativa?.status === "BAIXA_EFICIENCIA" && lowEffStartedAt[m]
              ? (() => {
                  const _ = tick;
                  const secs =
                    (Date.now() - new Date(lowEffStartedAt[m]).getTime()) / 1000;
                  return formatHHMMSS(secs);
                })()
              : null;

          let semProgText = null;
          // Mostrar cronômetro "Sem Programação" quando não há ativa
          // ou quando a ordem está em "AGUARDANDO" (antes de iniciar produção)
          if (!ativa || ativa.status === "AGUARDANDO") {
            const lastFinISO = lastFinalizadoPorMaquina?.[m] || null;
            if (lastFinISO) {
              const _ = tick;
              const since = new Date(lastFinISO).getTime();
              const total = Math.max(0, Math.floor((Date.now() - since) / 1000));
              semProgText = formatHHMMSS(total);
            }
          }

          const opCode = ativa?.code || ativa?.o?.code || ativa?.op_code || "";

          // lidas / saldo: scanned_count agora pode vir do fetch inicial ou do realtime
          const lidas = Number(ativa?.scanned_count || 0);
          const saldo = ativa ? Math.max(0, (Number(ativa.boxes) || 0) - lidas) : 0;

          const priorityValue = machinePriorities?.[m];

          return (
            <div key={m} className="column">
              <div
                className={
                  "column-header " +
                  (ativa?.status === "PARADA" ? "blink-red" : "")
                }
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                <div className="hdr-left" style={{ display: "flex", gap: 8 }}>
                  {m}

                  {ativa?.status === "PARADA" && durText && (
                    <span className="parada-timer">{durText}</span>
                  )}

                  {lowEffText && (
                    <span className="loweff-timer">{lowEffText}</span>
                  )}

                  {semProgText && (
                    <span className="semprog-timer">{semProgText}</span>
                  )}
                </div>
                <div className="hdr-right" style={{ marginLeft: "auto" }}>
                  <span className={`priority-chip ${priorityTone(priorityValue)}`}>
                    PRIORIDADE: {priorityValue ?? "-"}
                  </span>
                </div>
              </div>

              <div className="column-body">
                {ativa ? (
                  <div className={statusClass(ativa.status)}>
                      {opCode && (
                      <div className="hdr-right op-inline" style={{ marginBottom: 4, textAlign: 'left' }}>
                        O.P - {opCode}
                      </div>
                    )}
                    <Etiqueta
                      o={ativa}
                      variant="painel"
                      lidasCaixas={["P1", "P2", "P3"].includes(m) ? lidas : undefined}
                      saldoCaixas={["P1", "P2", "P3"].includes(m) ? saldo : undefined}
                      paradaReason={openStop?.reason}
                      paradaNotes={openStop?.notes}
                    />

                    {ativa?.status === "PARADA" && openStop?.reason && (
                      <div className="stop-reason-below">{openStop.reason}</div>
                    )}

                    {ativa?.status === "BAIXA_EFICIENCIA" && ativa?.loweff_notes && (
                      <div className="loweff-info-below">
                        <div className="loweff-reason-below">
                          {ativa.loweff_notes}
                        </div>
                      </div>
                    )}

                    <div className="sep" />

                    <div className="grid2">
                      <div>
                        <div className="label">Situação</div>

                        <select
                          className="select"
                          value={ativa.status}
                          onChange={async (e) => {
                            const novoStatus = e.target.value;
                            const prevStatus = ativa?.status;
                            // chama callback pai para atualizar status (mantém comportamento atual)
                            try {
                              onStatusChange(ativa, novoStatus);
                            } catch (err) {
                              console.warn("onStatusChange falhou:", err);
                            }
                          }}
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

                      <div className="flex" style={{ justifyContent: "flex-end", gap: 8 }}>
                        {ativa.status === "AGUARDANDO" ? (
                          <button
                            className="btn"
                            onClick={() => {
                              const nowBr = DateTime.now().setZone("America/Sao_Paulo");
                              setStartModal({
                                ordem: ativa,
                                operador: "",
                                data: nowBr.toISODate(),
                                hora: nowBr.toFormat("HH:mm"),
                              });
                            }}
                          >
                            Iniciar Produção
                          </button>
                        ) : (
                          <button className="btn" onClick={() => setFinalizando(ativa)}>
                            Finalizar
                          </button>
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
