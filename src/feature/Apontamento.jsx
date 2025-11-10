// src/components/Etiqueta.jsx
export default function Etiqueta({ o, variant = 'painel' }) {
  if (!o) return null
  const temObsLowEff = !!o.loweff_notes
  const interrompida = o.status === 'AGUARDANDO' && !!o.interrupted_at

  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('pt-BR') : '-')

  if (variant === 'fila') {
    // Etiqueta compacta para a FILA (com O.P e aviso de interrupção)
    return (
      <div className="small">
        {interrompida && <div className="badge-interrompida">⚠️ Produção Interrompida</div>}

        {o.code && <div><b>O.P:</b> {o.code}</div>}
        {o.customer && <div><b>Cliente:</b> {o.customer}</div>}
        {o.product && <div><b>Produto:</b> {o.product}</div>}
        {o.color && <div><b>Cor:</b> {o.color}</div>}
        {o.qty && <div><b>Qtd:</b> {o.qty}</div>}
        {o.boxes && <div><b>Caixas:</b> {o.boxes}</div>}
        {o.standard && <div><b>Padrão:</b> {o.standard}</div>}
        {o.due_date && <div><b>Prazo:</b> {fmtDate(o.due_date)}</div>}
        {temObsLowEff && <div><b>Baixa Eficiência:</b> {o.loweff_notes}</div>}
        {o.notes && <div className="muted">{o.notes}</div>}
      </div>
    )
  }

  // variant === 'painel'
  return (
    <div className="small">
      {interrompida && <div className="badge-interrompida">⚠️ Produção Interrompida</div>}

      {o.customer && <div><b>Cliente:</b> {o.customer}</div>}
      {o.product && <div><b>Produto:</b> {o.product}</div>}
      {o.color && <div><b>Cor:</b> {o.color}</div>}
      {o.qty && <div><b>Qtd:</b> {o.qty}</div>}
      {o.boxes && <div><b>Caixas:</b> {o.boxes}</div>}
      {o.standard && <div><b>Padrão:</b> {o.standard}</div>}
      {o.due_date && <div><b>Prazo:</b> {fmtDate(o.due_date)}</div>}

      {temObsLowEff && <div><b>Baixa Eficiência:</b> {o.loweff_notes}</div>}
      {o.notes && <div className="muted">{o.notes}</div>}
    </div>
  )
}