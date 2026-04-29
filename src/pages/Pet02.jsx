// src/pages/Pet02.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ensureAnonymousSession, supabase } from "../lib/supabaseClient";
import Etiqueta from "../components/Etiqueta";
import FichaTecnicaModal from "../components/FichaTecnicaModal";
import { fmtElapsedSince, getOrderStopDisplay, getProductionStartedAt, getTurnoAtual, statusClass } from "../lib/utils";
import { getShiftWindowAt } from "../lib/shifts";
import { DateTime } from "luxon";
import "../styles/Pet01.css";
import { REFUGO_MOTIVOS } from "../lib/constants";

export default function Pet02({
  ativosP2,
  paradas,
  tick,
  onStatusChange,
  setStartModal,
  setStopModal,
  setLowEffModal,
  setLowEffEndModal,
  setResumeModal,
  setFinalizando,
}) {
  const machineId = "P2";
  // estados principais
  const [ativa, setAtiva] = useState(null);
  const [proximo, setProximo] = useState(null);
  const [scans, setScans] = useState([]);

  const [refugoForm, setRefugoForm] = useState({ operador: "", turno: "", quantidade: "", motivo: "",});

  const [showRefugo, setShowRefugo] = useState(false);
  const [refugoSaving, setRefugoSaving] = useState(false);
  const [responsavelSaving, setResponsavelSaving] = useState(false);
  const [shiftScrap, setShiftScrap] = useState({ good: 0, scrap: 0, pct: 0, loading: true, shiftKey: "" });
  // responsável do turno (P2)
  const [responsavelTurno, setResponsavelTurno] = useState("");
  const [responsavelModalOpen, setResponsavelModalOpen] = useState(false);
  const [responsavelInput, setResponsavelInput] = useState("");
  const [shiftInfo, setShiftInfo] = useState(null); // { shiftKey, start, end }
  const [responsavelKey, setResponsavelKey] = useState("");
  const [fichaModalOpen, setFichaModalOpen] = useState(false);


  // toast de notificação superior
  const [toast, setToast] = useState({ visible: false, type: "ok", msg: "" });

  // listener de scanner: buffer e timestamps
  const scanBufferRef = useRef("");
  const lastKeyTimeRef = useRef(0);
  const refugoSavingRef = useRef(false);
  const responsavelSavingRef = useRef(false);

  // Atualiza ativa/proximo sempre que ativos mudam (somente P2)
  useEffect(() => {
    if (!ativosP2) return;
    setAtiva(ativosP2[0] ? { ...ativosP2[0] } : null);
    setProximo(ativosP2[1] ? { ...ativosP2[1] } : null);
  }, [ativosP2]);

  // carrega scans existentes da ordem ativa
  async function loadScans(id) {
    if (!id) {
      setScans([]);
      return;
    }
    const { data } = await supabase
      .from("production_scans")
      .select("*")
      .eq("order_id", id)
      .order("scanned_box", { ascending: true });
    setScans(data || []);
  }
  useEffect(() => { if (ativa?.id) loadScans(ativa.id); }, [ativa?.id]);

  const lidas = scans.length;
  const saldo = ativa ? Math.max(0, Number(ativa.boxes) - lidas) : 0;

    // cronômetros
  const { stopReason, stopStartedAt } = getOrderStopDisplay(ativa, paradas)
  const tempoParada = useMemo(() => {
    if (!ativa) return null;
    if (ativa.status !== "PARADA") return null;
    if (!stopStartedAt) return null;
    const _ = tick;
    const since = new Date(stopStartedAt).getTime();
    const diff = Math.floor((Date.now() - since) / 1000);
    const hh = String(Math.floor(diff / 3600)).padStart(2, "0");
    const mm = String(Math.floor((diff % 3600) / 60)).padStart(2, "0");
    const ss = String(diff % 60).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }, [ativa, stopStartedAt, tick]);


  const tempoLow = useMemo(() => {
    if (!ativa) return null;
    if (ativa.status !== "BAIXA_EFICIENCIA") return null;
    if (!ativa.loweff_started_at) return null;
    const _ = tick;
    const diff = Math.floor((Date.now() - new Date(ativa.loweff_started_at).getTime()) / 1000);
    const hh = String(Math.floor(diff / 3600)).padStart(2, "0");
    const mm = String(Math.floor((diff % 3600) / 60)).padStart(2, "0");
    const ss = String(diff % 60).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }, [ativa, tick]);

  const tempoProduzindo = useMemo(() => {
    if (!ativa) return null;
    if (ativa.status !== "PRODUZINDO") return null;
    const _ = tick;
    return fmtElapsedSince(getProductionStartedAt(ativa));
  }, [ativa, tick]);

  const tempoSemProg = useMemo(() => {
    if (!ativa) return null;
    if (ativa.status !== "SEM_PROGRAMACAO") return null;
    const sinceSource = ativa.interrupted_at || ativa.created_at;
    if (!sinceSource) return null;
    const _ = tick;
    const diff = Math.floor((Date.now() - new Date(sinceSource).getTime()) / 1000);
    const hh = String(Math.floor(diff / 3600)).padStart(2, "0");
    const mm = String(Math.floor((diff % 3600) / 60)).padStart(2, "0");
    const ss = String(diff % 60).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }, [ativa, tick]);

  // classe local para borda esquerda (verde/vermelho/amarelo)
  const pet01StatusClass = (s) => {
    if (!s) return "status-produzindo";
    const st = String(s).toUpperCase();
    if (st === "PARADA") return "status-parada";
    if (st.includes("BAIXA")) return "status-baixa";
    if (st === "PRODUZINDO" || st === "AGUARDANDO") return "status-produzindo";
    return "status-produzindo";
  };

  // ---------- TOAST helper ----------
  function showToast(msg, type = "ok", ms = 2400) {
    setToast({ visible: true, type, msg });
    setTimeout(() => setToast((t) => ({ ...t, visible: false })), ms);
  }

  const formatInt = useCallback((n) => {
    const num = Number(n) || 0;
    return num.toLocaleString("pt-BR");
  }, []);

  const parsePiecesPerBox = useCallback((val) => {
    if (val == null) return 0;
    const digitsOnly = String(val).replace(/[^0-9]/g, "");
    if (!digitsOnly) return 0;
    return parseInt(digitsOnly, 10);
  }, []);

  const resolveCurrentShiftWindow = useCallback(() => {
    const nowBr = DateTime.now().setZone("America/Sao_Paulo");
    const match = getShiftWindowAt(nowBr, { preserveLegacy: false });
    if (!match) return null;
    return { shiftKey: match.shiftKey, start: match.start, end: match.end };
  }, []);

  const fetchRefugoTurno = useCallback(async () => {
    const windowInfo = resolveCurrentShiftWindow();
    if (!windowInfo) {
      setShiftScrap({ good: 0, scrap: 0, pct: 0, loading: false, shiftKey: "" });
      return;
    }

    const startIso = windowInfo.start.toUTC().toISO();
    const endIso = windowInfo.end.toUTC().toISO();
    setShiftScrap((prev) => ({ ...prev, loading: true, shiftKey: windowInfo.shiftKey }));

    try {
      const [bipRes, scrapRes, manualRes] = await Promise.all([
        supabase
          .from("production_scans")
          .select("order_id, machine_id, created_at")
          .eq("machine_id", machineId)
          .gte("created_at", startIso)
          .lt("created_at", endIso),
        supabase
          .from("scrap_logs")
          .select("order_id, qty, machine_id, created_at")
          .eq("machine_id", machineId)
          .gte("created_at", startIso)
          .lt("created_at", endIso),
        supabase
          .from("injection_production_entries")
          .select("order_id, good_qty, machine_id, created_at")
          .eq("machine_id", machineId)
          .gte("created_at", startIso)
          .lt("created_at", endIso),
      ]);

      if (bipRes.error) throw bipRes.error;
      if (scrapRes.error) throw scrapRes.error;
      if (manualRes.error) throw manualRes.error;

      const scans = bipRes.data || [];
      const scraps = scrapRes.data || [];
      const manual = manualRes.data || [];

      const orderIds = new Set();
      scans.forEach((s) => { if (s.order_id != null) orderIds.add(String(s.order_id)); });
      manual.forEach((m) => { if (m.order_id != null) orderIds.add(String(m.order_id)); });

      let ordersMap = {};
      if (orderIds.size > 0) {
        const { data: ords, error: ordErr } = await supabase
          .from("orders")
          .select("id, standard")
          .in("id", Array.from(orderIds));
        if (ordErr) throw ordErr;
        (ords || []).forEach((o) => { ordersMap[String(o.id)] = o; });
      }

      let goodPieces = 0;
      scans.forEach((s) => {
        const std = parsePiecesPerBox(ordersMap[String(s.order_id)]?.standard);
        goodPieces += std;
      });
      manual.forEach((m) => { goodPieces += Number(m.good_qty) || 0; });

      const scrapPieces = scraps.reduce((acc, r) => acc + (Number(r.qty) || 0), 0);
      const total = goodPieces + scrapPieces;
      const pct = total > 0 ? Number(((scrapPieces / total) * 100).toFixed(2)) : 0;

      setShiftScrap({ good: goodPieces, scrap: scrapPieces, pct, loading: false, shiftKey: windowInfo.shiftKey });
    } catch (err) {
      console.error("Erro ao calcular refugo do turno:", err);
      setShiftScrap((prev) => ({ ...prev, loading: false }));
    }
  }, [resolveCurrentShiftWindow, machineId, parsePiecesPerBox]);

  const fetchShiftResponsible = useCallback(async (info, key) => {
    try {
      const { data, error } = await supabase
        .from("shift_responsibles")
        .select("id, operator, responsible, responsavel, shift, machine_id, effective_date, created_at")
        .eq("machine_id", machineId)
        .eq("shift", String(info.shiftKey))
        .gte("created_at", info.start.toUTC().toISO())
        .lt("created_at", info.end.toUTC().toISO())
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) throw error;
      const row = data && data[0];
      const nome = row?.operator || row?.responsible || row?.responsavel || "";
      if (nome) {
        setResponsavelTurno(nome);
        setResponsavelInput(nome);
        setResponsavelModalOpen(false);
      } else {
        setResponsavelTurno("");
        setResponsavelInput("");
        setResponsavelModalOpen(true);
      }
      setResponsavelKey(key);
    } catch (err) {
      console.warn("Erro ao buscar responsável do turno:", err);
      setResponsavelModalOpen(true);
      setResponsavelKey(key);
    }
  }, []);

  // força captura do responsável do turno no início de cada janela de turno
  useEffect(() => {
    let mounted = true;

    async function evaluateShiftResponsible() {
      const info = resolveCurrentShiftWindow();
      if (!mounted) return;
      setShiftInfo(info);
      if (!info || !info.shiftKey) {
        setResponsavelModalOpen(false);
        return;
      }

      const key = `${info.shiftKey}-${info.start.toISODate()}`;
      const needsFetch = responsavelKey !== key || !responsavelTurno;
      if (needsFetch) {
        await fetchShiftResponsible(info, key);
      }
    }

    evaluateShiftResponsible();
    const id = setInterval(evaluateShiftResponsible, 60000);
    return () => { mounted = false; clearInterval(id); };
  }, [resolveCurrentShiftWindow, fetchShiftResponsible, responsavelKey, responsavelTurno]);

  useEffect(() => {
    fetchRefugoTurno();
    const id = setInterval(fetchRefugoTurno, 45000);
    return () => clearInterval(id);
  }, [fetchRefugoTurno]);

  // Polling para atualizar a ordem ativa em tempo real
  useEffect(() => {
    if (!ativa?.id) return;

    async function fetchActiveOrder() {
      try {
        const { data, error } = await supabase
          .from('orders')
          .select('*')
          .eq('id', ativa.id)
          .single();

        if (error) {
          console.warn('Erro ao buscar ordem ativa:', error);
          return;
        }

        if (data) {
          // Atualiza apenas campos relevantes para tempo real
          setAtiva((prev) => {
            if (!prev) return prev;
            const updated = { ...prev };
            if (prev.status !== data.status) updated.status = data.status;
            if (prev.active_session_id !== data.active_session_id) updated.active_session_id = data.active_session_id;
            if (prev.loweff_started_at !== data.loweff_started_at) updated.loweff_started_at = data.loweff_started_at;
            if (prev.interrupted_at !== data.interrupted_at) updated.interrupted_at = data.interrupted_at;
            // Retorna updated apenas se houve mudança
            return Object.keys(updated).some(key => updated[key] !== prev[key]) ? updated : prev;
          });
        }
      } catch (err) {
        console.warn('Falha ao atualizar ordem ativa:', err);
      }
    }

    fetchActiveOrder();
    const id = setInterval(fetchActiveOrder, 2000); // Atualiza a cada 2 segundos
    return () => clearInterval(id);
  }, [ativa?.id]);

  async function salvarResponsavelTurno() {
    if (responsavelSavingRef.current) return;
    if (!shiftInfo || !shiftInfo.shiftKey) return;
    const nome = (responsavelInput || "").trim();
    if (!nome) {
      showToast("Informe o operador responsável.", "err");
      return;
    }

    responsavelSavingRef.current = true;
    setResponsavelSaving(true);
    try {
      await ensureAnonymousSession();
      const nowBr = DateTime.now().setZone("America/Sao_Paulo");
      const payload = {
        machine_id: machineId,
        shift: String(shiftInfo.shiftKey),
        operator: nome,
        effective_date: shiftInfo.start.toISODate(),
        created_at: nowBr.toUTC().toISO(),
      };

      const { error } = await supabase.from("shift_responsibles").upsert([payload]);
      if (error) throw error;

      setResponsavelTurno(nome);
      setResponsavelModalOpen(false);
      setResponsavelKey(`${shiftInfo.shiftKey}-${shiftInfo.start.toISODate()}`);
      showToast("Responsável registrado.", "ok");
    } catch (err) {
      console.error("Erro ao salvar responsável do turno:", err);
      showToast("Falha ao registrar responsável.", "err");
    } finally {
      responsavelSavingRef.current = false;
      setResponsavelSaving(false);
    }
  }

