import React, { useState } from 'react'
import { NavLink } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/site', label: 'Home', end: true },
  { to: '/site/quem-somos', label: 'Quem Somos' },
  { to: '/site/produtos', label: 'Produtos' },
  { to: '/site/aplicacoes', label: 'Aplicacoes' },
]

export default function SiteHeader() {
  const [open, setOpen] = useState(false)

  function closeMenu() {
    setOpen(false)
  }

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <NavLink to="/site" className="site-brand" onClick={closeMenu}>
          <img
            src="/Logotipo Savanti.png"
            alt="Savanti Plasticos"
            className="site-brand-logo"
            onError={(e) => {
              e.currentTarget.src = '/savanti-logo.png'
            }}
          />
        </NavLink>

        <button
          type="button"
          className="site-menu-toggle"
          aria-label="Abrir menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span />
          <span />
          <span />
        </button>

        <nav className={`site-nav ${open ? 'is-open' : ''}`} aria-label="Navegacao institucional">
          <ul className="site-nav-list">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  onClick={closeMenu}
                  className={({ isActive }) => `site-nav-link ${isActive ? 'is-active' : ''}`}
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
          <NavLink to="/site/contato" onClick={closeMenu} className="site-contact-btn">
            Contato
          </NavLink>
        </nav>
      </div>
    </header>
  )
}
