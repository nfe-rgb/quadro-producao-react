import React from 'react'
import Section from '../components/Section'
import FeatureCard from '../components/FeatureCard'

const BENEFITS = [
  {
    title: 'Aumento da capacidade produtiva',
    text: 'Escalone sua operação com apoio da estrutura Savanti, mantendo qualidade e previsibilidade de entrega.',
  },
  {
    title: 'Redução de investimento em máquinas',
    text: 'Terceirize a injeção plástica para reduzir CAPEX e direcionar recursos para expansão comercial.',
  },
  {
    title: 'Suporte técnico especializado',
    text: 'Equipe experiente para otimizar desenvolvimento de peças, processos e performance de moldes.',
  },
]

export default function Servicos() {
  return (
    <>
      <Section variant="surface">
        <div className="site-page-head">
          <p className="site-kicker">Serviços</p>
          <h1>Terceirização de Injeção</h1>
          <p>
            A Savanti reserva equipamentos para injeção de produtos para empresas parceiras, ampliando capacidade
            produtiva com segurança e qualidade industrial.
          </p>
        </div>
      </Section>

      <Section variant="dark">
        <div className="site-feature-grid">
          {BENEFITS.map((item) => (
            <FeatureCard key={item.title} title={item.title} text={item.text} />
          ))}
        </div>
      </Section>
    </>
  )
}
