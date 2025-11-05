// src/components/Etiqueta.jsx
export default function Etiqueta({ o }) {
  return (
    <div className="small">
      {o.customer && <div><b>Cliente:</b> {o.customer}</div>}
      {o.product && <div><b>Produto:</b> {o.product}</div>}
      {o.color && <div><b>Cor:</b> {o.color}</div>}
      {o.qty && <div><b>Qtd:</b> {o.qty}</div>}
      {o.boxes && <div><b>Caixas:</b> {o.boxes}</div>}
      {o.standard && <div><b>Padrão:</b> {o.standard}</div>}
      {o.due_date && (
        <div>
          <b>Prazo:</b> {new Date(o.due_date).toLocaleDateString('pt-BR')}
        </div>
      )}
      {o.notes && <div className="muted">{o.notes}</div>}
    </div>
  );
}
