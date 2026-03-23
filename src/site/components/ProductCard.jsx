import React, { useState } from 'react'

export default function ProductCard({
  title,
  description,
  imageLabel = 'PET',
  imageSrc = '',
  contactHref = '/site/contato',
}) {
  const [failedImage, setFailedImage] = useState(false)
  const showImage = !!imageSrc && !failedImage

  return (
    <article className="site-product-card">
      <div className="site-product-image" aria-label={`Imagem do produto ${title}`}>
        {showImage ? (
          <img src={imageSrc} alt={title} loading="lazy" onError={() => setFailedImage(true)} />
        ) : (
          <span>{imageLabel}</span>
        )}
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      <a href={contactHref} className="site-btn site-btn-secondary">
        Solicitar Contato
      </a>
    </article>
  )
}
