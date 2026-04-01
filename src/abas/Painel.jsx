// src/pages/Painel.jsx

import React, { useEffect, useState } from "react";
import Etiqueta from "../components/Etiqueta";
import { MAQUINAS, STATUS } from "../lib/constants";
import { statusClass, jaIniciou } from "../lib/utils";
import "../styles/Barrademeta.css";
import { DateTime } from "luxon";
import { supabase } from "../lib/supabaseClient";

function parsePiecesPerBox(val) {
  if (val == null) return 0;
  const s = String(val).trim();
  if (!s) return 0;
  const digitsOnly = s.replace(/[^0-9]/g, "");
  if (!digitsOnly) return 0;
  return parseInt(digitsOnly, 10);
}

function extractItemCodeFromOrderProduct(product) {
  if (!product) return null;
  const t = String(product);
  return t.split("-")[0]?.trim() || null;
}

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
  onStatusChange,
  setStartModal,
  setFinalizando,
  lastFinalizadoPorMaquina,
  metaPercent,
  onScanned, // opcional: callback do pai para re-fetch geral
  machinePriorities = {},
}) {
  const META_MENSAL = 770000;
  const [producaoMesAtual, setProducaoMesAtual] = useState(0);
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now());

  const metaMensalPercent =
    META_MENSAL > 0 ? (producaoMesAtual / META_MENSAL) * 100 : 0;
  const pct = Math.max(0, Math.min(100, Number(metaPercent ?? metaMensalPercent)));
  const pctText = `${pct.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;

  useEffect(() => {
    const intervalId = setInterval(() => setCurrentTimeMs(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    let active = true;

    async function fetchValorizacaoMes() {
      try {
        const nowSP = DateTime.now().setZone("America/Sao_Paulo");
        const startIso = nowSP.startOf("month").toUTC().toISO();
        const endIso = nowSP.toUTC().toISO();

        const [scansRes, apontRes] = await Promise.all([
          supabase
            .from("production_scans")
            .select("order_id,machine_id")
            .gte("created_at", startIso)
            .lte("created_at", endIso),
          supabase
            .from("injection_production_entries")
            .select("order_id,machine_id,good_qty,product")
            .gte("created_at", startIso)
            .lte("created_at", endIso),
        ]);

        if (scansRes.error) throw scansRes.error;
        if (apontRes.error) throw apontRes.error;

        const setorValido = (machineId) => {
          const m = String(machineId || "").toUpperCase();
          return m.startsWith("P") || m.startsWith("I");
        };

        const scans = (scansRes.data || []).filter((s) => setorValido(s.machine_id));
        const aponts = (apontRes.data || []).filter((a) => setorValido(a.machine_id));

        const orderIds = Array.from(
          new Set(
            [...scans, ...aponts]
              .map((r) => (r?.order_id != null ? String(r.order_id) : null))
              .filter(Boolean)
          )
        );

        let ordersMap = {};
        if (orderIds.length > 0) {
          const { data: ordersData, error: ordersErr } = await supabase
            .from("orders")
            .select("id,product,standard")
            .in("id", orderIds);
          if (ordersErr) throw ordersErr;
          ordersMap = (ordersData || []).reduce((acc, o) => {
            if (o?.id != null) acc[String(o.id)] = o;
            return acc;
          }, {});
        }

        const productCodesSet = new Set();
        scans.forEach((s) => {
          const order = s?.order_id != null ? ordersMap[String(s.order_id)] : null;
          const code = extractItemCodeFromOrderProduct(order?.product);
          if (code) productCodesSet.add(code);
        });
        aponts.forEach((a) => {
          const order = a?.order_id != null ? ordersMap[String(a.order_id)] : null;
          const product = a?.product || order?.product;
          const code = extractItemCodeFromOrderProduct(product);
          if (code) productCodesSet.add(code);
        });

        let itemValueMap = {};
        const productCodes = Array.from(productCodesSet);
        if (productCodes.length > 0) {
          const { data: itemsData, error: itemsErr } = await supabase
            .from("items")
            .select("code,unit_value")
            .in("code", productCodes);
          if (itemsErr) throw itemsErr;
          itemValueMap = (itemsData || []).reduce((acc, it) => {
            const code = String(it?.code || "").trim();
            if (code) acc[code] = Number(it?.unit_value) || 0;
            return acc;
          }, {});
        }

        let valorTotal = 0;

        scans.forEach((s) => {
          const order = s?.order_id != null ? ordersMap[String(s.order_id)] : null;
          const std = parsePiecesPerBox(order?.standard);
          if (std <= 0) return;
          const code = extractItemCodeFromOrderProduct(order?.product);
          const unitValue = code ? Number(itemValueMap[code] || 0) : 0;
          if (unitValue > 0) valorTotal += std * unitValue;
        });

        aponts.forEach((a) => {
          const qty = Number(a?.good_qty) || 0;
          if (qty <= 0) return;
          const order = a?.order_id != null ? ordersMap[String(a.order_id)] : null;
          const product = a?.product || order?.product;
          const code = extractItemCodeFromOrderProduct(product);
          const unitValue = code ? Number(itemValueMap[code] || 0) : 0;
          if (unitValue > 0) valorTotal += qty * unitValue;
        });

        if (active) setProducaoMesAtual(valorTotal);
      } catch (err) {
        console.warn("Painel: erro ao calcular valorizacao mensal:", err);
        if (active) setProducaoMesAtual(0);
      }
    }

    fetchValorizacaoMes();
    // IMPORTANTE: Intervalo aumentado para 5 minutos para reduzir consumo de saída do Supabase
    const intervalId = setInterval(fetchValorizacaoMes, 300000); // 5 minutos

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, []);

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

  function priorityTone(value) {
    if (value == null || Number.isNaN(Number(value))) return "priority-chip-gray";
    const n = Number(value);
    if (n >= 5) return "priority-chip-green";
    if (n >= 3) return "priority-chip-yellow";
    if (n >= 1) return "priority-chip-red";
    return "priority-chip-gray";
  }

  const source = localAtivos || {};

  return (
    <div className="board-wrapper">
      <div className="meta-banner" role="status" aria-live="polite">
        <div className="meta-banner-inner">
          <span className="meta-msg">🚀 Alcançamos&nbsp;</span>
          <span className="meta-percent">{pctText}</span>
          <span className="meta-msg">&nbsp;da meta mensal! 🚀</span>
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
                const total = Math.max(0, Math.floor((currentTimeMs - sinceMs) / 1000));
                return formatHHMMSS(total);
              })()
            : null;

          // Timer de baixa eficiência usando started_at do log aberto
          const lowEffText =
            ativa?.status === "BAIXA_EFICIENCIA" && ativa?.loweff_started_at
              ? (() => {
                  const secs =
                    (currentTimeMs - new Date(ativa.loweff_started_at).getTime()) / 1000;
                  return formatHHMMSS(secs);
                })()
              : null;

          let semProgText = null;
          // Mostrar cronômetro "Sem Programação" quando não há ativa
          // ou quando a ordem está em "AGUARDANDO" (antes de iniciar produção)
          if (!ativa || ativa.status === "AGUARDANDO") {
            const lastFinISO = lastFinalizadoPorMaquina?.[m] || null;
            if (lastFinISO) {
              const since = new Date(lastFinISO).getTime();
              const total = Math.max(0, Math.floor((currentTimeMs - since) / 1000));
              semProgText = formatHHMMSS(total);
            }
          }

          const opCode = ativa?.code || ativa?.o?.code || ativa?.op_code || "";
          const precisaRegularizarSessao = Boolean(
            ativa && String(ativa.status || '').toUpperCase() !== 'AGUARDANDO' && !ativa.active_session_id
          );

          // lidas / saldo: scanned_count agora pode vir do fetch inicial ou do realtime
          const lidas = Number(ativa?.scanned_count || 0);
          const saldo = ativa ? Math.max(0, (Number(ativa.boxes) || 0) - lidas) : 0;
          const showPetCounts = ["P1", "P2", "P3", "P4"].includes(m);

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
                      lidasCaixas={showPetCounts ? lidas : undefined}
                      saldoCaixas={showPetCounts ? saldo : undefined}
                      paradaReason={openStop?.reason}
                      paradaNotes={openStop?.notes}
                    />

                    {ativa?.status === "PARADA" && openStop?.reason && (
                      <div className="stop-reason-below">{openStop.reason}</div>
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
                            // chama callback pai para atualizar status (mantém comportamento atual)
                            try {
                              onStatusChange(ativa, novoStatus);
                            } catch (err) {
                              console.warn("onStatusChange falhou:", err);
                            }
                          }}
                          disabled={ativa.status === "AGUARDANDO" || precisaRegularizarSessao}
                        >
                          {STATUS.filter((s) =>
                            s === "AGUARDANDO"
                              ? String(ativa?.status || "").toUpperCase() === "AGUARDANDO"
                              : true
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
                        {precisaRegularizarSessao && (
                          <div className="small" style={{ marginTop: 6, color: '#b45309' }}>
                            Ordem sem sessão ativa. Regularize pelo botão de início.
                          </div>
                        )}
                      </div>

                      <div className="flex" style={{ justifyContent: "flex-end", gap: 8 }}>
                        {ativa.status === "AGUARDANDO" || precisaRegularizarSessao ? (
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
                            {precisaRegularizarSessao ? 'Regularizar Produção' : 'Iniciar Produção'}
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
