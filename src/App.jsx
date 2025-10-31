import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabaseClient.js'
import { DndContext, closestCenter } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const MAQUINAS = ['P1','P2','P3','I1','I2','I3','I4','I5','I6']
const STATUS = ['PRODUZINDO','FORA_DE_CICLO','PARADA']

function statusClass(s){
  if(s==='PRODUZINDO') return 'card green'
  if(s==='FORA_DE_CICLO') return 'card yellow'
  if(s==='PARADA') return 'card red'
  return 'card'
}

function Etiqueta({o}) {
  return (
    <div className="small">
      <div><b>Código:</b> {o.code}</div>
      {o.customer && <div><b>Cliente:</b> {o.customer}</div>}
      {o.product && <div><b>Produto:</b> {o.product}</div>}
      {o.color && <div><b>Cor:</b> {o.color}</div>}
      {o.qty && <div><b>Qtd:</b> {o.qty}</div>}
      {o.boxes && <div><b>Caixas:</b> {o.boxes}</div>}
      {o.standard && <div><b>Padrão:</b> {o.standard}</div>}
      {o.due_date && <div><b>Prazo:</b> {o.due_date}</div>}
      {o.notes && <div className="muted">{o.notes}</div>}
    </div>
  )
}

function Modal({open,onClose,title,children}){
  if(!open) return null
  return (
    <div className="modalbg" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <h3 style={{marginTop:0}}>{title}</h3>
        {children}
      </div>
    </div>
  )
}

function FilaSortableItem({ordem, onEdit}){
  const {attributes, listeners, setNodeRef, transform, transition} = useSortable({id: ordem.id})
  const style = { transform: CSS.Transform.toString(transform), transition }
  return (
    <div ref={setNodeRef} style={style} className="card" {...attributes} {...listeners}>
      <Etiqueta o={ordem}/>
      <div className="sep"></div>
      <button className="btn" onClick={onEdit}>Editar</button>
    </div>
  )
}

