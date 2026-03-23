import React from 'react'

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <p>© {new Date().getFullYear()} Savanti Plasticos. Todos os direitos reservados.</p>
        <a href="mailto:comercial@savantiplasticos.com.br">comercial@savantiplasticos.com.br</a>
      </div>
    </footer>
  )
}
