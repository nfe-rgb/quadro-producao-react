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
  separationStatus = 'none', // 'none', 'partial', 'complete'
}) {
  const sortable = useSortable({ id: ordem.id })
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  // 🔶 aplica classe condicional para amarelar o card
  const className = `card fila-item ${highlightInterrompida ? 'fila-interrompida' : ''} ${separationStatus === 'partial' ? 'fila-separacao-parcial' : separationStatus === 'complete' ? 'fila-separacao-completa' : ''}`

  // Corrige a Etiqueta da fila para seguir o mesmo padrão do painel: apresenta peças realmente apontadas.
  let etiquetaProps = { o: ordem, variant: etiquetaVariant };
  if (etiquetaVariant === 'fila') {
    const parsedStandard = parseInt(String(ordem.standard || '').replace(/[^0-9]/g, ''), 10) || 0;
    etiquetaProps = {
      o: {
        ...ordem,
        apontadas_pieces: Math.max(0, Number(ordem.scanned_count || 0) * parsedStandard),
      },
      variant: etiquetaVariant
    }
  }
  return (
    <div ref={setNodeRef} style={style} className={className}>
      {canReorder ? (
        <button className="drag-handle" {...attributes} {...listeners} title="Arrastar">⠿</button>
      ) : (
        <div className="drag-handle" style={{ visibility: 'hidden' }}>⠿</div>
      )}
      <div className="fila-content">
        <Etiqueta {...etiquetaProps} />

        <div className="sep"></div>
        {canEdit && (
          <button className="btn" onClick={onEdit}>Editar</button>
        )}
      </div>
    </div>
  )
}