export default function App(){
  const [tab,setTab] = useState('painel')
  const [ordens,setOrdens] = useState([])               // linhas da tabela orders (não finalizadas)
  const [editando,setEditando] = useState(null)         // ordem em edição (objeto)
  const [finalizando,setFinalizando] = useState(null)   // ordem a finalizar (objeto)
  const [form,setForm] = useState({                     // Nova Ordem
    code:'', customer:'', product:'', color:'', qty:'', boxes:'', standard:'', due_date:'', notes:'', machine_id:'P1'
  })

  // ======= Supabase =======
  async function fetchOrdens(){
    const { data } = await supabase.from('orders')
      .select('*').eq('finalized', false)
      .order('pos', { ascending:true })
      .order('created_at', { ascending:true })
    setOrdens(data || [])
  }

  useEffect(()=>{
    fetchOrdens()
    const ch = supabase.channel('orders-rt')
      .on('postgres_changes', { event:'*', schema:'public', table:'orders' }, fetchOrdens)
      .subscribe()
    return ()=> supabase.removeChannel(ch)
  },[])

  async function criarOrdem(){
    if(!form.code.trim()) return
    const count = ordens.filter(o=>o.machine_id===form.machine_id).length
    await supabase.from('orders').insert([{
      machine_id: form.machine_id,
      code: form.code, customer: form.customer, product: form.product, color: form.color,
      qty: form.qty, boxes: form.boxes, standard: form.standard, due_date: form.due_date || null, notes: form.notes,
      status: 'PRODUZINDO', pos: count
    }])
    setForm({code:'', customer:'', product:'', color:'', qty:'', boxes:'', standard:'', due_date:'', notes:'', machine_id:'P1'})
    setTab('painel')
  }

  async function atualizar(ordemParcial){ // salvar edição
    await supabase.from('orders').update({
      machine_id: ordemParcial.machine_id,
      code: ordemParcial.code, customer: ordemParcial.customer, product: ordemParcial.product, color: ordemParcial.color,
      qty: ordemParcial.qty, boxes: ordemParcial.boxes, standard: ordemParcial.standard, due_date: ordemParcial.due_date || null,
      notes: ordemParcial.notes, status: ordemParcial.status, pos: ordemParcial.pos ?? null
    }).eq('id', ordemParcial.id)
  }

  async function setStatus(ordem, s){
    await supabase.from('orders').update({ status:s }).eq('id', ordem.id)
  }

  async function finalizar(ordem, {por,data,hora}){
    await supabase.from('orders').update({
      finalized:true, finalized_by: por, finalized_at: `${data}T${hora}:00`
    }).eq('id', ordem.id)
  }

  async function moverNaFila(maquina, e){
    const {active, over} = e; if(!active || !over) return
    const aId = String(active.id); const oId = String(over.id); if(aId===oId) return
    const lista = ordens.filter(o=>!o.finalized && o.machine_id===maquina)
                        .sort((a,b)=>(a.pos ?? 999)-(b.pos ?? 999));
    if(!lista.length) return
    const ativa = lista[0]
    const fila = lista.slice(1)
    const oldIndex = fila.findIndex(x=>x.id===aId)
    const newIndex = fila.findIndex(x=>x.id===oId)
    if(oldIndex<0 || newIndex<0) return
    const novaFila = arrayMove(fila, oldIndex, newIndex)
    const nova = [ativa, ...novaFila].map((o,i)=>({ id:o.id, pos:i }))
    await supabase.from('orders').upsert(nova)
  }

  // ======= Derivados: ativos por máquina, painel e filas =======
  const ativosPorMaquina = useMemo(()=>{
    const map = Object.fromEntries(MAQUINAS.map(m=>[m,[]]))
    ordens.forEach(o=>{ map[o.machine_id]?.push(o) })
    Object.values(map).forEach(list=>{
      list.sort((a,b)=>(a.pos ?? 999) - (b.pos ?? 999))
      list.forEach((o,i)=> o.pos = i)
    })
    return map
  },[ordens])

  const painel = useMemo(()=>{
    const obj = Object.fromEntries(MAQUINAS.map(m=>[m, null]))
    MAQUINAS.forEach(m=>{ obj[m] = (ativosPorMaquina[m][0] || null) })
    return obj
  },[ativosPorMaquina])

  // ======= UI helpers =======
  const [confirmData, setConfirmData] = useState({por:'', data:'', hora:''})
  useEffect(()=>{
    const now = new Date()
    setConfirmData({
      por: '', data: now.toISOString().slice(0,10),
      hora: now.toTimeString().slice(0,5)
    })
  },[finalizando?.id])

  // ======= Render =======
  return (
    <div className="app">
      <h1>Painel de Produção</h1>

      {/* Tabs */}
      <div className="tabs">
        <button className={`tabbtn ${tab==='painel'?'active':''}`} onClick={()=>setTab('painel')}>Painel</button>
        <button className={`tabbtn ${tab==='lista'?'active':''}`} onClick={()=>setTab('lista')}>Lista</button>
        <button className={`tabbtn ${tab==='nova'?'active':''}`} onClick={()=>setTab('nova')}>Nova Ordem</button>
      </div>

      {/* ====================== PAINEL ====================== */}
      {tab==='painel' && (
        <div className="grid">
          {MAQUINAS.map(m=>{
            const ativa = painel[m]
            return (
              <div key={m} className="row">
                <div className="rowhead">{m}</div>
                {ativa ? (
                  <div className={statusClass(ativa.status)}>
                    <div className="flex" style={{justifyContent:'space-between'}}>
                      <Etiqueta o={ativa}/>
                      <div className="grid" style={{minWidth:240}}>
                        <div className="label">Situação</div>
                        <select
                          className="select"
                          value={ativa.status}
                          onChange={e=>setStatus(ativa, e.target.value)}
                        >
                          <option value="PRODUZINDO">PRODUZINDO</option>
                          <option value="FORA_DE_CICLO">FORA DE CICLO</option>
                          <option value="PARADA">PARADA</option>
                        </select>
                        <div className="flex">
                          <button className="btn" onClick={()=>setFinalizando(ativa)}>Finalizar</button>
                          <button className="btn" onClick={()=>setEditando(ativa)}>Editar</button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : <div className="muted">Sem Programação</div>}
              </div>
            )
          })}
        </div>
      )}

      {/* ====================== LISTA ====================== */}
      {tab==='lista' && (
        <div className="grid">
          <div className="tablehead">
            <div>MÁQUINA</div><div>PAINEL</div><div>FILA</div>
          </div>

          {MAQUINAS.map(m=>{
            const lista = ativosPorMaquina[m] || []
            const ativa = lista[0] || null
            const fila = lista.slice(1)

            return (
              <div className="tableline" key={m}>
                <div><span className="badge">{m}</span></div>

                {/* Painel (com status e cores) */}
                <div>
                  {ativa ? (
                    <div className={statusClass(ativa.status)}>
                      <Etiqueta o={ativa}/>
                      <div className="sep"></div>
                      <div className="grid2">
                        <div>
                          <div className="label">Situação (só painel)</div>
                          <select className="select" value={ativa.status} onChange={e=>setStatus(ativa,e.target.value)}>
                            {STATUS.map(s=><option key={s} value={s}>{s.replace('_',' ')}</option>)}
                          </select>
                        </div>
                        <div className="flex" style={{justifyContent:'flex-end'}}>
                          <button className="btn" onClick={()=>setFinalizando(ativa)}>Finalizar</button>
                          <button className="btn" onClick={()=>setEditando(ativa)}>Editar</button>
                        </div>
                      </div>
                    </div>
                  ) : <div className="muted">Sem Programação</div>}
                </div>

                {/* Fila (sem cor de status) */}
                <div>
                  <DndContext onDragEnd={(e)=>moverNaFila(m,e)} collisionDetection={closestCenter}>
                    <SortableContext items={fila.map(f=>f.id)} strategy={horizontalListSortingStrategy}>
                      <div className="fila">
                        {fila.length===0 && <div className="muted">Sem itens na fila</div>}
                        {fila.map(f=>(
                          <FilaSortableItem key={f.id} ordem={f} onEdit={()=>setEditando(f)} />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ====================== NOVA ORDEM ====================== */}
      {tab==='nova' && (
        <div className="grid" style={{maxWidth:900}}>
          <div className="card">
            <div className="grid2">
              <div>
                <div className="label">Código</div>
                <input className="input" value={form.code} onChange={e=>setForm(f=>({...f, code:e.target.value}))}/>
              </div>
              <div>
                <div className="label">Máquina</div>
                <select className="select" value={form.machine_id} onChange={e=>setForm(f=>({...f, machine_id:e.target.value}))}>
                  {MAQUINAS.map(m=><option key={m} value={m}>{m}</option>)}
                </select>
              </div>

              <div>
                <div className="label">Cliente</div>
                <input className="input" value={form.customer} onChange={e=>setForm(f=>({...f, customer:e.target.value}))}/>
              </div>
              <div>
                <div className="label">Produto</div>
                <input className="input" value={form.product} onChange={e=>setForm(f=>({...f, product:e.target.value}))}/>
              </div>

              <div>
                <div className="label">Cor</div>
                <input className="input" value={form.color} onChange={e=>setForm(f=>({...f, color:e.target.value}))}/>
              </div>
              <div>
                <div className="label">Quantidade</div>
                <input className="input" value={form.qty} onChange={e=>setForm(f=>({...f, qty:e.target.value}))}/>
              </div>

              <div>
                <div className="label">Caixas</div>
                <input className="input" value={form.boxes} onChange={e=>setForm(f=>({...f, boxes:e.target.value}))}/>
              </div>
              <div>
                <div className="label">Padrão</div>
                <input className="input" value={form.standard} onChange={e=>setForm(f=>({...f, standard:e.target.value}))}/>
              </div>

              <div>
                <div className="label">Prazo de Entrega</div>
                <input type="date" className="input" value={form.due_date} onChange={e=>setForm(f=>({...f, due_date:e.target.value}))}/>
              </div>
              <div>
                <div className="label">Observações</div>
                <input className="input" value={form.notes} onChange={e=>setForm(f=>({...f, notes:e.target.value}))}/>
              </div>
            </div>

            <div className="sep"></div>
            <button className="btn primary" onClick={criarOrdem}>Adicionar</button>
          </div>
        </div>
      )}

      {/* ====================== MODAL EDITAR ====================== */}
      <Modal
        open={!!editando}
        onClose={()=>setEditando(null)}
        title={editando ? `Editar ordem ${editando.code}` : ''}
      >
        {editando && (
          <div className="grid">
            <div className="grid2">
              <div>
                <div className="label">Código</div>
                <input className="input" value={editando.code} onChange={e=>setEditando(v=>({...v, code:e.target.value}))}/>
              </div>
              <div>
                <div className="label">Máquina</div>
                <select className="select" value={editando.machine_id} onChange={e=>setEditando(v=>({...v, machine_id:e.target.value}))}>
                  {MAQUINAS.map(m=><option key={m} value={m}>{m}</option>)}
                </select>
              </div>

              <div>
                <div className="label">Cliente</div>
                <input className="input" value={editando.customer || ''} onChange={e=>setEditando(v=>({...v, customer:e.target.value}))}/>
              </div>
              <div>
                <div className="label">Produto</div>
                <input className="input" value={editando.product || ''} onChange={e=>setEditando(v=>({...v, product:e.target.value}))}/>
              </div>

              <div>
                <div className="label">Cor</div>
                <input className="input" value={editando.color || ''} onChange={e=>setEditando(v=>({...v, color:e.target.value}))}/>
              </div>
              <div>
                <div className="label">Quantidade</div>
                <input className="input" value={editando.qty || ''} onChange={e=>setEditando(v=>({...v, qty:e.target.value}))}/>
              </div>

              <div>
                <div className="label">Caixas</div>
                <input className="input" value={editando.boxes || ''} onChange={e=>setEditando(v=>({...v, boxes:e.target.value}))}/>
              </div>
              <div>
                <div className="label">Padrão</div>
                <input className="input" value={editando.standard || ''} onChange={e=>setEditando(v=>({...v, standard:e.target.value}))}/>
              </div>

              <div>
                <div className="label">Prazo de Entrega</div>
                <input type="date" className="input" value={editando.due_date || ''} onChange={e=>setEditando(v=>({...v, due_date:e.target.value}))}/>
              </div>
              <div>
                <div className="label">Observações</div>
                <input className="input" value={editando.notes || ''} onChange={e=>setEditando(v=>({...v, notes:e.target.value}))}/>
              </div>
            </div>

            <div className="sep"></div>
            <div className="flex" style={{justifyContent:'flex-end'}}>
              <button className="btn ghost" onClick={()=>setEditando(null)}>Cancelar</button>
              <button className="btn primary" onClick={async ()=>{
                await atualizar(editando)
                setEditando(null)
              }}>Salvar</button>
            </div>
          </div>
        )}
      </Modal>

      {/* ====================== MODAL FINALIZAR ====================== */}
      <Modal
        open={!!finalizando}
        onClose={()=>setFinalizando(null)}
        title={finalizando ? `Finalizar ${finalizando.code}` : ''}
      >
        {finalizando && (
          <div className="grid">
            <div>
              <div className="label">Finalizado por *</div>
              <input className="input" value={confirmData.por} onChange={e=>setConfirmData(v=>({...v, por:e.target.value}))} placeholder="Nome do operador"/>
            </div>
            <div className="grid2">
              <div>
                <div className="label">Data *</div>
                <input type="date" className="input" value={confirmData.data} onChange={e=>setConfirmData(v=>({...v, data:e.target.value}))}/>
              </div>
              <div>
                <div className="label">Hora *</div>
                <input type="time" className="input" value={confirmData.hora} onChange={e=>setConfirmData(v=>({...v, hora:e.target.value}))}/>
              </div>
            </div>

            <div className="sep"></div>
            <div className="flex" style={{justifyContent:'flex-end'}}>
              <button className="btn ghost" onClick={()=>setFinalizando(null)}>Cancelar</button>
              <button className="btn primary" onClick={async ()=>{
                if(!confirmData.por || !confirmData.data || !confirmData.hora) return
                await finalizar(finalizando, confirmData)
                setFinalizando(null)
              }}>Confirmar</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
