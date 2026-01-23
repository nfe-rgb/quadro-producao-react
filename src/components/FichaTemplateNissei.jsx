// src/components/FichaTemplateNissei.jsx
// Formulário estruturado que espelha o layout da ficha técnica fornecida.
// Em vez de gerar texto concatenado, envia o objeto estruturado via callback.

import { useEffect, useMemo, useRef, useState } from 'react'

const leftTempPoints = [
  'Canhão Bico', 'Canhão Frente', 'Canhão Meio', 'Canhão Atrás', 'Óleo',
  'HR Zona 1', 'HR Zona 2', 'HR Zona 3', 'HR Zona 4', 'HR Zona 5',
  'BICO 1', 'BICO 2', 'BICO 3', 'BICO 4', 'BICO 5',
]

const rightTempPoints = Array.from({ length: 12 }, (_, i) => `Pote Zona ${i + 1}`)

const moldeRows = [
  { injecao: 'Injeção', sopro: 'Sopro', cond: 'Subida Pote', opc: 'Detetor de Rebarba' },
  { injecao: 'Resfriamento', sopro: 'Sopro Primário', cond: 'Início Subida Pote', opc: 'Sensor Molde Sopro' },
  { injecao: 'Início da Injeção', sopro: 'Sopro Secundário', cond: 'Descida Macho Condicionamento', opc: 'Gargalo' },
  { injecao: 'Início fechamento do bico', sopro: 'Desc. Ar de Sopro', cond: 'Início Macho Condicionamento', opc: 'Curso Curto' },
  { injecao: 'Sucção', sopro: 'Subida Estiramento', cond: 'Contador Pré-forma', opc: 'Sel. Fundo Molde Sopro' },
  { injecao: '', sopro: 'Descida Estiramento', cond: 'Temp. Macho Condic. (Set)', opc: 'Retardo Fundo Molde Sopro' },
  { injecao: '', sopro: 'Subida Fundo Molde', cond: 'Temp Macho Condicionamento (Atual)', opc: 'SPARE 03' },
  { injecao: '', sopro: 'Descida Fundo Molde', cond: 'COOLING BLOW', opc: 'Econ. Energia' },
  { injecao: '', sopro: 'Pressão Sopro primário', cond: '', opc: '' },
  { injecao: '', sopro: 'Anel Válvula Sopro primário', cond: '', opc: '' },
]

