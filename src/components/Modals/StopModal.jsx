// src/components/Modals/StopModal.jsx
import React from 'react'
import Modal from '../Modal'
import { MOTIVOS_PARADA } from '../../lib/constants'

export default function StopModal({ stopModal, setStopModal, confirmarParada }) {
  if (!stopModal) return null
  return (
    <Modal open={!!stopModal} onClose={()=>setStopModal(null)} title={`Parar máquina • ${stopModal.ordem.machine_id} • O.P ${stopModal.ordem.code}`}>
      <div className="grid">
        <div><div className="label">Operador *</div><input className="input" value={stopModal.operador} onChange={e=>setStopModal(v=>({...v, operador:e.target.value}))} placeholder="Nome do operador"/></div>
        <div className="grid2">
          <div><div className="label">Data *</div><input type="date" className="input" value={stopModal.data} onChange={e=>setStopModal(v=>({...v, data:e.target.value}))}/></div>
          <div><div className="label">Hora *</div><input type="time" className="input" value={stopModal.hora} onChange={e=>setStopModal(v=>({...v, hora:e.target.value}))}/></div>
        </div>
        <div>
          <div className="label">Motivo da Parada *</div>
          <select className="select" value={stopModal.motivo} onChange={e=>setStopModal(v=>({...v, motivo:e.target.value}))}>
            {MOTIVOS_PARADA.map(m=> <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <div className="label">Observações</div>
          <textarea className="textarea" rows={4} value={stopModal.obs} onChange={e=>setStopModal(v=>({...v, obs:e.target.value}))} placeholder="Detalhe o problema, se necessário..."/>
        </div>
        <div className="sep"></div>
        <div className="flex" style={{justifyContent:'flex-end', gap:8}}>
          <button className="btn ghost" onClick={()=>setStopModal(null)}>Cancelar</button>
          <button className="btn primary" onClick={()=>confirmarParada(stopModal)}>Confirmar Parada</button>
        </div>
      </div>
    </Modal>
  )
}