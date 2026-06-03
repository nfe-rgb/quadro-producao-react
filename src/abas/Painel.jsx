// src/pages/Painel.jsx

import React, { useEffect, useState } from "react";
import Etiqueta from "../components/Etiqueta";
import { MAQUINAS, STATUS } from "../lib/constants";
import { fmtElapsedSince, getOrderStopDisplay, getProductionStartedAt, statusClass } from "../lib/utils";
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

function mergeRowsById(rows) {
  const byId = new Map();
  const withoutId = [];

  for (const row of rows || []) {
    const rowId = row?.id != null ? String(row.id).trim() : "";
    if (rowId) byId.set(rowId, row);
    else withoutId.push(row);
  }

  return [...byId.values(), ...withoutId];
}

function normalizeOptionalValue(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function getOrderRecordId(order) {
  return normalizeOptionalValue(order?.source_order_id ?? order?.id ?? order?.order_id);
}

function getOrderRecordCode(order) {
  return normalizeOptionalValue(order?.code ?? order?.op_code ?? order?.o?.code ?? order?.ordem?.code);
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
  const [itemTechByCode, setItemTechByCode] = useState({});

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

  useEffect(() => {
    let active = true;

    async function fetchItemTech() {
      const codes = new Set();
      MAQUINAS.forEach((machineId) => {
        const queue = ativosPorMaquina?.[machineId] || [];
        [queue[0], queue[1]].forEach((ordem) => {
          const raw = ordem?.product;
          if (!raw) return;
          const code = extractItemCodeFromOrderProduct(raw);
          if (code) codes.add(code);
        });
      });

      const codeList = Array.from(codes);
      if (codeList.length === 0) {
        if (active) setItemTechByCode({});
        return;
      }

      const { data, error } = await supabase
        .from("items")
        .select("code,cycle_seconds,cavities")
        .in("code", codeList);

      if (!active) return;
      if (error) {
        console.warn("Painel: falha ao carregar ciclo/cavidades dos itens:", error);
        return;
      }

      const mapped = (data || []).reduce((acc, item) => {
        const code = String(item?.code || "").trim();
        if (!code) return acc;
        acc[code] = {
          cycleSeconds: Number(item?.cycle_seconds || 0),
          cavities: Number(item?.cavities || 0),
        };
        return acc;
      }, {});
      setItemTechByCode(mapped);
    }

    fetchItemTech();
    return () => {
      active = false;
    };
  }, [ativosPorMaquina]);

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
            const incomingScannedCount = Number(inItem.scanned_count || 0);
            const previousScannedCount = Number(match.scanned_count || 0);
            const incomingScannedPieces = Number(inItem.scanned_pieces || 0);
            const previousScannedPieces = Number(match.scanned_pieces || 0);
            const incomingManualPieces = Number(inItem.manual_pieces || 0);
            const previousManualPieces = Number(match.manual_pieces || 0);

            const mergedItem = {
              ...inItem,
              scanned_count: Math.max(incomingScannedCount, previousScannedCount),
              scanned_pieces: Math.max(incomingScannedPieces, previousScannedPieces),
              manual_pieces: Math.max(incomingManualPieces, previousManualPieces),
            };
            return {
              ...mergedItem,
              apontadas_pieces: Math.max(
                Number(inItem.apontadas_pieces || 0),
                Number(match.apontadas_pieces || 0),
                Number(computeApontadasPieces(mergedItem) || 0)
              ) || undefined,
            };
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

  useEffect(() => {
    let active = true;

    async function fetchVisibleProductionTotals() {
      const targetsMap = new Map();

      for (const machineId of MAQUINAS) {
        const item = (ativosPorMaquina?.[machineId] || [])[0];
        if (!item) continue;

        const id = getOrderRecordId(item);
        const code = getOrderRecordCode(item);
        if (!id && !code) continue;

        targetsMap.set(`${id || ""}|${code || ""}`, { id, code });
      }

      const targets = Array.from(targetsMap.values());
      if (targets.length === 0) return;

      const orderIds = Array.from(new Set(targets.map((target) => target.id).filter(Boolean)));
      const opCodes = Array.from(new Set(targets.map((target) => target.code).filter(Boolean)));
      const emptyRes = { data: [], error: null };

      try {
        const [scansByIdRes, scansByCodeRes, manualByIdRes, manualByCodeRes] = await Promise.all([
          orderIds.length
            ? supabase
                .from("production_scans")
                .select("id, order_id, op_code, qty_pieces")
                .in("order_id", orderIds)
            : Promise.resolve(emptyRes),
          opCodes.length
            ? supabase
                .from("production_scans")
                .select("id, order_id, op_code, qty_pieces")
                .in("op_code", opCodes)
            : Promise.resolve(emptyRes),
          orderIds.length
            ? supabase
                .from("injection_production_entries")
                .select("id, order_id, order_code, good_qty")
                .in("order_id", orderIds)
            : Promise.resolve(emptyRes),
          opCodes.length
            ? supabase
                .from("injection_production_entries")
                .select("id, order_id, order_code, good_qty")
                .in("order_code", opCodes)
            : Promise.resolve(emptyRes),
        ]);

        const scanErr = scansByIdRes.error || scansByCodeRes.error;
        const manualErr = manualByIdRes.error || manualByCodeRes.error;
        if (scanErr) console.warn("Painel: falha ao carregar bipagens visiveis:", scanErr);
        if (manualErr) console.warn("Painel: falha ao carregar apontamentos visiveis:", manualErr);
        if (scanErr && manualErr) return;

        const totals = new Map();
        const ensureTotal = (key) => {
          if (!totals.has(key)) {
            totals.set(key, { scannedCount: 0, scannedPieces: 0, manualPieces: 0 });
          }
          return totals.get(key);
        };
        const matchingTargetKeys = (row) => {
          const rowOrderId = normalizeOptionalValue(row?.order_id);
          const rowCode = normalizeOptionalValue(row?.op_code ?? row?.order_code);
          const keys = new Set();

          for (const [key, target] of targetsMap.entries()) {
            if ((rowOrderId && target.id === rowOrderId) || (rowCode && target.code === rowCode)) {
              keys.add(key);
            }
          }

          return keys;
        };

        const scanRows = mergeRowsById([...(scansByIdRes.data || []), ...(scansByCodeRes.data || [])]);
        for (const row of scanRows) {
          for (const key of matchingTargetKeys(row)) {
            const total = ensureTotal(key);
            const qtyPieces = Number(row?.qty_pieces || 0);
            total.scannedCount += 1;
            if (Number.isFinite(qtyPieces) && qtyPieces > 0) total.scannedPieces += qtyPieces;
          }
        }

        const manualRows = mergeRowsById([...(manualByIdRes.data || []), ...(manualByCodeRes.data || [])]);
        for (const row of manualRows) {
          for (const key of matchingTargetKeys(row)) {
            const goodQty = Number(row?.good_qty || 0);
            if (!Number.isFinite(goodQty) || goodQty <= 0) continue;
            ensureTotal(key).manualPieces += goodQty;
          }
        }

        if (!active) return;

        setLocalAtivos((prev) => {
          if (!prev) return prev;
          const next = { ...prev };

          for (const machineId of Object.keys(next)) {
            next[machineId] = (next[machineId] || []).map((item) => {
              const key = `${getOrderRecordId(item) || ""}|${getOrderRecordCode(item) || ""}`;
              const total = totals.get(key);
              if (!total) return item;

              const fallbackScannedPieces = total.scannedPieces > 0
                ? total.scannedPieces
                : total.scannedCount * parsePiecesPerBox(item?.standard);
              const updatedItem = {
                ...item,
                scanned_count: total.scannedCount,
                scanned_pieces: fallbackScannedPieces,
                manual_pieces: total.manualPieces,
              };

              return {
                ...updatedItem,
                apontadas_pieces: computeApontadasPieces(updatedItem),
              };
            });
          }

          return next;
        });
      } catch (err) {
        console.warn("Painel: erro ao carregar totais de producao visiveis:", err);
      }
    }

    fetchVisibleProductionTotals();
    return () => {
      active = false;
    };
  }, [ativosPorMaquina]);

  function computeApontadasPieces(item) {
    const scannedCount = Number(item?.scanned_count || 0);
    const manualPieces = Number(item?.manual_pieces || 0);
    const storedScannedPieces = Number(item?.scanned_pieces || 0);
    const piecesPerBox = parsePiecesPerBox(item?.standard);
    const scannedPieces = storedScannedPieces > 0
      ? storedScannedPieces
      : piecesPerBox > 0
        ? scannedCount * piecesPerBox
        : 0;
    return manualPieces > 0 || scannedPieces > 0 ? manualPieces + scannedPieces : undefined;
  }

  // util helper para testar se um item corresponde a um order_id / code
  function matchesOrder(item, orderIdOrCode) {
    if (!item || !orderIdOrCode) return false;
    const candidates = [
      item?.id,
      item?.source_order_id,
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
            const scanOpCode = String(newRow.op_code || "").trim();
            const scanMachineId = newRow.machine_id;

            // obtém contagem de caixas e peças atuais de production_scans para essa O.P.
            let scannedCount = 0;
            let scanPieces = 0;
            try {
              const [scanByIdRes, scanByCodeRes] = await Promise.all([
                scanOrderId != null
                  ? supabase
                      .from("production_scans")
                      .select("id, qty_pieces")
                      .eq("order_id", scanOrderId)
                  : Promise.resolve({ data: [], error: null }),
                scanOpCode
                  ? supabase
                      .from("production_scans")
                      .select("id, qty_pieces")
                      .eq("op_code", scanOpCode)
                  : Promise.resolve({ data: [], error: null }),
              ]);

              const scanErr = scanByIdRes.error || scanByCodeRes.error;
              const scanRows = mergeRowsById([...(scanByIdRes.data || []), ...(scanByCodeRes.data || [])]);

              if (!scanErr && Array.isArray(scanRows)) {
                scannedCount = scanRows.length;
                scanPieces = scanRows.reduce((sum, row) => {
                  const pieces = Number(row?.qty_pieces ?? 0);
                  return sum + (Number.isFinite(pieces) && pieces > 0 ? pieces : 0);
                }, 0);
              } else if (scanErr) {
                console.warn("Painel: falha ao carregar production_scans para O.P.:", scanErr);
              }
            } catch (err) {
              console.error("Painel: erro ao consultar production_scans:", err);
            }

            // Atualiza localAtivos apenas na máquina afetada (se souber) ou procura em todas
            setLocalAtivos((prev) => {
              if (!prev) return prev;
              const copy = { ...prev };
              const orderIdStr = String(scanOrderId);
              const orderTarget = scanOpCode || orderIdStr;
              let found = false;

              // prioridade: aplicar apenas na machine informada pelo scan (evita percorrer tudo)
              const machinesToCheck =
                scanMachineId && copy[scanMachineId]
                  ? [scanMachineId]
                  : Object.keys(copy);

              for (const machine of machinesToCheck) {
                copy[machine] = (copy[machine] || []).map((item) => {
                  if (matchesOrder(item, orderTarget)) {
                    found = true;
                    const updatedItem = {
                      ...item,
                      scanned_count: scannedCount,
                      scanned_pieces: scanPieces > 0 ? scanPieces : item.scanned_pieces,
                    };
                    return {
                      ...updatedItem,
                      apontadas_pieces: computeApontadasPieces(updatedItem),
                    };
                  }
                  return item;
                });
              }

              // fallback: se não encontrou e scan não informou machine_id, tente procurar em todas
              if (!found) {
                for (const machine of Object.keys(copy)) {
                  copy[machine] = (copy[machine] || []).map((item) => {
                    if (matchesOrder(item, orderTarget)) {
                      found = true;
                      const updatedItem = {
                        ...item,
                        scanned_count: scannedCount,
                        scanned_pieces: scanPieces > 0 ? scanPieces : item.scanned_pieces,
                      };
                      return {
                        ...updatedItem,
                        apontadas_pieces: computeApontadasPieces(updatedItem),
                      };
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

          const { openStop, stopReason, stopStartedAt } = getOrderStopDisplay(ativa, paradas)

          const durText = stopStartedAt
            ? fmtElapsedSince(stopStartedAt, currentTimeMs)
            : null;

          const produzindoText =
            ativa?.status === "PRODUZINDO"
              ? fmtElapsedSince(getProductionStartedAt(ativa), currentTimeMs)
              : null;

          // Timer de baixa eficiência usando started_at do log aberto
          const lowEffText =
            ativa?.status === "BAIXA_EFICIENCIA" && ativa?.loweff_started_at
              ? (() => {
                  return fmtElapsedSince(ativa.loweff_started_at, currentTimeMs);
                })()
              : null;

          let semProgText = null;
          // Mostrar cronômetro "Sem Programação" quando não há ativa
          // ou quando a ordem está em "AGUARDANDO" (antes de iniciar produção)
          if (!ativa || ativa.status === "AGUARDANDO") {
            const lastFinISO = lastFinalizadoPorMaquina?.[m] || null;
            if (lastFinISO) {
              semProgText = fmtElapsedSince(lastFinISO, currentTimeMs);
            }
          }

          const opCode = ativa?.code || ativa?.o?.code || ativa?.op_code || "";
          const itemCode = extractItemCodeFromOrderProduct(ativa?.product);
          const itemTech = itemCode ? itemTechByCode[itemCode] || {} : {};
          const cycleSeconds = Number(itemTech?.cycleSeconds || 0);
          const cavities = Number(itemTech?.cavities || 0);
          const precisaRegularizarSessao = Boolean(
            ativa && String(ativa.status || '').toUpperCase() !== 'AGUARDANDO' && !ativa.active_session_id
          );

          // lidas / saldo: scanned_count agora pode vir do fetch inicial ou do realtime
          const lidas = Number(ativa?.scanned_count || 0);
          const lidasPecas = Number(ativa?.apontadas_pieces || 0) > 0
            ? Number(ativa?.apontadas_pieces)
            : (Number(ativa?.manual_pieces || 0) + Number(ativa?.scanned_pieces || 0)) || undefined
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

                  {produzindoText && (
                    <span className="produzindo-timer">{produzindoText}</span>
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
                      lidasCaixas={lidas}
                      lidasPecas={lidasPecas}
                      saldoCaixas={saldo}
                      paradaReason={openStop?.reason}
                      paradaNotes={openStop?.notes}
                    />

                    {ativa?.status === "PARADA" && stopReason && (
                      <div className="stop-reason-below">{stopReason}</div>
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

                    <div className="grid2" style={{ marginTop: 12 }}>
                      <div>
                        <div className="label">Ciclo</div>
                        <div className="small">{cycleSeconds > 0 ? `${cycleSeconds} s` : '—'}</div>
                      </div>
                      <div>
                        <div className="label">Cavidades</div>
                        <div className="small">{cavities > 0 ? cavities : '—'}</div>
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
