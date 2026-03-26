import React, { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import '../styles/Site.css'
import Header from '../site/components/Header'
import Footer from '../site/components/Footer'
import Home from '../site/pages/Home'
import QuemSomos from '../site/pages/QuemSomos'
import Produtos from '../site/pages/Produtos'
import Servicos from '../site/pages/Servicos'
import Contato from '../site/pages/Contato'
import CameraTeste from '../site/pages/CameraTeste'

export default function Site() {
  const location = useLocation()
  const pathname = String(location?.pathname || '').replace(/\/+$/, '')
  const searchParams = new URLSearchParams(location?.search || '')
  const isCameraMode = pathname === '/site/camera' || searchParams.get('camera') === '1'

  useEffect(() => {
    if (isCameraMode) return undefined
    window.scrollTo(0, 0)
    return undefined
  }, [isCameraMode, pathname])

  useEffect(() => {
    if (isCameraMode) return undefined

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.14, rootMargin: '0px 0px -10% 0px' }
    )

    const raf = window.requestAnimationFrame(() => {
      document.querySelectorAll('.site-reveal').forEach((el) => observer.observe(el))
    })

    return () => {
      window.cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [isCameraMode, pathname])

  if (isCameraMode) {
    return <CameraTeste />
  }

  let page = <Home />
  if (pathname === '/site/quem-somos') page = <QuemSomos />
  if (pathname === '/site/produtos') page = <Produtos />
  if (pathname === '/site/servicos' || pathname === '/site/aplicacoes') page = <Servicos />
  if (pathname === '/site/contato') page = <Contato />

  return (
    <div className="site-shell">
      <Header />
      <main className="site-main">{page}</main>
      <a
        href="https://wa.me/5547988030670"
        target="_blank"
        rel="noreferrer"
        className="site-whatsapp-float"
        aria-label="Falar no WhatsApp"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M20.52 3.48A11.8 11.8 0 0 0 12.08 0C5.56 0 .24 5.32.24 11.84c0 2.08.56 4.08 1.6 5.84L0 24l6.52-1.68a11.79 11.79 0 0 0 5.56 1.44h.01c6.52 0 11.84-5.32 11.84-11.84 0-3.16-1.24-6.12-3.4-8.44Zm-8.44 18.28h-.01a9.83 9.83 0 0 1-5.01-1.36l-.36-.2-3.88 1 1.04-3.8-.24-.39a9.83 9.83 0 0 1-1.52-5.24c0-5.44 4.44-9.88 9.88-9.88a9.77 9.77 0 0 1 7.02 2.92 9.78 9.78 0 0 1 2.9 6.96c0 5.44-4.44 9.88-9.82 9.88Zm5.42-7.38c-.3-.16-1.78-.88-2.06-.98-.28-.1-.48-.16-.68.16-.2.3-.78.98-.96 1.18-.18.2-.36.22-.66.08-.3-.16-1.28-.48-2.44-1.54-.9-.8-1.5-1.78-1.68-2.08-.18-.3-.02-.46.14-.62.14-.14.3-.36.44-.54.14-.18.2-.3.3-.5.1-.2.04-.38-.02-.54-.08-.16-.68-1.64-.94-2.24-.24-.58-.48-.5-.68-.5h-.58c-.2 0-.52.08-.8.38-.28.3-1.04 1.02-1.04 2.5s1.06 2.9 1.2 3.1c.16.2 2.12 3.24 5.14 4.54.72.3 1.28.48 1.72.62.72.22 1.36.18 1.88.1.58-.08 1.78-.72 2.04-1.42.26-.7.26-1.3.18-1.42-.06-.12-.26-.2-.56-.36Z" />
        </svg>
        <span>WhatsApp</span>
      </a>
      <Footer />
    </div>
  )
}
