// src/components/Etiqueta.jsx

export default function Etiqueta({ o, variant = 'painel', saldoCaixas, lidasCaixas, compactPills = false }) {
  if (!o) return null

  const opCode = o.code || o.op_code || o.o?.code || o.ordem?.code
  const customer = o.customer || o.cliente || o.customer_name || o.client || ''

  const temObsLowEff = !!o.loweff_notes
  const interrompida = o.status === 'AGUARDANDO' && !!o.interrupted_at
  const isProgrammedStop = o.status === 'PARADA' && ['FIM DE SEMANA', 'PARADA PROGRAMADA'].includes(o.reason)
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('pt-BR') : '-')
  const fmtThousands = (v) => {
    if (v === null || v === undefined || v === '') return v
    if (typeof v === 'number' && Number.isFinite(v)) return v.toLocaleString('pt-BR')

    const parsed = Number(String(v).replace(/\./g, '').replace(',', '.'))
    return Number.isFinite(parsed) ? parsed.toLocaleString('pt-BR') : v
  }

  // classe para a pílula de saldo
  const saldoClass = (() => {
    if (typeof saldoCaixas !== 'number') return ''
    if (saldoCaixas === 0) return 'ok'     // concluído
    if (saldoCaixas <= 3) return 'warn'    // reta final
    return ''                              // neutro
  })()

  // ===== variante FILA =====
  if (variant === 'fila') {
    return (
      <div className={`small etiqueta-fila-flex ${isProgrammedStop ? 'etiqueta-weekend' : ''}`}>
        <div className="etiqueta-fila-main">
          {interrompida && <div className="badge-interrompida">⚠️ Produção Interrompida</div>}
          {opCode && <div><b>O.P:</b> {opCode}</div>}
          {customer && <div><b>Cliente:</b> {customer}</div>}
          {o.product && <div><b>Produto:</b> {o.product}</div>}
          {o.color && <div><b>Cor:</b> {o.color}</div>}
          {o.qty && <div><b>Qtd:</b> {fmtThousands(o.qty)}</div>}
          {o.boxes && <div><b>Volumes:</b> {o.boxes}</div>}
          {o.standard && <div><b>Padrão:</b> {fmtThousands(o.standard)}</div>}
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
    <div className={`small ${isProgrammedStop ? 'etiqueta-weekend' : ''}`}>
      {interrompida && <div className="badge-interrompida">⚠️ Produção Interrompida</div>}

      {customer && <div><b>Cliente:</b> {customer}</div>}
      {o.product && <div><b>Produto:</b> {o.product}</div>}
      {o.color && <div><b>Cor:</b> {o.color}</div>}
      {o.qty && <div><b>Qtd:</b> {fmtThousands(o.qty)}</div>}

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

      {o.standard && <div><b>Padrão:</b> {fmtThousands(o.standard)}</div>}
      {o.due_date && <div><b>Prazo:</b> {fmtDate(o.due_date)}</div>}

      {temObsLowEff && <div><b>Baixa Eficiência:</b> {o.loweff_notes}</div>}
      {o.notes && <div className="muted">{o.notes}</div>}
    </div>
   )
  }

  // ===== variante PAINEL =====
  return (
    <div
      className={`small ${isProgrammedStop ? 'etiqueta-weekend' : ''} ${compactPills ? 'compact-pills-layout' : ''}`}
      style={{ position: 'relative' }}
    >
      {interrompida && <div className="badge-interrompida">⚠️ Produção Interrompida</div>}
 
      {customer && <div><b>Cliente:</b> {customer}</div>}
      {o.product && <div><b>Produto:</b> {o.product}</div>}
      {o.color && <div><b>Cor:</b> {o.color}</div>}
      {o.qty && <div><b>Qtd:</b> {fmtThousands(o.qty)}</div>}

      {o.boxes && (
        <>
          <div><b>Volumes:</b> {o.boxes}</div>
          {(typeof lidasCaixas === 'number' || typeof saldoCaixas === 'number') && (
            <div className={`pill-row ${compactPills ? 'compact-inside' : ''}`}>
              {typeof lidasCaixas === 'number' && (
                <span className={`pill ${compactPills ? 'compact-pill' : ''}`} title="Caixas já bipadas">
                  Apontadas: <b>{lidasCaixas}</b>
                </span>
              )}
              {typeof saldoCaixas === 'number' && (
                <span className={`pill ${saldoClass} ${compactPills ? 'compact-pill' : ''}`} title={`Faltam ${saldoCaixas} caixas`}>
                  Saldo: <b>{saldoCaixas}</b>
                </span>
              )}
            </div>
          )}
        </>
      )}

      {o.standard && <div><b>Padrão:</b> {fmtThousands(o.standard)}</div>}
      {o.due_date && <div><b>Prazo:</b> {fmtDate(o.due_date)}</div>}

      {temObsLowEff && <div><b>Baixa Eficiência:</b> {o.loweff_notes}</div>}
      {o.notes && <div className="muted">{o.notes}</div>}
    </div>
  )
}
