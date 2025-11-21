// src/feature/Apontamento.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { MAQUINAS } from "../lib/constants";
import { getTurnoAtual } from "../lib/utils";

const BARCODE_RE = /^\s*OS\s+(\d{1,6})\s*-\s*(\d{3})\s*$/i;

function pad3(n) {
  return String(n).padStart(3, "0");
}

// Util: pega a O.P ativa por máquina do mapa ativosPorMaquina
function getActiveOrdersMap(ativosPorMaquina) {
  const map = {};
  for (const m of MAQUINAS) {
    const lista = ativosPorMaquina[m] || [];
    if (lista[0]) map[m] = lista[0];
  }
  return map;
}

export default function Apontamento({ tab, ordens, ativosPorMaquina, finalizar }) {
  const [open, setOpen] = useState(false);
  const [operador, setOperador] = useState("");
  const [barcode, setBarcode] = useState("");
  const [sessionSeen, setSessionSeen] = useState(() => new Set()); // "orderId#seq"
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const [turno, setTurno] = useState(getTurnoAtual());
  // Atualiza turno ao abrir modal
  useEffect(() => {
    if (open) {
      setTurno(getTurnoAtual());
    }
  }, [open]);

  // Contador por ordem (order_id -> count) — fallback visual local
  const [counts, setCounts] = useState({}); // { [orderId]: number }

  // O.P ativa por máquina
  const ativos = useMemo(() => getActiveOrdersMap(ativosPorMaquina), [ativosPorMaquina]);

  // Traz contagem (head=true pega só o count) — fallback visual
  async function fetchCountForOrder(orderId) {
    const { count, error } = await supabase
      .from("box_scans")
      .select("*", { count: "exact", head: true })
      .eq("order_id", orderId);
    if (!error) {
      setCounts((prev) => ({ ...prev, [orderId]: count || 0 }));
    }
  }

  // Atualiza contagens das O.P. ativas (fallback)
  useEffect(() => {
    const ids = Object.values(ativos).map((o) => o.id);
    ids.forEach((id) => fetchCountForOrder(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativosPorMaquina]);

  // Realtime nas inserções de box_scans (fallback visual local)
  useEffect(() => {
    const ch = supabase
      .channel("box_scans-rt")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "box_scans" },
        (p) => {
          const row = p.new;
          if (!row?.order_id) return;
          setCounts((prev) => ({ ...prev, [row.order_id]: (prev[row.order_id] || 0) + 1 }));
        }
      )
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, []);

  // Foco automático no input ao abrir
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Busca O.P pelo número (code) capturado
  function findOrderByNumber(opNumber) {
    const cleaned = String(opNumber).replace(/\D+/g, "");
    return ordens.find((o) => String(o.code).replace(/\D+/g, "") === cleaned) || null;
  }

  async function handleScanSubmit(e) {
    e?.preventDefault();
    if (!operador) {
      alert("Informe o nome do operador antes de bipar.");
      return;
    }
    const txt = barcode.trim();
    const m = txt.match(BARCODE_RE);
    if (!m) {
      alert('Código inválido. Formato esperado: "OS 753 - 001".');
      setBarcode("");
      return;
    }

    const opNumber = m[1];        // ex.: 753
    const seqStr   = m[2];        // ex.: "001"
    const seq      = parseInt(seqStr, 10);

    const order = findOrderByNumber(opNumber);
    if (!order) {
      alert(`O.P ${opNumber} não encontrada entre as ordens carregadas.`);
      setBarcode("");
      return;
    }

    const key = `${order.id}#${seq}`;
    if (sessionSeen.has(key)) {
      alert(`A caixa ${pad3(seq)} da O.P ${opNumber} já foi lida nesta sessão.`);
      setBarcode("");
      return;
    }

    setBusy(true);
    try {
      // 🔒 Consulta "ao vivo" para garantir limites/estado atual
      const { data: fresh, error: freshErr } = await supabase
        .from("orders")
        .select("id, boxes, boxes_read, finalized, code")
        .eq("id", order.id)
        .maybeSingle();

      if (freshErr || !fresh) {
        alert("Falha ao validar status da O.P antes da leitura.");
        setBarcode("");
        return;
      }

      if (fresh.finalized) {
        alert("Esta O.P já está finalizada.");
        setBarcode("");
        return;
      }

      if (fresh.status === "PARADA") {
        alert("Máquina parada — não é permitido apontar caixas enquanto estiver em PARADA.");
        setBarcode("");
        return;
      }

      const totalBoxes = parseInt(fresh.boxes || 0, 10) || 0;
      const already    = parseInt(fresh.boxes_read || 0, 10) || 0;

      // 🚫 Sem caixas definidas → apontamento desabilitado
      if (totalBoxes <= 0) {
        alert("Esta O.P não possui quantidade de caixas definida; apontamento desabilitado.");
        setBarcode("");
        return;
      }

      // Valida faixa da sequência
      if (seq < 1 || seq > totalBoxes) {
        alert(`Sequência fora do intervalo 1..${pad3(totalBoxes)} para esta O.P.`);
        setBarcode("");
        return;
      }

      // 🚫 Bloqueia leitura acima do total (saldo 0)
      if (already >= totalBoxes) {
        alert("Saldo zerado — esta O.P já atingiu o total de caixas.");
        setBarcode("");
        return;
      }

      // Insert com proteção pelo UNIQUE(order_id, box_seq)
      const { error } = await supabase
        .from("box_scans")
        .insert([{ order_id: order.id, box_seq: seq, scanned_by: operador }]);

      if (error) {
        if (String(error.message).toLowerCase().includes("duplicate")) {
          alert(`Duplicado: a caixa ${pad3(seq)} desta O.P já foi registrada anteriormente.`);
        } else {
          alert("Falha ao registrar leitura: " + error.message);
        }
        setBarcode("");
        return;
      }

      // Marca localmente para não aceitar de novo nesta sessão
      setSessionSeen((prev) => new Set(prev).add(key));

      // Atualiza contagem local (fallback)
      await fetchCountForOrder(order.id);

      // ✅ Trigger no DB já incrementou orders.boxes_read → Realtime de "orders" atualiza o Painel.
      const newCount = already + 1;
      if (newCount >= totalBoxes) {
        const now  = new Date();
        const data = now.toISOString().slice(0, 10);
        const hora = now.toTimeString().slice(0, 5);

        const ok = confirm(
          `Última caixa (${pad3(seq)}) bipada para O.P ${fresh.code}.\n` +
          `Deseja finalizar agora?\n\nOperador: ${operador}\nData: ${data}\nHora: ${hora}`
        );
        if (ok) {
          await finalizar(order, { por: operador, data, hora });
          setSessionSeen((prev) => {
            const n = new Set([...prev].filter((k) => !k.startsWith(order.id + "#")));
            return n;
          });
          setOpen(false);
        }
      }
    } finally {
      setBusy(false);
      setBarcode("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  if (tab !== "painel") return null;

  return (
    <>
      {/* FAB: Botão Apontamento */}
      <button
        className="btn primary"
        style={{ position: "fixed", right: 16, top: 16, zIndex: 1000 }}
        onClick={() => setOpen(true)}
      >
        Apontamento
      </button>

      {/* Modal de bipagem */}
      {open && (
        <div
          className="card"
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000
          }}
          onClick={() => setOpen(false)}
        >
          <div className="card" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="label" style={{ marginBottom: 8 }}>Apontamento por Bipagem</div>


            <div className="grid">
              <div>
                <div className="label">Operador *</div>
                <input
                  className="input"
                  value={operador}
                  onChange={(e) => setOperador(e.target.value)}
                  placeholder="Nome do operador"
                />
              </div>

              <div>
                <div className="label">Turno detectado</div>
                <input
                  className="input"
                  value={
                    turno === 1 ? "Turno 1"
                    : turno === 2 ? "Turno 2"
                    : turno === 3 ? "Turno 3"
                    : "Hora Extra"
                  }
                  disabled
                  style={{ background: '#f5f5f5', color: '#333' }}
                />
              </div>

              <form onSubmit={handleScanSubmit}>
                <div className="label">Ler código (OS 753 - 001)</div>
                <input
                  ref={inputRef}
                  className="input"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder='Aproxime o leitor e confirme com Enter'
                  disabled={!operador || busy}
                />
              </form>

              <div className="muted" style={{ marginTop: 8 }}>
                • Formato aceito: <code>OS 753 - 001</code><br/>
                • Duplicidade é bloqueada por sessão e por banco de dados.<br/>
                • O turno é detectado automaticamente pelo sistema.
              </div>
            </div>

            <div className="sep"></div>
            <div className="flex" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button className="btn ghost" onClick={() => setOpen(false)}>Fechar</button>
              <button className="btn primary" onClick={handleScanSubmit} disabled={!operador || busy}>
                {busy ? "Registrando..." : "Registrar Leitura"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
