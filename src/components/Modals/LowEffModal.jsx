// src/components/Modals/LowEffModal.jsx
import React from 'react'
import Modal from '../Modal'

export default function LowEffModal({ lowEffModal, setLowEffModal, confirmarBaixaEf }) {
  if (!lowEffModal) return null
  return (
    <Modal open={!!lowEffModal} onClose={()=>setLowEffModal(null)} title={`Baixa eficiência • ${lowEffModal.ordem.machine_id} • O.P ${lowEffModal.ordem.code}`}>
      <div className="grid">
        <div>
          <div className="label">Operador *</div>
          <input className="input" value={lowEffModal.operador} onChange={e=>setLowEffModal(v=>({...v, operador:e.target.value}))} placeholder="Nome do operador" />
        </div>
        <div className="grid2">
          <div><div className="label">Data *</div><input type="date" className="input" value={lowEffModal.data} onChange={e=>setLowEffModal(v=>({...v, data:e.target.value}))}/></div>
          <div><div className="label">Hora *</div><input type="time" className="input" value={lowEffModal.hora} onChange={e=>setLowEffModal(v=>({...v, hora:e.target.value}))}/></div>
        </div>
        <div>
          <div className="label">Observação</div>
          <textarea className="textarea" rows={3} value={lowEffModal.obs} onChange={e=>setLowEffModal(v=>({...v, obs:e.target.value}))} placeholder="Descreva o motivo da baixa eficiência, se desejar..." />
        </div>
        <div className="sep"></div>
        <div className="flex" style={{justifyContent:'flex-end', gap:8}}>
          <button className="btn ghost" onClick={()=>setLowEffModal(null)}>Cancelar</button>
          <button className="btn primary" onClick={()=>confirmarBaixaEf(lowEffModal)}>Confirmar</button>
        </div>
      </div>
    </Modal>
  )
}
