// src/components/FilaSortableItem.jsx
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Etiqueta from './Etiqueta'

export default function FilaSortableItem({ordem, onEdit}) {
  const {attributes, listeners, setNodeRef, transform, transition, isDragging} =
    useSortable({ id: ordem.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
  return (
    <div ref={setNodeRef} style={style} className="card fila-item">
      <button className="drag-handle" {...attributes} {...listeners} title="Arrastar">⠿</button>
      <div className="fila-content">
        <Etiqueta o={ordem}/>
        <div className="sep"></div>
        <button className="btn" onClick={onEdit}>Editar</button>
      </div>
    </div>
  )
}
