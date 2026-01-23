// src/components/Modal.jsx
import { createPortal } from 'react-dom'

export default function Modal({ open, onClose, title, children }) {
  if (!open) return null
  const modalEl = (
    <div className="modalbg" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal" onClick={(e)=>e.stopPropagation()}>
        {title ? <h3 style={{marginTop:0}}>{title}</h3> : null}
        {children}
      </div>
    </div>
  )
  return createPortal(modalEl, document.body)
}
