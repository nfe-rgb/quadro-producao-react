// src/abas/Lista.jsx
import { DndContext, closestCenter } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import FilaSortableItem from '../components/FilaSortableItem'
import Etiqueta from '../components/Etiqueta'
import { MAQUINAS, STATUS } from '../lib/constants'
import { statusClass, jaIniciou } from '../lib/utils'

export default function Lista({ ativosPorMaquina, sensors, moverNaFila, onStatusChange, setStartModal, setEditando, setFinalizando, enviarParaFila }) {
  return (
    <div className="grid">
      <div className="tablehead"><div>MÁQUINA</div><div>PAINEL</div><div>FILA</div></div>
      {MAQUINAS.map(m=>{
        const lista = ativosPorMaquina[m] || []
        const ativa = lista[0] || null
        const fila = lista.slice(1)
        return (
          <div className="tableline" key={m}>
            <div className="cell-machine"><span className="badge">{m}</span></div>
            <div className="cell-painel">
              {ativa ? (
                <div className={statusClass(ativa.status)}>
                  <Etiqueta o={ativa}/>
                  <div className="sep"></div>
                  <div className="grid2">
                    <div>
                      <div className="label">Situação (só painel)</div>
                      <select
                        className="select"
                        value={ativa.status}
                        onChange={e=>onStatusChange(ativa,e.target.value)}
                        disabled={ativa.status==='AGUARDANDO'}
                      >
                        {STATUS
                          .filter(s => jaIniciou(ativa) ? s !== 'AGUARDANDO' : true)
                          .map(s=>(
                            <option key={s} value={s}>
                              {s==='AGUARDANDO'?'Aguardando': s==='PRODUZINDO'?'Produzindo': s==='BAIXA_EFICIENCIA'?'Baixa Eficiência':'Parada'}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="flex" style={{justifyContent:'flex-end', gap:8}}>
                      {ativa.status==='AGUARDANDO' ? (
                        <>
                          <button className="btn" onClick={()=>{
                            const now=new Date()
                            setStartModal({ ordem:ativa, operador:'', data: now.toISOString().slice(0,10), hora: now.toTimeString().slice(0,5) })
                          }}>Iniciar Produção</button>
                          <button className="btn" onClick={()=>setEditando(ativa)}>Editar</button>
                          <button className="btn" onClick={()=>enviarParaFila(ativa)}>Enviar para fila</button>
                        </>
                      ) : (
                        <>
                          <button className="btn" onClick={()=>setFinalizando(ativa)}>Finalizar</button>
                          <button className="btn" onClick={()=>setEditando(ativa)}>Editar</button>
                          <button className="btn" onClick={()=>enviarParaFila(ativa)}>Enviar para fila</button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ) : (<div className="muted">Sem Programação</div>)}
            </div>
            <div className="cell-fila">
              {fila.length === 0 ? (
                <div className="fila"><div className="muted">Sem itens na fila</div></div>
              ) : (
                <DndContext sensors={sensors} onDragEnd={(e)=>moverNaFila(m,e)} collisionDetection={closestCenter}>
                  <SortableContext items={fila.map(f=>f.id)} strategy={horizontalListSortingStrategy}>
                    <div className="fila">
                      {fila.map(f => (<FilaSortableItem key={f.id} ordem={f} onEdit={()=>setEditando(f)} />))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
