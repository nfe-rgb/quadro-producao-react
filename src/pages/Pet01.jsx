// src/pages/Pet01.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Etiqueta from "../components/Etiqueta";
import { getTurnoAtual, statusClass } from "../lib/utils";
import { toBrazilTime } from "../lib/timezone";
import { DateTime } from "luxon";
import "../styles/Pet01.css";

export default function Pet01({
  registroGrupos,
  ativosP1,
  paradas,
  tick,
  onStatusChange,
  setStartModal,
  setStopModal,
  setLowEffModal,
  setResumeModal,
  setFinalizando,
}) {
  // estados principais
  const [ativa, setAtiva] = useState(null);
  const [proximo, setProximo] = useState(null);
  const [scans, setScans] = useState([]);

  const [refugoForm, setRefugoForm] = useState({ operador: "", turno: "", quantidade: "", motivo: "Rebarba",});
  // --------------------------
  // Motivos padrão de refugo
  // --------------------------
  const REFUGO_MOTIVOS = [
    "Troca de Cor",
    "Regulagem",
    "Rebarba",
    "Bolha",
    "Contaminação ou Caídas no Chão",
    "Ponto de Injeção Alto ou Deslocado",
    "Sujas de Óleo",
    "Fora de Cor",
    "Parede Fraca",
    "Fundo/Ombro Deformado",
    "Peças falhadas",
    "Peças Furadas",
    "Fiapo",
    "Queimadas",
    "Manchadas",
  ];

  const [showRefugo, setShowRefugo] = useState(false);


  // toast de notificação superior
  const [toast, setToast] = useState({ visible: false, type: "ok", msg: "" });

  // listener de scanner: buffer e timestamps
  const scanBufferRef = useRef("");
  const lastKeyTimeRef = useRef(0);

  // turno atual (usado para gravar)
const [currentShift, setCurrentShift] = useState(() => {
  // pega o instante atual e converte para horário de São Paulo antes de decidir o turno
  const nowBr = toBrazilTime(new Date().toISOString());
  return getTurnoAtual(nowBr) ?? "Hora Extra";
});

  // fullscreen ref + state (se usar)
  const wrapperRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Atualiza ativa/proximo sempre que ativos mudam (somente P1)
  useEffect(() => {
    if (!ativosP1) return;
    setAtiva(ativosP1[0] || null);
    setProximo(ativosP1[1] || null);
  }, [ativosP1]);

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
  const paradaAberta = paradas?.find((p) => p.order_id === ativa?.id && !p.resumed_at);
  const stopReason = paradaAberta?.reason || "";
  const tempoParada = useMemo(() => {
    if (!ativa) return null;
    if (ativa.paradaAberta?.status !== "PARADA") return null;
    if (!ativa.started_at) return null;
    const _ = tick;
    const diff = Math.floor((Date.now() - new Date(ativa.started_at).getTime()) / 1000);
    const hh = String(Math.floor(diff / 3600)).padStart(2, "0");
    const mm = String(Math.floor((diff % 3600) / 60)).padStart(2, "0");
    const ss = String(diff % 60).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }, [ativa, tick]);


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

// Substitua sua função biparWithCode por esta (coloque no mesmo escopo)
async function biparWithCode(code) {
  const value = (code || "").trim();
  if (!ativa) {
    showToast("Nenhuma ordem ativa.", "err");
    return;
  }

  const reg = /^OS\s+(\d+)\s*-\s*(\d{3})$/i;
  const m = value.match(reg);
  if (!m) {
    showToast("Formato inválido. Use: OS 753 - 001", "err");
    return;
  }
  const op = m[1];
  const caixa = Number(m[2]);

  if (String(op) !== String(ativa.code)) {
    showToast(`Código não pertence à O.P ${ativa.code}`, "err");
    return;
  }
  if (caixa < 1 || caixa > Number(ativa.boxes)) {
    showToast("Caixa fora do intervalo.", "err");
    return;
  }

  // duplicidade
  const { data: dup, error: dupErr } = await supabase
    .from("production_scans")
    .select("id")
    .eq("order_id", ativa.id)
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

  const qtyPiecesPerBox = Number(ativa.standard || 0);

  // --- FORÇA horário BR e calcula turno com BR ---
  const nowBr = DateTime.now().setZone("America/Sao_Paulo");
  const createdAtUtcIso = nowBr.toUTC().toISO(); // será gravado no supabase
  // sempre calcular com base no nowBr (não usar currentShift)
  const turnoCalc = String(getTurnoAtual(nowBr) || "Hora Extra");

  // logs detalhados antes do insert
  console.info("[biparWithCode] nowBr (BR):", nowBr.toISO());
  console.info("[biparWithCode] createdAtUtcIso (UTC):", createdAtUtcIso);
  console.info("[biparWithCode] turnoCalc (getTurnoAtual):", turnoCalc);

  const payload = {
    created_at: createdAtUtcIso,
    machine_id: "P1",
    shift: turnoCalc,
    order_id: ativa.id,
    op_code: String(ativa.code),
    scanned_box: caixa,
    qty_pieces: qtyPiecesPerBox,
    code: value,
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
  await loadScans(ativa.id);
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
  }, [ativa, scans, currentShift, saldo]); // deps: ativa so buffer relevant

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
                              setStartModal({
                                ordem: ativa,
                                operador: "",
                                data: nowBr.toISODate(), 
                                hora: nowBr.toFormat("HH:mm"),
                              })
      return;
    }

    if (targetStatus === "PARADA" && before !== "PARADA") {
                              const nowBr = DateTime.now().setZone("America/Sao_Paulo");
                              setStartModal({
                                ordem: ativa,
                                operador: "",
                                data: nowBr.toISODate(), 
                                hora: nowBr.toFormat("HH:mm"),
                              })
      return;
    }

    if (before === "PARADA" && targetStatus !== "PARADA") {
                              const nowBr = DateTime.now().setZone("America/Sao_Paulo");
                              setStartModal({
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

  // ---------- open fullscreen helper ----------
  async function toggleFullscreen() {
    try {
      const elem = document.documentElement;
      if (!document.fullscreenElement) {
        if (elem.requestFullscreen) await elem.requestFullscreen();
        else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
      } else {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      }
    } catch (err) {
      console.warn("Fullscreen failed:", err);
    }
  }

  // ---------- render ----------
  return (
    <div className="pet01-wrapper" ref={wrapperRef}>
      {/* Top toast notification */}
      <div className={`pet01-toast ${toast.type === "ok" ? "ok" : "err"} ${toast.visible ? "show" : ""}`} role="status" aria-live="polite">
        {toast.msg}
      </div>

      <h1 className="pet01-title">Apontamento — Máquina P1</h1>

      <img src="/Logotipo Savanti.png" alt="Savanti Plásticos" className="pet01-logo" onError={(e) => e.currentTarget.src = "/savanti-logo.png"} />

      <button
        type="button"
        className={`pet01-fullscreen-btn ${isFullscreen ? "active" : ""}`}
        onClick={toggleFullscreen}
        aria-label={isFullscreen ? "Sair da tela cheia" : "Entrar em tela cheia"}
        title={isFullscreen ? "Sair da tela cheia" : "Entrar em tela cheia"}
      >
        {isFullscreen ? (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6 9V6h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M6 6l6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M18 15v3h-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M18 18l-6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 6H6v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M6 6l6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M15 18h3v-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M18 18l-6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </button>

      {/* Buttons: keep only Refugo (we removed Apontar Produção button per your request) */}
      <div className="pet01-buttons" style={{ marginBottom: 12 }}>
        <button className="pet01-btn orange" onClick={() => setShowRefugo(true)}>Apontar Refugo</button>
      </div>

      {/* CARD PRINCIPAL */}
      <div className={`pet01-card ${pet01StatusClass(ativa?.status)}`}>
        <div className="pet01-card-header">
          <div className="left">
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
          </div>
        </div>

        <div className={statusClass(ativa?.status)}>
          <Etiqueta o={ativa} variant="pet01" saldoCaixas={saldo} lidasCaixas={lidas} />
        </div>

                  {ativa?.status === "PARADA" && stopReason && (
                  <div className="stop-reason-below">{stopReason}</div>
                  )}
                  
        <div className="sep" style={{ marginTop: 12 }} />

        <div className="pet01-field" style={{ marginTop: 10 }}>
          <label style={{ minWidth: 90 }}>Situação</label>
          <select value={ativa?.status || "AGUARDANDO"} onChange={(e) => handleStatusChange(e.target.value)}>
            <option value="PRODUZINDO">Produzindo</option>
            <option value="BAIXA_EFICIENCIA">Baixa Eficiência</option>
            <option value="PARADA">Parada</option>
          </select>

          <div style={{ marginLeft: 12 }}>
            {ativa?.status === "AGUARDANDO" && (
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

{/* MODAL — REFUGO (FINAL E CORRIGIDO) */}
{showRefugo && (
  <div className="pet01-modal-bg" role="dialog" aria-modal>
    <div className="pet01-modal">
      <h3>Apontar Refugo</h3>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
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

          // calcula aqui o instante em São Paulo e converte para UTC para gravar
          const nowBr = DateTime.now().setZone('America/Sao_Paulo');
          const createdAtUtcIso = nowBr.toUTC().toISO();

          // calcula o turno com base em nowBr (sempre recalculado no submit)
          const turnoCalc = String(getTurnoAtual(nowBr) || "Hora Extra");

          // payload final compatível com scrap_logs
        const payload = {
    created_at: createdAtUtcIso,           // grava o UTC correspondente ao horário BR
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
       }}
      >

        <label>Operador *</label>
        <input
          className="input"
          value={refugoForm.operador}
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
          onChange={(e) =>
            setRefugoForm((f) => ({ ...f, quantidade: e.target.value }))
          }
        />

        <label>Motivo *</label>
        <select
          className="input"
          value={refugoForm.motivo}
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
            onClick={() => setShowRefugo(false)}
          >
            Cancelar
          </button>
          <button type="submit" className="orange">
            Registrar
          </button>
        </div>
      </form>
    </div>
  </div>
)}

    </div>
  );
}
