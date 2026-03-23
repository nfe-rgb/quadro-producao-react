import React from 'react'
import { NavLink } from 'react-router-dom'
import Hero from '../components/Hero'
import Section from '../components/Section'
import FeatureCard from '../components/FeatureCard'

const DIFFERENTIALS = [
  {
    title: 'Atendimento Nacional',
    text: 'Nosso atendimento abrange todo território nacional, oferecendo suporte completo aos nossos clientes.',
  },
  {
    title: 'Suporte Técnico Especializado',
    text: 'Profissionais com know how para desenvolvimento de produtos e moldes com eficiência e inovação.',
  },
  {
    title: 'Qualidade e Agilidade',
    text: 'Compromisso com qualidade e agilidade na entrega de produtos e serviços.',
  },
]

const SOLUTIONS = [
  {
    title: 'Produtos Standard',
    text: 'Linha própria para o setor de embalagens com padrão de qualidade, estabilidade de fornecimento e sustentabilidade.',
  },
  {
    title: 'Terceirização de Injeção',
    text: 'Equipamentos e expertise para produção terceirizada de peças plásticas, ampliando sua capacidade produtiva.',
  },
  {
    title: 'Embalagens PET',
    text: 'Frascos PET para cosméticos, conta gotas, body splash e diversas aplicações industriais.',
  },
]

const SEGMENTS = ['Cosméticos', 'Perfumaria', 'Farmacêutico', 'Higiene', 'Indústria']

const AUTHORITY = [
  { value: 'Brasil inteiro', label: 'Atendimento em todo o território nacional' },
  { value: 'Foco PET', label: 'Especialistas em embalagens PET e tampas plásticas' },
  { value: 'B2B industrial', label: 'Soluções técnicas para empresas e marcas em escala' },
]

export default function Home() {
  return (
    <>
      <Section variant="hero">
        <Hero />
      </Section>

      <Section variant="surface">
        <div className="site-section-head is-centered site-reveal">
          <p className="site-kicker">Diferenciais Savanti</p>
          <h2>Confiança industrial para escalar sua operação</h2>
        </div>
        <div className="site-feature-grid">
          {DIFFERENTIALS.map((item) => (
            <div key={item.title} className="site-reveal">
              <FeatureCard title={item.title} text={item.text} />
            </div>
          ))}
        </div>

        <div className="site-photo-strip site-reveal" aria-label="Vitrine de produtos Savanti">
          <img src="/imagens-produtos-site/tampa-flip-top-color.jpeg" alt="Tampa flip-top colorida" loading="lazy" />
          <img src="/imagens-produtos-site/tampa-flip-top-copia.jpeg" alt="Tampa flip-top Savanti" loading="lazy" />
          <img src="/imagens-produtos-site/frasco-whatsapp-2022.jpeg" alt="Frasco PET Savanti" loading="lazy" />
        </div>
      </Section>

      <Section variant="dark">
        <div className="site-section-head is-centered site-reveal">
          <p className="site-kicker">Soluções</p>
          <h2>Capacidade produtiva para diferentes demandas B2B</h2>
        </div>
        <div className="site-feature-grid">
          {SOLUTIONS.map((item) => (
            <div key={item.title} className="site-reveal">
              <FeatureCard title={item.title} text={item.text} />
            </div>
          ))}
        </div>
      </Section>

      <Section variant="surface">
        <div className="site-section-head is-centered site-reveal">
          <p className="site-kicker">Segmentos que atendemos</p>
          <h2>Aplicações de embalagem para diferentes mercados</h2>
        </div>
        <div className="site-segment-grid site-reveal">
          {SEGMENTS.map((segment) => (
            <article key={segment} className="site-segment-card">
              {segment}
            </article>
          ))}
        </div>
      </Section>

      <Section variant="dark">
        <div className="site-section-head is-centered site-reveal">
          <p className="site-kicker">Autoridade</p>
          <h2>Estrutura, experiência e suporte para projetos de alto nível</h2>
        </div>
        <div className="site-authority-grid">
          {AUTHORITY.map((item) => (
            <article key={item.value} className="site-authority-item site-reveal">
              <strong>{item.value}</strong>
              <p>{item.label}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section variant="cta">
        <div className="site-final-cta site-reveal">
          <p className="site-kicker">Fale com a Savanti</p>
          <h2>Precisa de embalagens PET ou serviços de injeção?</h2>
          <p>Vamos avaliar sua necessidade e montar a melhor estratégia de produção para sua empresa.</p>
          <NavLink to="/site/contato" className="site-btn site-btn-primary">
            Solicitar Orçamento
          </NavLink>
        </div>
      </Section>
    </>
  )
}
