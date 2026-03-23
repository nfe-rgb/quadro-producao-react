import React from 'react'
import { NavLink } from 'react-router-dom'

export default function Hero() {
  return (
    <section className="site-hero-grid" aria-label="Apresentacao principal Savanti Plásticos">
      <div className="site-hero-left">
        <p className="site-kicker">Indústria plástica premium para marcas B2B</p>
        <h1>Soluções inteligentes em frascos PET e tampas plásticas</h1>
        <p>
          A Savanti Plásticos desenvolve soluções inovadoras em embalagens e injeção plástica, oferecendo qualidade,
          agilidade e suporte técnico para empresas em todo o Brasil.
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

      <div className="site-hero-right" aria-hidden="true">
        <div className="site-light-ring" />
        <img className="site-hero-main-photo" src="/imagens-produtos-site/linha-completa.jpg" alt="Linha completa de produtos Savanti" />
        <img
          className="site-hero-float-photo site-hero-float-a"
          src="/imagens-produtos-site/frasco-whatsapp-2026-a.jpeg"
          alt="Frascos PET Savanti"
        />
        <img
          className="site-hero-float-photo site-hero-float-b"
          src="/imagens-produtos-site/tampa-flip-top-color.jpeg"
          alt="Tampa flip-top Savanti"
        />
        <div className="site-tech-grid" />
      </div>
    </section>
  )
}