// Substitua sua função biparWithCode por esta (coloque no mesmo escopo)
async function biparWithCode(code) {
  const value = (code || "").trim();
  const reg = /^OS\s*(\d+)\s*-\s*(\d+)$/i;
  const m = value.match(reg);
  if (!m) {
    showToast("Formato inválido. Use: OS 753 - 001", "err");
    return;
  }
  const op = m[1];
  const caixa = Number(m[2]);

  await ensureAnonymousSession();

  let ordemAlvo = ativa && String(ativa.code) === String(op) ? ativa : null;
  if (!ordemAlvo) {
    const { data: orderRows, error: orderError } = await supabase
      .from("orders")
      .select("id, code, boxes, standard, machine_id, active_session_id, source_order_id")
      .eq("code", String(op))
      .eq("finalized", false)
      .order("created_at", { ascending: false })
      .limit(10);

    if (orderError) {
      console.error("Erro ao buscar O.P da bipagem:", orderError);
      showToast("Erro ao localizar a O.P da caixa.", "err");
      return;
    }

    ordemAlvo = (orderRows || []).find((row) => String(row?.machine_id || '').toUpperCase() === machineId) || orderRows?.[0] || null;
  }

  if (!ordemAlvo) {
    showToast(`O.P ${op} não encontrada.`, "err");
    return;
  }

  // duplicidade
  const { data: dup, error: dupErr } = await supabase
    .from("production_scans")
    .select("id")
    .eq("order_id", ordemAlvo.id)
    .eq("scanned_box", caixa)
    .maybeSingle();

  if (dupErr) {
    console.error("Erro ao verificar duplicidade:", dupErr);
    showToast("Erro ao verificar bipagem.", "err");
    return;
  }
  if (dup) {
    showToast("Caixa já bipada.", "err");
    return;
  }

  // Parse padrão (peças por caixa) aceitando separador de milhar brasileiro
  function parsePiecesPerBox(val) {
    if (val == null) return 0;
    const s = String(val).trim();
    if (!s) return 0;
    // Remove espaços e separadores não numéricos comuns
    // Regra: somente inteiros são válidos para padrão de peças/caixa
    const digitsOnly = s.replace(/[^0-9]/g, "");
    if (!digitsOnly) return 0;
    return parseInt(digitsOnly, 10);
  }

  const qtyPiecesPerBox = parsePiecesPerBox(ordemAlvo.standard);

  // --- FORÇA horário BR e calcula turno com BR ---
  const nowBr = DateTime.now().setZone("America/Sao_Paulo");
  const turnoAtual = getTurnoAtual(nowBr);
  const createdAtUtcIso = nowBr.toUTC().toISO(); // será gravado no supabase
  const turnoCalc = String(turnoAtual || shiftInfo?.shiftKey || "");

  // logs detalhados antes do insert
  console.info("[biparWithCode] nowBr (BR):", nowBr.toISO());
  console.info("[biparWithCode] createdAtUtcIso (UTC):", createdAtUtcIso);
  console.info("[biparWithCode] turnoCalc (getTurnoAtual):", turnoCalc);

  const payload = {
    created_at: createdAtUtcIso,
    machine_id: ordemAlvo.machine_id || machineId,
    shift: turnoCalc,
    order_id: ordemAlvo.id,
    op_code: String(ordemAlvo.code || op),
    scanned_box: caixa,
    qty_pieces: qtyPiecesPerBox,
    code: `OS ${op} - ${String(caixa).padStart(3, "0")}`,
  };

  console.info("[biparWithCode] payload -> antes do insert:", payload);

  const { data: insertData, error } = await supabase
    .from("production_scans")
    .insert([payload])
    .select("*"); // retorna a linha inserida se permitido

  if (error) {
    console.error("Erro insert production_scans:", error);
    showToast("Erro ao registrar bipagem.", "err");
    return;
  }

  // Se o insert retornou dados, logue o que o banco devolveu
  if (Array.isArray(insertData) && insertData.length) {
    console.info("[biparWithCode] resposta do insert (db retornou):", insertData[0]);
  } else {
    console.warn("[biparWithCode] insert concluído, mas sem row retornada (verifique permissões SELECT).");
  }

  // Atualiza UI
  if (ativa?.id && String(ativa.id) === String(ordemAlvo.id)) {
    await loadScans(ordemAlvo.id);
  }
  showToast(`Caixa ${String(caixa).padStart(3, "0")} registrada • Turno ${turnoCalc}`, "ok");

  if (saldo - 1 <= 0) {
    setFinalizando && setFinalizando(ativa);
  }
}

  // DEBUG: permitir bipagem manual pelo console
