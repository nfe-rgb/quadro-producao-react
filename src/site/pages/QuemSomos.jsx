import React from 'react'
import Section from '../components/Section'
import FeatureCard from '../components/FeatureCard'

export default function QuemSomos() {
  return (
    <>
      <Section variant="surface">
        <div className="site-page-head">
          <p className="site-kicker">Quem Somos</p>
          <h1>Sobre a Savanti Plásticos</h1>
          <p>
            A Savanti Plásticos tem como objetivo atender as necessidades do mercado com soluções inteligentes e
            inovadoras para o segmento de tampas plásticas, frascos PET e terceirização de serviços de injeção.
          </p>
          <p>
            A empresa se destaca pelo atendimento diferenciado, qualidade nos produtos e agilidade na entrega,
            construindo relações duradouras com clientes em todo o Brasil.
          </p>
        </div>
      </Section>

      <Section variant="dark">
        <div className="site-section-head">
          <p className="site-kicker">Suporte</p>
          <h2>Assistência técnica em toda a jornada do produto</h2>
        </div>
        <div className="site-feature-grid">
          <FeatureCard
            title="Atendimento Nacional"
            text="Nosso atendimento abrange todo o território nacional, com acompanhamento técnico e comercial de ponta a ponta."
          />
          <FeatureCard
            title="Evolução de Processos"
            text="Analisamos eventuais falhas nos processos produtivos e propomos melhorias contínuas para aumentar desempenho e estabilidade."
          />
          <FeatureCard
            title="Suporte Técnico"
            text="Profissionais com know how no desenvolvimento de produtos e moldes, combinando inovação, habilidade e eficiência."
          />
        </div>
      </Section>
    </>
  )
}
