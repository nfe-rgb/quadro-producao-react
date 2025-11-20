// src/components/Etiqueta.jsx
export default function Etiqueta({ o, variant = 'painel', saldoCaixas, lidasCaixas }) {
  if (!o) return null

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

  // ===== variante FILA =====
  if (variant === 'fila') {
    return (
      <div className={`small etiqueta-fila-flex ${isWeekendStop ? 'etiqueta-weekend' : ''}`}> 
        <div className="etiqueta-fila-main">
          {interrompida && <div className="badge-interrompida">⚠️ Produção Interrompida</div>}
          {o.code && <div><b>O.P:</b> {o.code}</div>}
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

  // ===== variante PAINEL =====
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
            <div className="pill-row">
              {typeof lidasCaixas === 'number' && (
                <span className="pill" title="Caixas já bipadas">
                  Lidas: <b>{lidasCaixas}</b>
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
