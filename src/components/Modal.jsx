// src/components/Modal.jsx
import { createPortal } from 'react-dom'

export default function Modal({ open, onClose, title, children, closeOnBackdrop = true, modalClassName = '' }) {
  if (!open) return null
  const className = ['modal', modalClassName].filter(Boolean).join(' ')

  const handleBackdropClick = () => {
    if (!closeOnBackdrop) return
    onClose?.()
  }

  const modalEl = (
    <div className="modalbg" role="dialog" aria-modal="true" onClick={handleBackdropClick}>
      <div className={className} onClick={(e)=>e.stopPropagation()}>
        {title ? <h3 style={{marginTop:0}}>{title}</h3> : null}
        {children}
      </div>
    </div>
  )
  return createPortal(modalEl, document.body)
}
