import React from 'react'

export default function FeatureCard({ title, text }) {
  return (
    <article className="site-feature-card">
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  )
}
