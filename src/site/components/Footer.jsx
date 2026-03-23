import React from 'react'
import { NavLink } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-container site-footer-grid">
        <div>
          <img
            src="/Logotipo Savanti.png"
            alt="Savanti Plasticos"
            className="site-footer-logo"
            onError={(e) => {
              e.currentTarget.src = '/savanti-logo.png'
            }}
          />
          <p className="site-footer-muted">Soluções em embalagens PET e injeção plástica para clientes B2B.</p>
        </div>

        <nav className="site-footer-links" aria-label="Menu rápido">
          <h4>Menu</h4>
          <NavLink to="/site">Home</NavLink>
          <NavLink to="/site/quem-somos">Quem Somos</NavLink>
          <NavLink to="/site/produtos">Produtos</NavLink>
          <NavLink to="/site/servicos">Serviços</NavLink>
          <NavLink to="/site/contato">Contato</NavLink>
        </nav>

        <div className="site-footer-links">
          <h4>Contato</h4>
          <a href="mailto:comercial@savantiplasticos.com.br">comercial@savantiplasticos.com.br</a>
          <a href="tel:+554733051812">(47) 3305-1812</a>
          <a href="https://wa.me/5547988030670" target="_blank" rel="noreferrer">(47) 98803-0670</a>
          <p>Florentina Pereira Jasper, 187 Galpao B | Porto Grande Araquari | SC</p>
        </div>
      </div>
      <div className="site-footer-bottom">
        <div className="site-container">
          <p>© {new Date().getFullYear()} Savanti Plásticos. Todos os direitos reservados.</p>
        </div>
      </div>
    </footer>
  )
}
