import React from 'react'
import { NavLink } from 'react-router-dom'

export default function SiteHero() {
  return (
    <section className="site-hero" aria-label="Apresentacao principal da Savanti Plasticos">
      <div className="site-hero-copy">
        <p className="site-kicker">Solução B2B para indústria plástica</p>
        <h1>Embalagens plásticas de alta qualidade para sua marca</h1>
        <p className="site-hero-sub">
          Produção de frascos PET, tampas plásticas, terceirização de injeção e aplicação de In Mold Label para os
          segmentos cosmético, farmacêutico e industrial, com foco em confiabilidade, escala e prazo.
        </p>

        <div className="site-hero-actions">
          <NavLink to="/site/produtos" className="site-btn site-btn-primary">
            Ver Produtos
          </NavLink>
          <NavLink to="/site/contato" className="site-btn site-btn-secondary">
            Solicitar Orçamento
          </NavLink>
        </div>
      </div>

      <div className="site-hero-visual" aria-hidden="true">
        <div className="site-glow" />
        <div className="site-bottle site-bottle-lg" />
        <div className="site-bottle site-bottle-md" />
        <div className="site-bottle site-bottle-sm" />
        <div className="site-grid-overlay" />
      </div>
    </section>
  )
}