export default function FichaTemplateNissei({ onGenerate, initialItemCode, prefill, initialData }) {
  const [cabecalho, setCabecalho] = useState({
    molde: '',
    codItem: initialItemCode || '',
    pesoProduto: '',
    tempoCiclo: '',
    numCavidades: '',
    checadoPor: '',
  })

  const [cliente, setCliente] = useState({
    material: '',
    corPigmento: '',
    tempoDosagem: '',
    velocidadeDosagem: '',
    aplicacao: '',
  })

  const [suprimentoAgua, setSuprimentoAgua] = useState({ tempAgua: '' })
  const [pneumatica, setPneumatica] = useState({ arSopro: '', arOperacao: '' })
  const [controleInjecao, setControleInjecao] = useState({
    pressaoInjecao: '',
    pressaoRecalque: '',
    contrapressao: '',
    velocidadeInjecao: '',
  })
  const [posicaoInjecao, setPosicaoInjecao] = useState({ carga: '', recalque: '' })

  const [tempsLeft, setTempsLeft] = useState(() => leftTempPoints.map((p) => ({ label: p, pv: '' })))
  const [tempsRight, setTempsRight] = useState(() => rightTempPoints.map((p) => ({ label: p, pv: '' })))

  const [observacoes, setObservacoes] = useState('')

  const [moldeValores, setMoldeValores] = useState(
    moldeRows.map((r) => ({ ...r, injValor: '', soproVal: '', condVal: '', opcVal: '' }))
  )

  // Evita reprocessar initialData quando nada mudou de fato (impede loops com objetos novos mas iguais)
  const initialDataKey = useMemo(() => JSON.stringify(initialData || {}), [initialData])
  const prevInitialDataKey = useRef(null)

  // Evita setState em loop quando o objeto prefill muda de referência mas não de conteúdo
  const prefillKey = useMemo(() => JSON.stringify(prefill || {}), [prefill])
  const prevPrefillKey = useRef(null)

  // Prefill com dados do item, sem impedir edição manual
  useEffect(() => {
    if (!prefill) return
    if (prefillKey === prevPrefillKey.current) return
    prevPrefillKey.current = prefillKey
    setCabecalho((prev) => ({
      ...prev,
      codItem: prefill.codItem ?? prev.codItem,
      molde: prev.molde || prefill.molde || '',
      pesoProduto: prev.pesoProduto || prefill.pesoProduto || '',
      tempoCiclo: prev.tempoCiclo || prefill.tempoCiclo || '',
      numCavidades: prev.numCavidades || prefill.numCavidades || '',
    }))
    setCliente((prev) => ({
      ...prev,
      material: prev.material || prefill.material || '',
      corPigmento: prev.corPigmento || prefill.corPigmento || '',
    }))
  }, [prefill, prefillKey])

  // Prefill completo para modo edição (usa dados atuais da ficha)
  useEffect(() => {
    if (!initialData) return
    if (initialDataKey === prevInitialDataKey.current) return
    prevInitialDataKey.current = initialDataKey
    setCabecalho({
      molde: initialData.cabecalho?.molde || '',
      codItem: initialData.cabecalho?.codItem || initialItemCode || '',
      pesoProduto: initialData.cabecalho?.pesoProduto || '',
      tempoCiclo: initialData.cabecalho?.tempoCiclo || '',
      numCavidades: initialData.cabecalho?.numCavidades || '',
      checadoPor: initialData.cabecalho?.checadoPor || '',
    })
    setCliente({
      material: initialData.cliente?.material || '',
      corPigmento: initialData.cliente?.corPigmento || '',
      tempoDosagem: initialData.cliente?.tempoDosagem || '',
      velocidadeDosagem: initialData.cliente?.velocidadeDosagem || '',
      aplicacao: initialData.cliente?.aplicacao || '',
    })
    setSuprimentoAgua({ tempAgua: initialData.suprimentoAgua?.tempAgua || '' })
    setPneumatica({
      arSopro: initialData.pneumatica?.arSopro || '',
      arOperacao: initialData.pneumatica?.arOperacao || '',
    })
    setControleInjecao({
      pressaoInjecao: initialData.controleInjecao?.pressaoInjecao || '',
      pressaoRecalque: initialData.controleInjecao?.pressaoRecalque || '',
      contrapressao: initialData.controleInjecao?.contrapressao || '',
      velocidadeInjecao: initialData.controleInjecao?.velocidadeInjecao || '',
    })
    setPosicaoInjecao({
      carga: initialData.posicaoInjecao?.carga || '',
      recalque: initialData.posicaoInjecao?.recalque || '',
    })

    const mapTemps = (basePoints, arr = []) => basePoints.map((label) => {
      const found = (arr || []).find((t) => t.label === label)
      return { label, pv: found?.pv || '' }
    })
    setTempsLeft(mapTemps(leftTempPoints, initialData.tempsLeft))
    setTempsRight(mapTemps(rightTempPoints, initialData.tempsRight))

    setMoldeValores(moldeRows.map((r, idx) => ({
      ...r,
      injValor: initialData.moldeValores?.[idx]?.injValor || '',
      soproVal: initialData.moldeValores?.[idx]?.soproVal || '',
      condVal: initialData.moldeValores?.[idx]?.condVal || '',
      opcVal: initialData.moldeValores?.[idx]?.opcVal || '',
    })))

    setObservacoes(initialData.observacoes || '')
  }, [initialData, initialDataKey, initialItemCode])

  function buildStructured() {
    return {
      cabecalho,
      cliente,
      suprimentoAgua,
      pneumatica,
      controleInjecao,
      posicaoInjecao,
      tempsLeft,
      tempsRight,
      moldeValores,
      observacoes,
    }
  }

  // Envia objeto estruturado automaticamente sempre que mudar
  const lastEmit = useRef(null)
  useEffect(() => {
    const payload = buildStructured()
    const key = JSON.stringify(payload)
    if (key === lastEmit.current) return
    lastEmit.current = key
    if (typeof onGenerate === 'function') onGenerate(payload)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabecalho, cliente, suprimentoAgua, pneumatica, controleInjecao, posicaoInjecao, tempsLeft, tempsRight, moldeValores, observacoes])

  const updateTempLeft = (idx, pv) => {
    setTempsLeft((prev) => prev.map((t, i) => (i === idx ? { ...t, pv } : t)))
  }
  const updateTempRight = (idx, pv) => {
    setTempsRight((prev) => prev.map((t, i) => (i === idx ? { ...t, pv } : t)))
  }
  const updateMolde = (idx, key, value) => {
    setMoldeValores((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)))
  }

  return (
    <div className="ficha-template">
      <div className="ficha-template-header">
        <h3>Preencher ficha (modelo Nissei)</h3>
      </div>

      <div className="ficha-grid">
        <label>Molde</label>
        <input value={cabecalho.molde} onChange={(e) => setCabecalho((v) => ({ ...v, molde: e.target.value }))} />

        <label>Cod. Item</label>
        <input value={cabecalho.codItem} onChange={(e) => setCabecalho((v) => ({ ...v, codItem: e.target.value }))} />

        <label>Material utilizado</label>
        <input value={cliente.material} onChange={(e) => setCliente((v) => ({ ...v, material: e.target.value }))} />

        <label>Peso do Produto</label>
        <input value={cabecalho.pesoProduto} onChange={(e) => setCabecalho((v) => ({ ...v, pesoProduto: e.target.value }))} />

        <label>Tempo de Ciclo</label>
        <input value={cabecalho.tempoCiclo} onChange={(e) => setCabecalho((v) => ({ ...v, tempoCiclo: e.target.value }))} />

        <label>Número de Cavidades</label>
        <input value={cabecalho.numCavidades} onChange={(e) => setCabecalho((v) => ({ ...v, numCavidades: e.target.value }))} />

        <label>Checado por</label>
        <input value={cabecalho.checadoPor} onChange={(e) => setCabecalho((v) => ({ ...v, checadoPor: e.target.value }))} />
      </div>

      <div className="ficha-grid ficha-grid-2cols" style={{ marginTop: 10 }}>
        <div>
          <h4>Cliente / Motivo</h4>
          <label>Cor / Pigmento</label>
          <input value={cliente.corPigmento} onChange={(e) => setCliente((v) => ({ ...v, corPigmento: e.target.value }))} />
          <label>Tempo dosagem pigmento</label>
          <input value={cliente.tempoDosagem} onChange={(e) => setCliente((v) => ({ ...v, tempoDosagem: e.target.value }))} />
          <label>Velocidade dosagem (RPM)</label>
          <input value={cliente.velocidadeDosagem} onChange={(e) => setCliente((v) => ({ ...v, velocidadeDosagem: e.target.value }))} />
          <label>% de aplicação</label>
          <input value={cliente.aplicacao} onChange={(e) => setCliente((v) => ({ ...v, aplicacao: e.target.value }))} />
        </div>
        <div>
          <h4>Suprimento / Pneumática</h4>
          <label>Temp. Água Gelada (°C)</label>
          <input value={suprimentoAgua.tempAgua} onChange={(e) => setSuprimentoAgua({ tempAgua: e.target.value })} />
          <label>Pressão ar de Sopro (Kgf/cm2)</label>
          <input value={pneumatica.arSopro} onChange={(e) => setPneumatica((v) => ({ ...v, arSopro: e.target.value }))} />
          <label>Pressão ar Operação (Kgf/cm2)</label>
          <input value={pneumatica.arOperacao} onChange={(e) => setPneumatica((v) => ({ ...v, arOperacao: e.target.value }))} />
        </div>
      </div>

      <div className="ficha-grid ficha-grid-2cols" style={{ marginTop: 10 }}>
        <div>
          <h4>Controle Injeção</h4>
          <label>Pressão Injeção (Kgf/cm2)</label>
          <input value={controleInjecao.pressaoInjecao} onChange={(e) => setControleInjecao((v) => ({ ...v, pressaoInjecao: e.target.value }))} />
          <label>Pressão Recalque (Kgf/cm2)</label>
          <input value={controleInjecao.pressaoRecalque} onChange={(e) => setControleInjecao((v) => ({ ...v, pressaoRecalque: e.target.value }))} />
          <label>Contrapressão (Kgf/cm2)</label>
          <input value={controleInjecao.contrapressao} onChange={(e) => setControleInjecao((v) => ({ ...v, contrapressao: e.target.value }))} />
          <label>Velocidade Injeção</label>
          <input value={controleInjecao.velocidadeInjecao} onChange={(e) => setControleInjecao((v) => ({ ...v, velocidadeInjecao: e.target.value }))} />
        </div>
        <div>
          <h4>Posição Injeção</h4>
          <label>Carga (mm)</label>
          <input value={posicaoInjecao.carga} onChange={(e) => setPosicaoInjecao((v) => ({ ...v, carga: e.target.value }))} />
          <label>Recalque (mm)</label>
          <input value={posicaoInjecao.recalque} onChange={(e) => setPosicaoInjecao((v) => ({ ...v, recalque: e.target.value }))} />
        </div>
      </div>

      <div className="ficha-grid ficha-grid-2cols" style={{ marginTop: 10 }}>
        <div>
          <h4>Dados Ajuste Temperatura (Lado A)</h4>
          {tempsLeft.map((t, i) => (
            <div key={t.label} className="ficha-row-inline">
              <span>{t.label}</span>
              <input value={t.pv} onChange={(e) => updateTempLeft(i, e.target.value)} style={{ width: 90 }} placeholder="PV (°C)" />
            </div>
          ))}
        </div>
        <div>
          <h4>Dados Ajuste Temperatura (Lado B)</h4>
          {tempsRight.map((t, i) => (
            <div key={t.label} className="ficha-row-inline">
              <span>{t.label}</span>
              <input value={t.pv} onChange={(e) => updateTempRight(i, e.target.value)} style={{ width: 90 }} placeholder="PV (°C)" />
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <h4>Dados do Molde</h4>
        <div className="ficha-molde-grid">
          <div className="ficha-molde-header">
            <span>Injeção (Seg.)</span>
            <span>Sopro (Seg.)</span>
            <span>Condicionamento</span>
            <span>Opcional</span>
          </div>
          {moldeValores.map((row, idx) => {
            const base = moldeRows[idx]
            return (
              <div key={`molde-${idx}`} className="ficha-molde-row">
                <div>
                  {base.injecao || row.injValor ? (
                    <>
                      <div className="muted">{base.injecao}</div>
                      <input value={row.injValor} onChange={(e) => updateMolde(idx, 'injValor', e.target.value)} placeholder="Seg." />
                    </>
                  ) : (
                    <div aria-hidden="true" style={{ minHeight: 48 }} />
                  )}
                </div>
                <div>
                  {base.sopro || row.soproVal ? (
                    <>
                      <div className="muted">{base.sopro}</div>
                      <input value={row.soproVal} onChange={(e) => updateMolde(idx, 'soproVal', e.target.value)} placeholder="Seg." />
                    </>
                  ) : (
                    <div aria-hidden="true" style={{ minHeight: 48 }} />
                  )}
                </div>
                <div>
                  {base.cond || row.condVal ? (
                    <>
                      <div className="muted">{base.cond}</div>
                      <input value={row.condVal} onChange={(e) => updateMolde(idx, 'condVal', e.target.value)} placeholder="Valor" />
                    </>
                  ) : (
                    <div aria-hidden="true" style={{ minHeight: 48 }} />
                  )}
                </div>
                <div>
                  {base.opc || row.opcVal ? (
                    <>
                      <div className="muted">{base.opc}</div>
                      <input value={row.opcVal} onChange={(e) => updateMolde(idx, 'opcVal', e.target.value)} placeholder="Valor" />
                    </>
                  ) : (
                    <div aria-hidden="true" style={{ minHeight: 48 }} />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <h4>Observações</h4>
        <textarea rows={3} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} placeholder="Observações técnicas" />
      </div>
    </div>
  )
}
