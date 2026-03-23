import React from 'react'

export default function Section({ id, variant = 'default', className = '', children }) {
  return (
    <section id={id} className={`site-band site-band-${variant} ${className}`.trim()}>
      <div className="site-container">{children}</div>
    </section>
  )
}
