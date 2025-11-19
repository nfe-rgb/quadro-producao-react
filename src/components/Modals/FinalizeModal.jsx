// src/components/Modals/FinalizeModal.jsx
import React from 'react'
import Modal from '../Modal'

export default function FinalizeModal({ finalizando, setFinalizando, confirmData, setConfirmData, finalizar }) {
  if (!finalizando) return null
  return (
    <Modal open={!!finalizando} onClose={()=>setFinalizando(null)} title={`Finalizar O.P ${finalizando.code}`}>
      <div className="grid">
        <div><div className="label">Finalizado por *</div><input className="input" value={confirmData.por} onChange={e=>setConfirmData(v=>({...v, por:e.target.value}))} placeholder="Nome do operador"/></div>
        <div className="grid2">
          <div><div className="label">Data *</div><input type="date" className="input" value={confirmData.data} onChange={e=>setConfirmData(v=>({...v, data:e.target.value}))}/></div>
          <div><div className="label">Hora *</div><input type="time" className="input" value={confirmData.hora} onChange={e=>setConfirmData(v=>({...v, hora:e.target.value}))}/></div>
        </div>
        <div className="sep"></div>
        <div className="flex" style={{justifyContent:'flex-end'}}>
          <button className="btn ghost" onClick={()=>setFinalizando(null)}>Cancelar</button>
          <button className="btn primary" onClick={async ()=>{ if(!confirmData.por || !confirmData.data || !confirmData.hora) return; await finalizar(finalizando, confirmData); setFinalizando(null) }}>Confirmar</button>
        </div>
      </div>
    </Modal>
  )
}