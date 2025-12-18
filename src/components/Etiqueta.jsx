// src/components/Etiqueta.jsx
import { useEffect, useState } from 'react'

export default function Etiqueta({ o, variant = 'painel', saldoCaixas, lidasCaixas }) {
  if (!o) return null

  const opCode = o.code || o.op_code || o.o?.code || o.ordem?.code

  const temObsLowEff = !!o.loweff_notes
  const interrompida = o.status === 'AGUARDANDO' && !!o.interrupted_at
  const isWeekendStop = o.status === 'PARADA' && o.reason === 'FIM DE SEMANA'
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('pt-BR') : '-')

  // classe para a pílula de saldo
  const saldoClass = (() => {
    if (typeof saldoCaixas !== 'number') return ''
    if (saldoCaixas === 0) return 'ok'     // concluído
    if (saldoCaixas <= 3) return 'warn'    // reta final
    return ''                              // neutro
  })()

  // Selo A/B local, persistido no navegador por ordem
  const cardKey = (() => {
    if (o.id) return `ord-${o.id}`
    if (opCode) return `op-${opCode}`
    return 'op-unknown'
  })()
  const [tagLetter, setTagLetter] = useState('A')
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`etq-letter-${cardKey}`)
      if (saved === 'A' || saved === 'B') setTagLetter(saved)
    } catch (_) {}
  }, [cardKey])
  const toggleLetter = () => {
    const next = tagLetter === 'A' ? 'B' : 'A'
    setTagLetter(next)
    try { window.localStorage.setItem(`etq-letter-${cardKey}`, next) } catch (_) {}
  }
  const tagColor = tagLetter === 'A' ? '#d7263d' : '#2b8a3e'

  // ===== variante FILA =====
  if (variant === 'fila') {
    return (
      <div className={`small etiqueta-fila-flex ${isWeekendStop ? 'etiqueta-weekend' : ''}`}>
        <div className="etiqueta-fila-main">
          {interrompida && <div className="badge-interrompida">⚠️ Produção Interrompida</div>}
          {opCode && <div><b>O.P:</b> {opCode}</div>}
          {o.customer && <div><b>Cliente:</b> {o.customer}</div>}
          {o.product && <div><b>Produto:</b> {o.product}</div>}
          {o.color && <div><b>Cor:</b> {o.color}</div>}
          {o.qty && <div><b>Qtd:</b> {o.qty}</div>}
          {o.boxes && <div><b>Volumes:</b> {o.boxes}</div>}
          {o.standard && <div><b>Padrão:</b> {o.standard}</div>}
          {o.due_date && <div><b>Prazo:</b> {fmtDate(o.due_date)}</div>}
          {temObsLowEff && <div><b>Baixa Eficiência:</b> {o.loweff_notes}</div>}
          {o.notes && <div className="muted">{o.notes}</div>}
        </div>
        {(typeof lidasCaixas === 'number' || typeof saldoCaixas === 'number') && (
          <div className="etiqueta-fila-side">
            {typeof lidasCaixas === 'number' && (
              <div className="etiqueta-fila-lidas">
                <span style={{fontWeight:'bold',fontSize:'1.2em'}}>Lidas:</span><br/>
                <span style={{fontWeight:'bold',fontSize:'2em'}}>{lidasCaixas}</span>
              </div>
            )}
            {typeof saldoCaixas === 'number' && (
              <div className={`etiqueta-fila-saldo ${saldoClass}`} style={{marginTop:12}}>
                <span style={{fontWeight:'bold',fontSize:'1.2em'}}>Saldo:</span><br/>
                <span style={{fontWeight:'bold',fontSize:'2em'}}>{saldoCaixas}</span>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

    // ===== variante pet01 =====
  if (variant === 'pet01') {
  return (
    <div className={`small ${isWeekendStop ? 'etiqueta-weekend' : ''}`}>
      {interrompida && <div className="badge-interrompida">⚠️ Produção Interrompida</div>}

      {o.customer && <div><b>Cliente:</b> {o.customer}</div>}
      {o.product && <div><b>Produto:</b> {o.product}</div>}
      {o.color && <div><b>Cor:</b> {o.color}</div>}
      {o.qty && <div><b>Qtd:</b> {o.qty}</div>}

      {o.boxes && (
        <>
          <div><b>Volumes:</b> {o.boxes}</div>
          {(typeof lidasCaixas === 'number' || typeof saldoCaixas === 'number') && (
            <div className="pet-pill-row">
              {typeof lidasCaixas === 'number' && (
                <span className="pet-pill" title="Caixas já bipadas">
                  Apontadas: <b>{lidasCaixas}</b>
                </span>
              )}
              {typeof saldoCaixas === 'number' && (
                <span className={`pet-pill ${saldoClass}`} title={`Faltam ${saldoCaixas} caixas`}>
                  Saldo: <b>{saldoCaixas}</b>
                </span>
              )}
            </div>
          )}
        </>
      )}

      {o.standard && <div><b>Padrão:</b> {o.standard}</div>}
      {o.due_date && <div><b>Prazo:</b> {fmtDate(o.due_date)}</div>}

      {temObsLowEff && <div><b>Baixa Eficiência:</b> {o.loweff_notes}</div>}
      {o.notes && <div className="muted">{o.notes}</div>}
    </div>
   )
  }

  // ===== variante PAINEL =====
  return (
    <div className={`small ${isWeekendStop ? 'etiqueta-weekend' : ''}`} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={toggleLetter}
        title="Alternar selo A/B"
        className={`etq-ab-badge ${tagLetter === 'A' ? 'ab-a' : 'ab-b'}`}
      >
        {tagLetter}
      </button>

      {interrompida && <div className="badge-interrompida">⚠️ Produção Interrompida</div>}
 
      {o.customer && <div><b>Cliente:</b> {o.customer}</div>}
      {o.product && <div><b>Produto:</b> {o.product}</div>}
      {o.color && <div><b>Cor:</b> {o.color}</div>}
      {o.qty && <div><b>Qtd:</b> {o.qty}</div>}

      {o.boxes && (
        <>
          <div><b>Volumes:</b> {o.boxes}</div>
          {(typeof lidasCaixas === 'number' || typeof saldoCaixas === 'number') && (
            <div className="pill-row">
              {typeof lidasCaixas === 'number' && (
                <span className="pill" title="Caixas já bipadas">
                  Apontadas: <b>{lidasCaixas}</b>
                </span>
              )}
              {typeof saldoCaixas === 'number' && (
                <span className={`pill ${saldoClass}`} title={`Faltam ${saldoCaixas} caixas`}>
                  Saldo: <b>{saldoCaixas}</b>
                </span>
              )}
            </div>
          )}
        </>
      )}

      {o.standard && <div><b>Padrão:</b> {o.standard}</div>}
      {o.due_date && <div><b>Prazo:</b> {fmtDate(o.due_date)}</div>}

      {temObsLowEff && <div><b>Baixa Eficiência:</b> {o.loweff_notes}</div>}
      {o.notes && <div className="muted">{o.notes}</div>}
    </div>
  )
}
