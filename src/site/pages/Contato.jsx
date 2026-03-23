import React, { useState } from 'react'
import Section from '../components/Section'

export default function Contato() {
  const [form, setForm] = useState({
    nome: '',
    empresa: '',
    telefone: '',
    email: '',
    mensagem: '',
  })

  function onChange(event) {
    const { name, value } = event.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  function onSubmit(event) {
    event.preventDefault()
    const subject = encodeURIComponent(`Contato Comercial - ${form.empresa || form.nome || 'Site Savanti'}`)
    const body = encodeURIComponent(
      `Nome: ${form.nome}\nEmpresa: ${form.empresa}\nTelefone: ${form.telefone}\nEmail: ${form.email}\n\nMensagem:\n${form.mensagem}`
    )
    window.location.href = `mailto:comercial@savantiplasticos.com.br?subject=${subject}&body=${body}`
  }

  return (
    <Section variant="surface">
      <div className="site-contact-layout">
        <div className="site-contact-panel">
          <p className="site-kicker">Contato</p>
          <h1>Solicite contato com nosso time comercial</h1>
          <p>
            Compartilhe sua necessidade e vamos construir uma proposta alinhada a prazo, qualidade e capacidade
            produtiva.
          </p>

          <ul className="site-contact-info">
            <li>Email: comercial@savantiplasticos.com.br</li>
            <li>Telefone: (47) 3305-1812</li>
            <li>WhatsApp: (47) 98803-0670</li>
            <li>Endereco: Florentina Pereira Jasper, 187 Galpao B | Porto Grande Araquari | SC</li>
          </ul>
        </div>

        <form className="site-form" onSubmit={onSubmit}>
          <label>
            Nome
            <input name="nome" value={form.nome} onChange={onChange} required />
          </label>
          <label>
            Empresa
            <input name="empresa" value={form.empresa} onChange={onChange} required />
          </label>
          <label>
            Telefone
            <input name="telefone" value={form.telefone} onChange={onChange} required />
          </label>
          <label>
            Email
            <input type="email" name="email" value={form.email} onChange={onChange} required />
          </label>
          <label>
            Mensagem
            <textarea name="mensagem" value={form.mensagem} onChange={onChange} rows={5} required />
          </label>

          <button type="submit" className="site-btn site-btn-primary">
            Solicitar Contato
          </button>
        </form>
      </div>
    </Section>
  )
}
