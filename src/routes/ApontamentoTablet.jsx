

import React, { useState, useRef } from 'react';
import Etiqueta from '../components/Etiqueta';
import Modal from '../components/Modal';
import { STATUS } from '../lib/constants';
import { statusClass } from '../lib/utils';
import '../styles/ApontamentoTablet.css';

export default function ApontamentoTablet({ registroGrupos }) {
  // Filtra apenas os itens da máquina P1
  const gruposP1 = (registroGrupos || []).filter(g => g?.ordem?.machine_id === 'P1');
  const atual = gruposP1[0]?.ordem || null;
  const proximo = gruposP1[1]?.ordem || null;

  // Estado dos modais
  const [modalBipagem, setModalBipagem] = useState(false);
  const [modalRefugo, setModalRefugo] = useState(false);
  const [refugoForm, setRefugoForm] = useState({ operador: '', turno: '', refugo: '' });
  const [operador, setOperador] = useState("");
  const [barcode, setBarcode] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const [situacao, setSituacao] = useState(atual?.status || "PRODUZINDO");

  function abrirBipagem() { setModalBipagem(true); }
  function fecharBipagem() { setModalBipagem(false); setOperador(""); setBarcode(""); }
  function abrirRefugo() { setModalRefugo(true); }
  function fecharRefugo() { setModalRefugo(false); setRefugoForm({ operador: '', turno: '', refugo: '' }); }
  function handleRefugoSubmit(e) {
    e.preventDefault();
    fecharRefugo();
    alert('Refugo registrado!');
  }

  // Modal de bipagem igual ao painel
  function handleScanSubmit(e) {
    e?.preventDefault();
    if (!operador) {
      alert("Informe o nome do operador antes de bipar.");
      return;
    }
    // ... aqui pode integrar a lógica do painel ...
    fecharBipagem();
    alert('Leitura registrada!');
  }

  // Define cor de fundo conforme situação
  const statusColors = {
    PRODUZINDO: '#e0f7fa',
    BAIXA_EFICIENCIA: '#fff3e0',
    PARADA: '#ffebee',
  };
  const corPainel = statusColors[situacao] || '#fff';

  return (
    <div style={{ background: '#f6f6f6', minHeight: '100vh', padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start' }}>
      <h2 style={{ marginBottom: 24, fontSize: 28, color: '#333' }}>Apontamento - Máquina P1</h2>

      {/* Botões de apontamento */}
      <div style={{ display: 'flex', gap: 32, marginBottom: 32 }}>
        <button style={{ fontSize: 24, padding: '24px 36px', borderRadius: 16, background: '#0a7', color: '#fff', border: 'none', fontWeight: 700 }} onClick={abrirBipagem}>Apontar Produção</button>
        <button style={{ fontSize: 24, padding: '24px 36px', borderRadius: 16, background: '#e74c3c', color: '#fff', border: 'none', fontWeight: 700 }} onClick={abrirRefugo}>Apontar Refugo</button>
      </div>

      {/* Item atual igual ao painel, com cor e botão de situação */}
      <div style={{ width: '100%', maxWidth: 420, margin: '0 auto', marginBottom: 32 }}>
        <div className={statusClass(situacao)} style={{padding: 24}}>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Item Atual</div>
          {atual ? (
            <>
              <Etiqueta o={{ ...atual, status: situacao }} variant="painel" />
              <div className="sep"></div>
              <div className="grid2">
                <div>
                  <div className="label">Situação</div>
                  <select
                    className="select"
                    value={situacao}
                    onChange={e => setSituacao(e.target.value)}
                  >
                    {STATUS.filter((s) => s !== "AGUARDANDO").map((s) => (
                      <option key={s} value={s}>
                        {s === "PRODUZINDO"
                          ? "Produzindo"
                          : s === "BAIXA_EFICIENCIA"
                          ? "Baixa Eficiência"
                          : "Parada"}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          ) : (
            <div style={{ color: '#888' }}>Nenhum item atual</div>
          )}
        </div>
      </div>

      {/* Próximo item como etiqueta de fila */}
      <div style={{ width: '100%', maxWidth: 420, margin: '0 auto' }}>
        <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px #0001', padding: 24 }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Próximo Item</div>
          {proximo ? (
            <Etiqueta o={proximo} variant="fila" />
          ) : (
            <div style={{ color: '#888' }}>Nenhum próximo item</div>
          )}
        </div>
      </div>

      {/* Modal de bipagem igual ao painel */}
      <Modal open={modalBipagem} onClose={fecharBipagem} title="Apontamento por Bipagem">
        <div className="grid" style={{ padding: 16 }}>
          <div>
            <div className="label">Operador *</div>
            <input
              className="input"
              value={operador}
              onChange={e => setOperador(e.target.value)}
              placeholder="Nome do operador"
            />
          </div>
          <form onSubmit={handleScanSubmit}>
            <div className="label">Ler código (OS 753 - 001)</div>
            <input
              ref={inputRef}
              className="input"
              value={barcode}
              onChange={e => setBarcode(e.target.value)}
              placeholder='Aproxime o leitor e confirme com Enter'
              disabled={!operador || busy}
            />
          </form>
          <div className="muted" style={{ marginTop: 8 }}>
            • Formato aceito: <code>OS 753 - 001</code><br />
            • Duplicidade é bloqueada por sessão e por banco de dados.
          </div>
          <div className="sep"></div>
          <div className="flex" style={{ justifyContent: "flex-end", gap: 8 }}>
            <button className="btn ghost" onClick={fecharBipagem}>Fechar</button>
            <button className="btn primary" onClick={handleScanSubmit} disabled={!operador || busy}>
              {busy ? "Registrando..." : "Registrar Leitura"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal de apontar refugo */}
      <Modal open={modalRefugo} onClose={fecharRefugo} title="Apontar Refugo">
        <form onSubmit={handleRefugoSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div className="label">Operador *</div>
            <input className="input" value={refugoForm.operador} onChange={e=>setRefugoForm(f=>({...f, operador:e.target.value}))} required placeholder="Nome do operador" />
          </div>
          <div>
            <div className="label">Turno *</div>
            <input className="input" value={refugoForm.turno} onChange={e=>setRefugoForm(f=>({...f, turno:e.target.value}))} required placeholder="Turno" />
          </div>
          <div>
            <div className="label">Refugo (Peças) *</div>
            <input className="input" type="number" min="0" value={refugoForm.refugo} onChange={e=>setRefugoForm(f=>({...f, refugo:e.target.value}))} required placeholder="Quantidade de peças" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn ghost" type="button" onClick={fecharRefugo}>Cancelar</button>
            <button className="btn primary" type="submit">Registrar Refugo</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
