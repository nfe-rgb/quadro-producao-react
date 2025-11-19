// src/components/BrandBar.jsx
import React from 'react'
export default function BrandBar() {
  return (
    <div className="brand-bar">
      <img src="/Logotipo Savanti.png" alt="Savanti Plásticos" className="brand-logo"
           onError={(e)=>{ e.currentTarget.src='/savanti-logo.png'; }}/>
      <div className="brand-titles">
        <h1 className="brand-title">Painel de Produção</h1>
        <div className="brand-sub">Savanti Plásticos • Controle de Ordens</div>
      </div>
    </div>
  )
}
