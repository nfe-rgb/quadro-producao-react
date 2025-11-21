// =======================
//  PET03.jsx — PARTE 1/3
// =======================

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Etiqueta from "../components/Etiqueta";

// ⭐ Importa o mesmo statusClass usado no painel
import { statusClass } from "../lib/utils";

import "../styles/Pet01.css";

export default function Pet03({
  registroGrupos,
  ativosP3,
  paradas,
  tick,
  onStatusChange,
  setStartModal,
  setStopModal,
  setLowEffModal,
  setResumeModal,
  setFinalizando,
}) {

  // ===== ESTADOS =====
  const [ativa, setAtiva] = useState(null);
  const [proximo, setProximo] = useState(null);

  const [scans, setScans] = useState([]);

  const [showBip, setShowBip] = useState(false);
  const [showRefugo, setShowRefugo] = useState(false);

  const bipRef = useRef(null);
  const [bipOperator, setBipOperator] = useState("");

  const [refugoForm, setRefugoForm] = useState({
    operador: "",
    turno: "",
    quantidade: "",
    motivo: "Rebarba",
  });

  // --------------------------
  // Motivos padrão de refugo
  // --------------------------
  const REFUGO_MOTIVOS = [
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

    // ---------- Fullscreen (botão) ----------
  const wrapperRef = useRef(null);           // referência do container que vamos fullscreen
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

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
  // ---------- end fullscreen ----------

  // ===========================
  //  CAPTURAR ORDEM ATIVA P3
  // ===========================
  useEffect(() => {
    if (!ativosP3) return;
    setAtiva(ativosP3[0] || null);
    setProximo(ativosP3[1] || null);
  }, [ativosP3]);

  // ===========================
  //  BIPAGENS
  // ===========================
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

  useEffect(() => {
    if (ativa?.id) loadScans(ativa.id);
  }, [ativa?.id]);

  const lidas = scans.length;
  const saldo = ativa ? Math.max(0, Number(ativa.boxes) - lidas) : 0;

  // ========================================
  //  CRONÔMETRO — PARADA E BAIXA EFICIÊNCIA
  // ========================================
  const paradaAberta = paradas?.find(
    (p) => p.order_id === ativa?.id && !p.resumed_at
  );

  const tempoParada = useMemo(() => {
    if (!paradaAberta) return null;
    const _ = tick;
    const diff = Math.floor(
      (Date.now() - new Date(paradaAberta.started_at).getTime()) / 1000
    );
    const hh = String(Math.floor(diff / 3600)).padStart(2, "0");
    const mm = String(Math.floor((diff % 3600) / 60)).padStart(2, "0");
    const ss = String(diff % 60).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }, [paradaAberta, tick]);


  const tempoLow = useMemo(() => {
    if (!ativa) return null;
    if (ativa.status !== "BAIXA_EFICIENCIA") return null;
    if (!ativa.loweff_started_at) return null;

    const _ = tick;
    const diff = Math.floor(
      (Date.now() - new Date(ativa.loweff_started_at).getTime()) / 1000
    );
    const hh = String(Math.floor(diff / 3600)).padStart(2, "0");
    const mm = String(Math.floor((diff % 3600) / 60)).padStart(2, "0");
    const ss = String(diff % 60).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }, [ativa, tick]);

  // ===========================
  //  Função para mapear status para classes locais (borda esquerda)
  // ===========================
  const pet01StatusClass = (s) => {
    if (!s) return "status-produzindo";
    const st = String(s).toUpperCase();
    if (st === "PARADA") return "status-parada";
    if (st.includes("BAIXA")) return "status-baixa";
    if (st === "PRODUZINDO") return "status-produzindo";
    // inclui AGUARDANDO como produzindo visualmente no tablet (ajuste se quiser diferente)
    if (st === "AGUARDANDO") return "status-produzindo";
    return "status-produzindo";
  };

  // ===========================
  //  BIPAGEM (função usada pelo modal)
  //  - já implementada na parte 1 mas repetimos aqui para ligar tudo
  // ===========================
  async function bipar(cod) {
    if (!ativa) return alert("Nenhuma ordem atual.");
    if (!bipOperator || !bipOperator.trim()) return alert("Informe o operador.");

    const reg = /^OS\s+(\d+)\s*-\s*(\d{3})$/i;
    const m = cod?.trim()?.match(reg);
    if (!m) return alert("Formato inválido: OS 753 - 001");

    const op = m[1];
    const caixa = Number(m[2]);

    if (String(op) !== String(ativa.code)) {
      return alert(`Código não pertence à O.P ${ativa.code}`);
    }

    if (caixa < 1 || caixa > Number(ativa.boxes)) {
      return alert("Caixa fora do intervalo.");
    }

    // verifica duplicidade
    const { data: dup, error: dupErr } = await supabase
      .from("production_scans")
      .select("id")
      .eq("order_id", ativa.id)
      .eq("scanned_box", caixa)
      .maybeSingle();

    if (dupErr) { console.error(dupErr); return alert("Erro ao verificar bipagem."); }
    if (dup) return alert("Esta caixa já foi bipada.");

    // insere no banco
    const { error } = await supabase.from("production_scans").insert([{
      order_id: ativa.id,
      machine_id: "P3",
      scanned_box: caixa,
      code: cod.trim(),
      operator: bipOperator.trim(),
    }]);

    if (error) {
      console.error(error);
      return alert("Erro ao registrar bipagem.");
    }

    // atualiza localmente
    await loadScans(ativa.id);
    setShowBip(false);
    setBipOperator("");

    // Se zerou -> abre finalização
    if (saldo - 1 <= 0) {
      // chama finalização via App
      setFinalizando && setFinalizando(ativa);
    }
  }

  // ===========================
  //  Registrar refugo
  // ===========================
  async function enviarRefugo(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!ativa) return alert("Nenhuma ordem atual.");

    const { operador, turno, quantidade, motivo } = refugoForm;
    if (!operador?.trim() || !turno?.trim() || !quantidade) return alert("Preencha os campos obrigatórios.");

    const payload = {
      order_id: ativa.id,
      machine_id: "P3",
      operator: operador.trim(),
      shift: turno.trim(),
      qty: Number(quantidade),
      reason: motivo,
    };

    const { error } = await supabase.from("scrap_logs").insert([payload]);
    if (error) { console.error(error); return alert("Erro ao registrar refugo."); }

    setShowRefugo(false);
    setRefugoForm({ operador: "", turno: "", quantidade: "", motivo: REFUGO_MOTIVOS[0] });
  }

  // ===========================
  //  Tratamento de alteração de status (atualização otimista)
  //  - atualiza localmente para efeito imediato
  //  - chama onStatusChange (vindo do App) para persistir e abrir modais se necessários
  // ===========================
  function handleStatusChange(targetStatus) {
    if (!ativa) return;
    const before = ativa.status;

    // validações locais que o App fazia (copiadas do App.jsx behaviours)
    const jaIniciouLocal = !!ativa.started_at;
    if (jaIniciouLocal && targetStatus === "AGUARDANDO") {
      alert('Após iniciar a produção, não é permitido voltar para "Aguardando".');
      return;
    }

    if (targetStatus === "BAIXA_EFICIENCIA" && before !== "BAIXA_EFICIENCIA") {
      const now = new Date();
      console.log("[Pet01] Abrindo modal Baixa Eficiência", ativa, targetStatus);
      setLowEffModal && setLowEffModal({
        ordem: ativa,
        operador: "",
        obs: "",
        data: now.toISOString().slice(0,10),
        hora: now.toTimeString().slice(0,5),
      });
      return;
    }

    if (targetStatus === "PARADA" && before !== "PARADA") {
      const now = new Date();
      console.log("[Pet01] Abrindo modal Parada", ativa, targetStatus);
      setStopModal && setStopModal({
        ordem: ativa,
        operador: "",
        motivo: "Parada Técnica",
        obs: "",
        data: now.toISOString().slice(0,10),
        hora: now.toTimeString().slice(0,5),
      });
      return;
    }

    if (before === "PARADA" && targetStatus !== "PARADA") {
      const now = new Date();
      console.log("[Pet01] Abrindo modal Retomada", ativa, targetStatus);
      setResumeModal && setResumeModal({
        ordem: ativa,
        operador: "",
        data: now.toISOString().slice(0,10),
        hora: now.toTimeString().slice(0,5),
        targetStatus,
      });
      return;
    }

    // Chama apenas o handler do App, sem atualizar localmente
    try {
      console.log("[Pet01] Chamando onStatusChange", ativa, targetStatus);
      onStatusChange && onStatusChange(ativa, targetStatus);
    } catch (err) {
      console.error('Erro ao chamar onStatusChange', err);
    }
  }

  // ============================
  //  PARTE 3/3 — RENDER / JSX
  // ============================
  return (
    <div className="pet01-wrapper" ref={wrapperRef}>

      <h1 className="pet01-title">Apontamento — PET 03</h1>
<img
  src="/Logotipo Savanti.png"
  alt="Savanti Plásticos"
  className="pet01-logo"
  onError={(e) => { e.currentTarget.src = '/savanti-logo.png'; }}
/>

       {/* botão pequeno de tela cheia (canto superior direito) */}
      <button
        type="button"
        className={`pet01-fullscreen-btn ${isFullscreen ? 'active' : ''}`}
        onClick={toggleFullscreen}
        aria-label={isFullscreen ? "Sair da tela cheia" : "Entrar em tela cheia"}
        title={isFullscreen ? "Sair da tela cheia" : "Entrar em tela cheia"}
      >
        {isFullscreen ? (
          /* ícone de minimizar (x) */
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
            <path d="M6 9V6h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M6 6l6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M18 15v3h-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M18 18l-6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : (
          /* ícone de expandir */
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
            <path d="M9 6H6v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M6 6l6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M15 18h3v-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M18 18l-6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </button>

      {/* BOTÕES — agora logo abaixo do título */}
      <div className="pet01-buttons" style={{marginBottom: 16}}>
        <button
          className="pet01-btn green"
          onClick={() => {
            setShowBip(true);
            setTimeout(() => bipRef.current?.focus?.(), 120);
          }}
        >
          Apontar Produção
        </button>

        <button
          className="pet01-btn orange"
          onClick={() => {
            setShowRefugo(true);
          }}
        >
          Apontar Refugo
        </button>
      </div>

      {/* CARD PRINCIPAL: aplica classe local + aplica class do painel (statusClass) ao conteúdo */}
      <div className={`pet01-card ${pet01StatusClass(ativa?.status)}`}>

        {/* header: timer (esquerda) e O.P (direita) */}
        <div className="pet01-card-header">
          <div className="left">
            {ativa?.status === "PARADA" && tempoParada && (
              <span className="pet01-timer red">{tempoParada}</span>
            )}
            {ativa?.status === "BAIXA_EFICIENCIA" && tempoLow && (
              <span className="rotas-loweff-timer">{tempoLow}</span>
            )}
          </div>

          <div className="right">
            <div className="op-inline">O.P - {ativa?.code}</div>
          </div>
        </div>

        {/* Usa a mesma classe que o Painel usa para garantir cor/estilo idênticos */}
        <div className={statusClass(ativa?.status)}>
          <Etiqueta o={ativa} variant="painel" saldoCaixas={saldo} lidasCaixas={lidas} />
        </div>

        {/* Motivo de parada logo abaixo se existir */}
        {paradaAberta?.reason && ativa?.status === "PARADA" && (
          <div className="stop-reason-below">{paradaAberta.reason}</div>
        )}

        <div className="sep" style={{ marginTop: 12 }} />

        {/* Situação: usa handleStatusChange que abre modais conforme regra do App */}
        <div className="pet01-field" style={{ marginTop: 10 }}>
          <label style={{ minWidth: 90 }}>Situação</label>
          <select
            value={ativa?.status || "AGUARDANDO"}
            onChange={(e) => handleStatusChange(e.target.value)}
          >
            {/* Se já iniciou, Painel evita voltar para AGUARDANDO; o App faz validação também */}
            <option value="PRODUZINDO">Produzindo</option>
            <option value="BAIXA_EFICIENCIA">Baixa Eficiência</option>
            <option value="PARADA">Parada</option>
          </select>

          {/* botão Iniciar aparece somente quando AGUARDANDO */}
          <div style={{ marginLeft: 12 }}>
            {ativa?.status === "AGUARDANDO" && (
              <button
                className="btn small primary"
                onClick={() =>
                  setStartModal &&
                  setStartModal({
                    ordem: ativa,
                    operador: "",
                    data: new Date().toISOString().slice(0, 10),
                    hora: new Date().toTimeString().slice(0, 5),
                  })
                }
              >
                Iniciar Produção
              </button>
            )}
          </div>
        </div>
      </div>


      {/* PRÓXIMO ITEM */}
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

      {/* MODAL — BIPAGEM (CENTRALIZADO) */}
      {showBip && (
        <div className="pet01-modal-bg" role="dialog" aria-modal>
          <div className="pet01-modal">
            <h3>Apontamento por Bipagem</h3>

            <label>Operador *</label>
            <input
              className="input"
              value={bipOperator}
              onChange={(e) => setBipOperator(e.target.value)}
              placeholder="Nome do operador"
            />

            <label style={{ marginTop: 8 }}>Código (OS 753 - 001)</label>
            <input
              ref={bipRef}
              className="input"
              placeholder="OS 753 - 001"
              onKeyDown={(e) => {
                if (e.key === "Enter") bipar(e.target.value || bipRef.current?.value);
              }}
            />

            <div className="pet01-modal-buttons" style={{ marginTop: 12 }}>
              <button className="gray" onClick={() => { setShowBip(false); setBipOperator(""); }}>Cancelar</button>
              <button className="green" onClick={() => bipar(bipRef.current?.value)}>Registrar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL — REFUGO (CENTRALIZADO) */}
      {showRefugo && (
        <div className="pet01-modal-bg" role="dialog" aria-modal>
          <div className="pet01-modal">
            <h3>Apontar Refugo</h3>

            <form onSubmit={enviarRefugo}>
              <label>Operador *</label>
              <input className="input" value={refugoForm.operador} onChange={e => setRefugoForm(f => ({ ...f, operador: e.target.value }))} />

              <label>Turno *</label>
              <input className="input" value={refugoForm.turno} onChange={e => setRefugoForm(f => ({ ...f, turno: e.target.value }))} />

              <label>Quantidade *</label>
              <input className="input" type="number" value={refugoForm.quantidade} onChange={e => setRefugoForm(f => ({ ...f, quantidade: e.target.value }))} />

              <label>Motivo *</label>
              <select className="input" value={refugoForm.motivo} onChange={e => setRefugoForm(f => ({ ...f, motivo: e.target.value }))}>
                {REFUGO_MOTIVOS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>

              <div className="pet01-modal-buttons" style={{ marginTop: 12 }}>
                <button type="button" className="gray" onClick={() => setShowRefugo(false)}>Cancelar</button>
                <button type="submit" className="orange">Registrar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

