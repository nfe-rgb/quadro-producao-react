import React, { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'

const ITEMS = [
  { to: '/site', label: 'Home', end: true },
  { to: '/site/quem-somos', label: 'Quem Somos' },
  { to: '/site/produtos', label: 'Produtos' },
  { to: '/site/servicos', label: 'Serviços' },
]

export default function Header() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  function closeMobile() {
    setMobileOpen(false)
  }

  return (
    <header className={`site-header ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="site-container site-header-row">
        <NavLink to="/site" className="site-logo-wrap" onClick={closeMobile}>
          <img
            src="/Logotipo Savanti.png"
            alt="Savanti Plasticos"
            className="site-logo"
            onError={(e) => {
              e.currentTarget.src = '/savanti-logo.png'
            }}
          />
        </NavLink>

        <button
          type="button"
          className="site-mobile-toggle"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Abrir menu"
          aria-expanded={mobileOpen}
        >
          <span />
          <span />
          <span />
        </button>

        <nav className={`site-main-nav ${mobileOpen ? 'is-open' : ''}`} aria-label="Menu institucional">
          <ul>
            {ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  onClick={closeMobile}
                  className={({ isActive }) => `site-nav-item ${isActive ? 'is-active' : ''}`}
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
          <NavLink to="/site/contato" className="site-contact-cta" onClick={closeMobile}>
            Solicitar Contato
          </NavLink>
        </nav>
      </div>
    </header>
  )
}
