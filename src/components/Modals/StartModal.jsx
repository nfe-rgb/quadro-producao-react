// src/components/Modals/StartModal.jsx
import React from 'react'
import Modal from '../Modal' // seu componente Modal existente
export default function StartModal({ startModal, setStartModal, confirmarInicio }) {
  if (!startModal) return null
  return (
    <Modal open={!!startModal} onClose={()=>setStartModal(null)} title={`Iniciar Produção • ${startModal.ordem.machine_id} • O.P ${startModal.ordem.code}`}>
      <div className="grid">
        <div><div className="label">Operador *</div><input className="input" value={startModal.operador} onChange={e=>setStartModal(v=>({...v, operador:e.target.value}))} placeholder="Nome do operador"/></div>
        <div className="grid2">
          <div><div className="label">Data *</div><input type="date" className="input" value={startModal.data} onChange={e=>setStartModal(v=>({...v, data:e.target.value}))}/></div>
          <div><div className="label">Hora *</div><input type="time" className="input" value={startModal.hora} onChange={e=>setStartModal(v=>({...v, hora:e.target.value}))}/></div>
        </div>
        <div className="sep"></div>
        <div className="flex" style={{justifyContent:'flex-end', gap:8}}>
          <button className="btn ghost" onClick={()=>setStartModal(null)}>Cancelar</button>
          <button className="btn primary" onClick={()=>confirmarInicio(startModal)}>Iniciar</button>
        </div>
      </div>
    </Modal>
  )
}
