// src/components/FilaSortableItem.jsx
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Etiqueta from './Etiqueta'

export default function FilaSortableItem({
  ordem,
  onEdit,
  etiquetaVariant = 'fila',
  // 🔶 nova prop para pintar amarelo quando for produção interrompida
  highlightInterrompida = false,
  canReorder = true,
  canEdit = true,
}) {
  const sortable = useSortable({ id: ordem.id })
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  // 🔶 aplica classe condicional para amarelar o card
  const className = `card fila-item ${highlightInterrompida ? 'fila-interrompida' : ''}`

  return (
    <div ref={setNodeRef} style={style} className={className}>
      {canReorder ? (
        <button className="drag-handle" {...attributes} {...listeners} title="Arrastar">⠿</button>
      ) : (
        <div className="drag-handle" style={{ visibility: 'hidden' }}>⠿</div>
      )}
      <div className="fila-content">
        <Etiqueta o={ordem} variant={etiquetaVariant} />

        <div className="sep"></div>
        {canEdit && (
          <button className="btn" onClick={onEdit}>Editar</button>
        )}
      </div>
    </div>
  )
}