if (typeof window !== "undefined") {
  window.biparManual = biparWithCode;
}

  // ---------- Global scanner listener (HID) ----------
  useEffect(() => {
    function onGlobalKey(e) {
      // ignore modifier keys
      if (e.key === "Shift" || e.key === "Alt" || e.key === "Meta" || e.key === "CapsLock") return;

      const now = Date.now();

      // threshold between characters of scanner (ms)
      const THRESHOLD = 120;

      if (now - lastKeyTimeRef.current > THRESHOLD) {
        scanBufferRef.current = "";
      }
      lastKeyTimeRef.current = now;

      // if Enter -> finalize
      if (e.key === "Enter") {
        const code = (scanBufferRef.current || "").trim();
        if (code) {
          // call bipar
          biparWithCode(code);
        }
        scanBufferRef.current = "";
        // prevent default so Enter doesn't submit forms
        e.preventDefault();
        return;
      }

      // If user typing in an input and modal isn't open, don't capture
      const active = document.activeElement;
      const activeTag = active && active.tagName ? active.tagName.toUpperCase() : null;
      const activeIsInput = activeTag === "INPUT" || activeTag === "TEXTAREA" || active?.isContentEditable;

      const modalOpen = !!document.querySelector(".pet01-modal-bg");
      if (!modalOpen && activeIsInput) {
        // user's typing — do not intercept
        return;
      }

      // add printable characters only (length === 1)
      if (e.key.length === 1) {
        scanBufferRef.current += e.key;
        // prevent typing anywhere that would show text (if modal not open)
        if (!modalOpen) e.preventDefault();
      }
    }

    window.addEventListener("keydown", onGlobalKey, true);
    return () => window.removeEventListener("keydown", onGlobalKey, true);
  }, [ativa, scans, saldo]); // deps: ativa so buffer relevant

  // ---------- status change handler (keeps behavior) ----------
  function handleStatusChange(targetStatus) {
    if (!ativa) return;
    const before = ativa.status;
    const jaIniciouLocal = !!ativa.started_at;
    if (jaIniciouLocal && targetStatus === "AGUARDANDO") {
      alert('Após iniciar a produção, não é permitido voltar para "Aguardando".');
      return;
    }

    if (targetStatus === "BAIXA_EFICIENCIA" && before !== "BAIXA_EFICIENCIA") {
                              const nowBr = DateTime.now().setZone("America/Sao_Paulo");
                              setLowEffModal({
                                ordem: ativa,
                                operador: "",
                                data: nowBr.toISODate(), 
                                hora: nowBr.toFormat("HH:mm"),
                              })
      return;
    }
    
    if (before === "BAIXA_EFICIENCIA" && targetStatus !== "BAIXA_EFICIENCIA") {
                              const nowBr = DateTime.now().setZone("America/Sao_Paulo");
                              setLowEffEndModal({
                                ordem: ativa,
                                operador: "",
                                data: nowBr.toISODate(),
                                hora: nowBr.toFormat("HH:mm"),
                              })
      return;
    }

    if (targetStatus === "PARADA" && before !== "PARADA") {
                              const nowBr = DateTime.now().setZone("America/Sao_Paulo");
                              setStopModal({
                                ordem: ativa,
                                operador: "",
                                data: nowBr.toISODate(), 
                                hora: nowBr.toFormat("HH:mm"),
                              })
      return;
    }

    if (before === "PARADA" && targetStatus !== "PARADA") {
                              const nowBr = DateTime.now().setZone("America/Sao_Paulo");
                              setResumeModal({
                                ordem: ativa,
                                operador: "",
                                data: nowBr.toISODate(), 
                                hora: nowBr.toFormat("HH:mm"),
                              })
      return;
    }

    try {
      onStatusChange && onStatusChange(ativa, targetStatus);
    } catch (err) {
      console.error("Erro onStatusChange:", err);
    }
  }

  // ---------- render ----------
  return (
    <div className="pet01-wrapper">
      {/* Top toast notification */}
      <div className={`pet01-toast ${toast.type === "ok" ? "ok" : "err"} ${toast.visible ? "show" : ""}`} role="status" aria-live="polite">
        {toast.msg}
      </div>

      <h1 className="pet01-title">Apontamento — Máquina P2</h1>

      <img src="/Logotipo Savanti.png" alt="Savanti Plásticos" className="pet01-logo" onError={(e) => e.currentTarget.src = "/savanti-logo.png"} />

      {/* Buttons: keep only Refugo (we removed Apontar Produção button per your request) */}
      <div className="pet01-buttons" style={{ marginBottom: 12 }}>
        <button className="pet01-btn orange" onClick={() => setShowRefugo(true)}>Apontar Refugo</button>
      </div>

      {/* CARD PRINCIPAL */}
      <div className={`pet01-card ${pet01StatusClass(ativa?.status)}`}>
        <div className="pet01-card-header">
          <div className="left">
            {tempoProduzindo && (
              <span className="rotas-produzindo-timer">{tempoProduzindo}</span>
            )}
            {ativa?.status === "PARADA" && tempoParada && (
              <span className="rotas-parada-timer">{tempoParada}</span>
            )}
            {ativa?.status === "BAIXA_EFICIENCIA" && tempoLow && (
              <span className="rotas-loweff-timer">{tempoLow}</span>
            )}
            {ativa?.status === "SEM_PROGRAMACAO" && tempoSemProg && (
              <span className="rotas-semprog-timer">{tempoSemProg}</span>
            )}
          </div>

          <div className="right">
            <div className="op-inline">O.P - {ativa?.code}</div>
            <button
              className="btn ghost"
              style={{ marginLeft: 8 }}
              onClick={() => setFichaModalOpen(true)}
              disabled={!ativa?.code}
            >
              Ficha Técnica
            </button>
          </div>
        </div>

        <div className="pet01-inline-metrics">
          <div className="pet01-metric-card">
            <div>
              <div className="pet01-metric-label">Refugo no turno {shiftScrap.shiftKey ? `(Turno ${shiftScrap.shiftKey})` : ''}</div>
              <div className="pet01-metric-sub">
                {shiftScrap.loading ? "Atualizando..." : `${formatInt(shiftScrap.scrap)} ref • ${formatInt(shiftScrap.good)} ok`}
              </div>
            </div>
            <div className={`pet01-metric-value ${shiftScrap.loading ? '' : (shiftScrap.pct > 5 ? 'red' : 'green')}`}>
              {shiftScrap.loading ? "—" : `${shiftScrap.pct}%`}
            </div>
          </div>
        </div>

        <div className={statusClass(ativa?.status)}>
          <Etiqueta o={ativa} variant="pet01" saldoCaixas={saldo} lidasCaixas={lidas} />
                            {ativa?.status === "PARADA" && stopReason && (
                  <div className="stop-reason-below-P2">{stopReason}</div>
                  )}
        </div>
                  
        <div className="sep" style={{ marginTop: 12 }} />

        <div className="pet01-field" style={{ marginTop: 10 }}>
          <label style={{ minWidth: 90 }}>Situação</label>
          <select
            value={ativa?.status || "AGUARDANDO"}
            onChange={(e) => handleStatusChange(e.target.value)}
            disabled={String(ativa?.status || "").toUpperCase() === "AGUARDANDO"}
          >
            {String(ativa?.status || "").toUpperCase() === "AGUARDANDO" && (
              <option value="AGUARDANDO">Aguardando</option>
            )}
            <option value="PRODUZINDO">Produzindo</option>
            <option value="BAIXA_EFICIENCIA">Baixa Eficiência</option>
            <option value="PARADA">Parada</option>
          </select>

          <div style={{ marginLeft: 12 }}>
            {String(ativa?.status || "").toUpperCase() === "AGUARDANDO" && (
          <button
              className="btn small primary"
                onClick={() => {
                 if (!setStartModal) return;
                  const n = DateTime.now().setZone("America/Sao_Paulo");
                   setStartModal({
                     ordem: ativa,
                     operador: "",
                     data: n.toISODate(),          // YYYY-MM-DD
                     hora: n.toFormat("HH:mm"),    // HH:mm
                   });
                 }}>
                Iniciar Produção
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Próximo item */}
      <div className="pet01-next">
        <h2>Próximo Item</h2>
        {proximo ? (
          <div style={{ background: '#fff', borderRadius: 8, boxShadow: '0 1px 4px #0001', padding: 12, marginTop: 8 }}>
            <Etiqueta o={proximo} variant="fila" saldoCaixas={null} lidasCaixas={null} />
          </div>
        ) : (
          <div className="pet01-no-next">Nenhum item na fila</div>
        )}
      </div>

{/* MODAL — RESPONSÁVEL DO TURNO */}
{responsavelModalOpen && (
  <div className="pet01-modal-bg" role="dialog" aria-modal>
    <div className="pet01-modal">
      <h3>Responsável do Turno</h3>
      <p style={{ marginTop: 4, color: '#444' }}>
        Informe o operador responsável da P2 para o Turno {shiftInfo?.shiftKey || ""}. Este passo é obrigatório no início do turno.
      </p>

      <label style={{ marginTop: 12 }}>Operador *</label>
      <input
        className="input"
        value={responsavelInput}
        disabled={responsavelSaving}
        onChange={(e) => setResponsavelInput(e.target.value)}
        autoFocus
      />

      <div className="pet01-modal-buttons" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <button
          type="button"
          className="orange"
          onClick={salvarResponsavelTurno}
          disabled={!responsavelInput.trim() || responsavelSaving}
        >
          {responsavelSaving ? 'Confirmando...' : 'Confirmar'}
        </button>
      </div>
    </div>
  </div>
)}

{/* MODAL — REFUGO (FINAL E CORRIGIDO) */}
{showRefugo && (
  <div className="pet01-modal-bg" role="dialog" aria-modal>
    <div className="pet01-modal">
      <h3>Apontar Refugo</h3>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (refugoSavingRef.current) return;
          if (!ativa) {
            showToast("Nenhuma ordem ativa.", "err");
            return;
          }

          const { operador, quantidade, motivo } = refugoForm;

          if (!operador?.trim()) {
            showToast("Preencha o operador.", "err");
            return;
          }
          if (!quantidade || Number(quantidade) <= 0) {
            showToast("Informe uma quantidade válida.", "err");
            return;
          }

          refugoSavingRef.current = true;
          setRefugoSaving(true);
          try {
            await ensureAnonymousSession();
            const nowBr = DateTime.now().setZone('America/Sao_Paulo');
            const turnoAtual = getTurnoAtual(nowBr);
            const createdAtUtcIso = nowBr.toUTC().toISO();

            const turnoCalc = String(turnoAtual || shiftInfo?.shiftKey || '');

            const payload = {
              created_at: createdAtUtcIso,
              machine_id: ativa.machine_id,
              shift: turnoCalc,
              operator: operador.trim(),
              order_id: ativa.id,
              op_code: String(ativa.code),
              qty: Number(quantidade),
              reason: motivo,
            };

            console.log("Payload Refugo:", payload);

            const { error } = await supabase.from("scrap_logs").insert([payload]);

            if (error) {
              console.error("Erro insert scrap_logs:", error);
              showToast("Erro ao registrar refugo: " + error.message, "err");
              return;
            }

            setShowRefugo(false);
            setRefugoForm({ operador: "", quantidade: "", motivo: REFUGO_MOTIVOS[0] });
            showToast("Refugo registrado.", "ok");
            void fetchRefugoTurno();
          } finally {
            refugoSavingRef.current = false;
            setRefugoSaving(false);
          }
       }}
      >

        <label>Operador *</label>
        <input
          className="input"
          value={refugoForm.operador}
          disabled={refugoSaving}
          onChange={(e) =>
            setRefugoForm((f) => ({ ...f, operador: e.target.value }))
          }
          autoFocus
        />

        <label>Quantidade (peças) *</label>
        <input
          className="input"
          type="number"
          min="1"
          value={refugoForm.quantidade}
          disabled={refugoSaving}
          onChange={(e) =>
            setRefugoForm((f) => ({ ...f, quantidade: e.target.value }))
          }
        />

        <label>Motivo *</label>
        <select
          className="input"
          value={refugoForm.motivo}
          disabled={refugoSaving}
          onChange={(e) =>
            setRefugoForm((f) => ({ ...f, motivo: e.target.value }))
          }
        >
          {REFUGO_MOTIVOS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <div className="pet01-modal-buttons" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="gray"
            disabled={refugoSaving}
            onClick={() => setShowRefugo(false)}
          >
            Cancelar
          </button>
          <button type="submit" className="orange" disabled={refugoSaving}>
            {refugoSaving ? "Registrando..." : "Registrar"}
          </button>
        </div>
      </form>
    </div>
  </div>
)}

      <FichaTecnicaModal
        open={fichaModalOpen}
        onClose={() => setFichaModalOpen(false)}
        machineId={machineId}
        itemCode={(ativa?.product || '').split('-')[0]?.trim() || ''}
      />

    </div>
  );
}
