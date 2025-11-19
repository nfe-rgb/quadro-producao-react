import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import "../styles/Pet01.css";

export default function Pet01({
  registroGrupos,
  onStatusChange,
  setStartModal,
  setStopModal,
  setLowEffModal,
  setResumeModal,
  setFinalizando,
  setEditando,
}) {
  const [loading, setLoading] = useState(true);
  const [itemAtual, setItemAtual] = useState(null);
  const [proximoItem, setProximoItem] = useState(null);
  const [scans, setScans] = useState([]);

  const [showBipModal, setShowBipModal] = useState(false);
  const [showRefugoModal, setShowRefugoModal] = useState(false);
  const bipInputRef = useRef(null);

  // timer state
  const [elapsed, setElapsed] = useState("");

  // motivos fixos (conforme você mandou)
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

  // === carregar ordens de P1 a partir do registroGrupos (fornecido pelo App.jsx) ===
  useEffect(() => {
    if (!registroGrupos) return;
    const ordensP1 = registroGrupos
      .map((g) => g.ordem)
      .filter((o) => o?.machine_id === "P1" && !o.finalized)
      .sort((a, b) => (a.pos ?? 999) - (b.pos ?? 999));

    setItemAtual(ordensP1[0] || null);
    setProximoItem(ordensP1[1] || null);
    setLoading(false);
  }, [registroGrupos]);

  // === scans (produção) ===
  async function loadScans(orderId) {
    if (!orderId) { setScans([]); return; }
    const { data } = await supabase
      .from("production_scans")
      .select("*")
      .eq("order_id", orderId)
      .order("scanned_box", { ascending: true });
    setScans(data || []);
  }
  useEffect(() => { if (itemAtual?.id) loadScans(itemAtual.id); else setScans([]); }, [itemAtual?.id]);

  const saldo = useMemo(() => {
    if (!itemAtual) return 0;
    const total = Number(itemAtual.boxes || 0);
    const usados = scans.length;
    return Math.max(0, total - usados);
  }, [itemAtual, scans]);

  // === helper: timestamp para o timer conforme status ===
  function getStatusTimestamp(it) {
    if (!it) return null;
    // prioridade para PARADA -> usar stopped_at ou interrupted_at
    if (it.status === "PARADA") return it.stopped_at || it.interrupted_at || null;
    if (it.status === "BAIXA_EFICIENCIA") return it.loweff_started_at || null;
    if (it.status === "PRODUZINDO" || it.status === "PRODUZINDO" /* alias */) return it.started_at || null;
    // fallback: se não houver item, não mostra
    return null;
  }

  // === formata tempo decorrido ===
  function formatDurationSince(ts) {
    if (!ts) return "";
    const start = new Date(ts).getTime();
    if (!start || isNaN(start)) return "";
    const diff = Date.now() - start;
    if (diff < 0) return "00:00:00";
    const s = Math.floor(diff / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  // interval atualizador do timer
  useEffect(() => {
    const tick = () => {
      const ts = getStatusTimestamp(itemAtual);
      setElapsed(formatDurationSince(ts));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [itemAtual]);

  // === cor do badge do topo conforme status ===
  function headerBadgeClass(it) {
    if (!it) return "badge badge-gray";
    if (it.status === "PARADA") return "badge badge-red";
    if (it.status === "BAIXA_EFICIENCIA") return "badge badge-yellow";
    if (it.status === "PRODUZINDO") return "badge badge-green";
    return "badge badge-gray";
  }

  // === Bipagem: processamento simplificado conforme antes ===
  async function processarBip(code) {
    if (!itemAtual) return alert("Nenhum item em produção.");

    const regex = /^OS\s+(\d+)\s*-\s*(\d{3})$/i;
    const match = code.match(regex);
    if (!match) return alert("Formato inválido. Use: OS 123 - 001");

    const opNumber = match[1];
    const caixaSeq = parseInt(match[2], 10);

    // seu campo 'code' no orders é 'code'
    if (String(itemAtual.code) !== String(opNumber)) {
      return alert(`Código não pertence à O.P atual (esperado OS ${itemAtual.code}).`);
    }

    if (caixaSeq < 1 || caixaSeq > (Number(itemAtual.boxes) || 0)) {
      return alert("Número de caixa fora do intervalo.");
    }

    // duplicidade
    const { data: dup } = await supabase
      .from("production_scans")
      .select("id")
      .eq("order_id", itemAtual.id)
      .eq("scanned_box", caixaSeq)
      .maybeSingle();
    if (dup) return alert("Esta caixa já foi bipada.");

    const { error } = await supabase.from("production_scans").insert([
      {
        order_id: itemAtual.id,
        machine_id: "P1",
        scanned_box: caixaSeq,
        code,
        operator: "Operador", // opcional: capturar do modal/entrada
      },
    ]);
    if (error) {
      console.error(error);
      return alert("Erro ao registrar bipagem.");
    }

    // recarrega scans e fecha modal
    await loadScans(itemAtual.id);
    setShowBipModal(false);

    // se zerou, abre finalização (fluxo do App)
    if (saldo - 1 <= 0) {
      if (window.confirm("Todas as caixas bipiadas. Deseja finalizar a ordem?")) {
        setFinalizando(itemAtual);
      }
    }
  }

  // === Refugo ===
  const [refugoForm, setRefugoForm] = useState({ operador: "", turno: "", quantidade: "", motivo: REFUGO_MOTIVOS[0] });
  async function registrarRefugo(e) {
    e?.preventDefault();
    if (!itemAtual) return alert("Nenhum item atual.");
    const { operador, turno, quantidade, motivo } = refugoForm;
    if (!operador || !turno || !quantidade) return alert("Preencha os campos obrigatórios.");
    const { error } = await supabase.from("scrap_logs").insert([{
      order_id: itemAtual.id,
      machine_id: "P1",
      operator: operador,
      shift: turno,
      qty: Number(quantidade),
      reason: motivo
    }]);
    if (error) { console.error(error); return alert("Erro ao registrar refugo."); }
    setShowRefugoModal(false);
    setRefugoForm({ operador: "", turno: "", quantidade: "", motivo: REFUGO_MOTIVOS[0] });
  }

  // render loading
  if (loading) return <div className="pet-loading">Carregando…</div>;

  return (
    <div className="pet-root-card">
      {/* topo com máquina e badge/timer */}
      <div className="pet-top">
        <div className="machine-name">P1</div>
        <div className={headerBadgeClass(itemAtual)}>
          {itemAtual ? (itemAtual.status === "PARADA" ? "PARADA" : itemAtual.status === "BAIXA_EFICIENCIA" ? "BAIXA EF" : itemAtual.status === "PRODUZINDO" ? "PRODUZINDO" : "") : ""}
          <span className="badge-timer">{elapsed}</span>
        </div>
      </div>

      {/* botões de ação */}
      <div className="pet-actions">
        <button className="btn green" onClick={() => { setShowBipModal(true); setTimeout(()=>bipInputRef.current?.focus?.(),200); }}>Apontar Produção</button>
        <button className="btn red" onClick={() => setShowRefugoModal(true)}>Apontar Refugo</button>
      </div>

      {/* etiqueta Item Atual - formato igual ao painel */}
      <div className={`etiqueta ${itemAtual ? (itemAtual.status === "PARADA" ? "etiqueta-parada" : itemAtual.status === "BAIXA_EFICIENCIA" ? "etiqueta-baixa" : "etiqueta-ok") : ""}`}>
        <div className="etiqueta-header">
          <div className="etq-left">Cliente: <strong>{itemAtual?.customer || "—"}</strong></div>
          <div className="etq-right">O.P - {itemAtual?.code || "—"}</div>
        </div>

        <div className="etiqueta-body">
          <div><strong>Produto:</strong> {itemAtual?.product || "—"}</div>
          <div><strong>Cor:</strong> {itemAtual?.color || "—"}</div>
          <div><strong>Qtd:</strong> {itemAtual?.qty ?? "—"}</div>
          <div><strong>Volumes:</strong> {itemAtual?.boxes ?? "—"}</div>
          <div><strong>Padrão:</strong> {itemAtual?.standard ?? "—"}</div>
          <div><strong>Prazo:</strong> {itemAtual?.due_date ? new Date(itemAtual.due_date).toLocaleDateString() : "—"}</div>

          <div className="etq-divider" />

          <div className="etq-situacao">
            <label>Situação</label>
            <select
              value={itemAtual?.status || "AGUARDANDO"}
              onChange={(e) => {
                const v = e.target.value;
                if (!itemAtual) return;
                onStatusChange(itemAtual, v);
              }}
            >
              <option value="PRODUZINDO">Produzindo</option>
              <option value="BAIXA_EFICIENCIA">Baixa Eficiência</option>
              <option value="PARADA">Parada</option>
            </select>
          </div>
        </div>
      </div>

      {/* próximo item */}
      <div className="pet-card proximo">
        <h3>Próximo Item</h3>
        {proximoItem ? (
          <div className="grid-small">
            <div><strong>Cliente:</strong> {proximoItem.customer}</div>
            <div><strong>Produto:</strong> {proximoItem.product}</div>
            <div><strong>Cor:</strong> {proximoItem.color}</div>
            <div><strong>Qtd:</strong> {proximoItem.qty}</div>
            <div><strong>Volumes:</strong> {proximoItem.boxes}</div>
          </div>
        ) : <div>Nenhum item na fila</div>}
      </div>

      {/* MODAL BIPAGEM */}
      {showBipModal && (
        <div className="modal">
          <div className="modal-box">
            <h4>Apontamento por Bipagem</h4>
            <input ref={bipInputRef} className="input" placeholder="Aproxime o leitor e confirme com Enter" onKeyDown={(e)=>{ if(e.key==='Enter'){ const v=bipInputRef.current.value.trim(); if(v) processarBip(v) } }} />
            <div className="modal-actions">
              <button className="btn gray" onClick={()=>setShowBipModal(false)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL REFUGO */}
      {showRefugoModal && (
        <div className="modal">
          <div className="modal-box">
            <h4>Apontar Refugo</h4>
            <form onSubmit={registrarRefugo}>
              <label>Operador</label>
              <input className="input" value={refugoForm.operador} onChange={(e)=>setRefugoForm(f=>({...f, operador:e.target.value}))} required />
              <label>Turno</label>
              <input className="input" value={refugoForm.turno} onChange={(e)=>setRefugoForm(f=>({...f, turno:e.target.value}))} required />
              <label>Quantidade</label>
              <input className="input" type="number" value={refugoForm.quantidade} onChange={(e)=>setRefugoForm(f=>({...f, quantidade:e.target.value}))} required />
              <label>Motivo</label>
              <select className="input" value={refugoForm.motivo} onChange={(e)=>setRefugoForm(f=>({...f, motivo:e.target.value}))}>
                {REFUGO_MOTIVOS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>

              <div className="modal-actions">
                <button type="button" className="btn gray" onClick={()=>setShowRefugoModal(false)}>Cancelar</button>
                <button type="submit" className="btn red">Registrar Refugo</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
