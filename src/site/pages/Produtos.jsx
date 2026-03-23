import React from 'react'
import Section from '../components/Section'
import ProductCard from '../components/ProductCard'

const PRODUCTS = [
  {
    title: 'Frascos PET para Cosméticos',
    description: 'Modelos para linhas de cuidados pessoais, com padrão visual premium e controle de qualidade.',
    imageLabel: 'Cosméticos',
    imageSrc: '/imagens-produtos-site/frasco-whatsapp-2022.jpeg',
  },
  {
    title: 'Frascos PET Conta Gotas',
    description: 'Soluções para produtos de dosagem precisa, com excelente acabamento e regularidade produtiva.',
    imageLabel: 'Conta Gotas',
    imageSrc: '/imagens-produtos-site/frasco-whatsapp-2026-a.jpeg',
  },
  {
    title: 'Frascos PET Body Splash',
    description: 'Embalagens com foco em apresentação e consistência para marcas que exigem performance de escala.',
    imageLabel: 'Body Splash',
    imageSrc: '/imagens-produtos-site/frasco-whatsapp-2026-b.jpeg',
  },
  {
    title: 'Frascos para Produtos Líquidos',
    description: 'Estrutura preparada para aplicações diversas em mercados que demandam confiabilidade de fornecimento.',
    imageLabel: 'Líquidos',
    imageSrc: '/imagens-produtos-site/linha-completa.jpg',
  },
]

export default function Produtos() {
  return (
    <>
      <Section variant="surface">
        <div className="site-page-head">
          <p className="site-kicker">Produtos</p>
          <h1>Catálogo de Frascos PET</h1>
          <p>
            Layout preparado para expansão de catálogo com imagem, descrição técnica e ação de contato comercial.
          </p>
          <p>
            Pasta de imagens reservada: <strong>public/imagens-produtos-site/</strong>
          </p>
        </div>
      </Section>

      <Section variant="hero">
        <div className="site-product-grid">
          {PRODUCTS.map((item) => (
            <ProductCard
              key={item.title}
              title={item.title}
              description={item.description}
              imageLabel={item.imageLabel}
              imageSrc={item.imageSrc}
              contactHref="/site/contato"
            />
          ))}
        </div>
      </Section>
    </>
  )
}
