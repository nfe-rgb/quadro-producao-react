// src/components/Etiqueta.jsx

export default function Etiqueta({ o, variant = 'painel', lidasCaixas, lidasPecas, compactPills = false }) {
  if (!o) return null

  const opCode = o.code || o.op_code || o.o?.code || o.ordem?.code
  const customer = o.customer || o.cliente || o.customer_name || o.client || ''

  const temObsLowEff = !!o.loweff_notes
  const interrompida = o.status === 'AGUARDANDO' && !!o.interrupted_at
  const isProgrammedStop = o.status === 'PARADA' && ['FIM DE SEMANA', 'PARADA PROGRAMADA'].includes(o.reason)
  const weekendClass = isProgrammedStop && variant !== 'painel' ? 'etiqueta-weekend' : ''
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('pt-BR') : '-')
  const fmtThousands = (v) => {
    if (v === null || v === undefined || v === '') return v
    if (typeof v === 'number' && Number.isFinite(v)) return v.toLocaleString('pt-BR')

    const parsed = Number(String(v).replace(/\./g, '').replace(',', '.'))
    return Number.isFinite(parsed) ? parsed.toLocaleString('pt-BR') : v
  }

  const parseNumber = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (v === null || v === undefined || v === '') return NaN
    const parsed = Number(String(v).replace(/\./g, '').replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : NaN
  }

  const parsePiecesPerBox = (val) => {
    if (val == null) return 0
    const digits = String(val).replace(/[^0-9]/g, '')
    return digits ? Number(digits) : 0
  }

  const totalQty = parseNumber(o.qty)
  const piecesPerBox = parsePiecesPerBox(o.standard)
  const effectiveLidasCaixas = typeof lidasCaixas === 'number'
    ? lidasCaixas
    : Number.isFinite(Number(o?.scanned_count || 0))
      ? Number(o.scanned_count || 0)
      : undefined
  const effectiveLidasPecas = typeof lidasPecas === 'number' && Number.isFinite(lidasPecas) && lidasPecas > 0
    ? lidasPecas
    : Number.isFinite(Number(o?.apontadas_pieces || 0)) && Number(o.apontadas_pieces || 0) > 0
      ? Number(o.apontadas_pieces)
      : undefined
  const lidasPiecesFromBoxes = (typeof effectiveLidasCaixas === 'number' && piecesPerBox > 0)
    ? effectiveLidasCaixas * piecesPerBox
    : undefined
  const lidasPieces = effectiveLidasPecas != null
    ? effectiveLidasPecas
    : lidasPiecesFromBoxes

  const numericLidasPieces = (typeof lidasPieces === 'number' && Number.isFinite(lidasPieces))
    ? Math.max(0, lidasPieces)
    : 0
  const hasProgress = totalQty > 0
  const progressPercent = hasProgress
    ? Math.round(Math.min(100, Math.max(0, (numericLidasPieces / totalQty) * 100)))
    : 0
  const displayLidas = hasProgress
    ? numericLidasPieces
    : typeof lidasCaixas === 'number' ? lidasCaixas : undefined

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
          {o.qty && (
            <div className="etiqueta-qty">
              <b>Qtd:</b>{' '}
              {displayLidas != null
                ? `${fmtThousands(displayLidas)}/${fmtThousands(o.qty)}`
                : fmtThousands(o.qty)}
            </div>
          )}
          {hasProgress && (
            <div className="etiqueta-progress">
              <div className="etiqueta-progress-track">
                <div
                  className="etiqueta-progress-fill"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <small>{progressPercent}%</small>
            </div>
          )}
          {o.boxes && <div><b>Volumes:</b> {o.boxes}</div>}
          {o.standard && <div><b>Padrão:</b> {fmtThousands(o.standard)}</div>}
          {o.due_date && <div><b>Prazo:</b> {fmtDate(o.due_date)}</div>}
          {temObsLowEff && <div><b>Baixa Eficiência:</b> {o.loweff_notes}</div>}
          {o.notes && <div className="muted">{o.notes}</div>}
        </div>
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
      {o.qty && (
        <div className="etiqueta-qty">
          <b>Qtd:</b>{' '}
          {displayLidas != null
            ? `${fmtThousands(displayLidas)}/${fmtThousands(o.qty)}`
            : fmtThousands(o.qty)}
        </div>
      )}
      {hasProgress && (
        <div className="etiqueta-progress">
          <div className="etiqueta-progress-track">
            <div
              className="etiqueta-progress-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <small>{progressPercent}%</small>
        </div>
      )}

      {o.boxes && (
        <>
          <div><b>Volumes:</b> {o.boxes}</div>
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
      className={`small ${weekendClass} ${compactPills ? 'compact-pills-layout' : ''}`}
      style={{ position: 'relative' }}
    >
      {interrompida && <div className="badge-interrompida">⚠️ Produção Interrompida</div>}
 
      {customer && <div><b>Cliente:</b> {customer}</div>}
      {o.product && <div><b>Produto:</b> {o.product}</div>}
      {o.color && <div><b>Cor:</b> {o.color}</div>}
      {o.qty && (
        <div className="etiqueta-qty">
          <b>Qtd:</b>{' '}
          {displayLidas != null
            ? `${fmtThousands(displayLidas)}/${fmtThousands(o.qty)}`
            : fmtThousands(o.qty)}
        </div>
      )}
      {hasProgress && (
        <div className="etiqueta-progress">
          <div className="etiqueta-progress-track">
            <div
              className="etiqueta-progress-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <small>{progressPercent}%</small>
        </div>
      )}

      {o.boxes && (
        <>
          <div><b>Volumes:</b> {o.boxes}</div>
        </>
      )}

      {o.standard && <div><b>Padrão:</b> {fmtThousands(o.standard)}</div>}
      {o.due_date && <div><b>Prazo:</b> {fmtDate(o.due_date)}</div>}

      {temObsLowEff && <div><b>Baixa Eficiência:</b> {o.loweff_notes}</div>}
      {o.notes && <div className="muted">{o.notes}</div>}
    </div>
  )
}
