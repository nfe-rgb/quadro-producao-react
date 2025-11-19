// src/components/Tabs.jsx
import React from 'react'
export default function Tabs({ tab, setTab }) {
  return (
    <div className="tabs">
      <button className={`tabbtn ${tab==='painel'?'active':''}`} onClick={()=>setTab('painel')}>Painel</button>
      <button className={`tabbtn ${tab==='lista'?'active':''}`} onClick={()=>setTab('lista')}>Lista</button>
      <button className={`tabbtn ${tab==='nova'?'active':''}`} onClick={()=>setTab('nova')}>Nova Ordem</button>
      <button className={`tabbtn ${tab==='registro'?'active':''}`} onClick={()=>setTab('registro')}>Registro</button>
    </div>
  )
}