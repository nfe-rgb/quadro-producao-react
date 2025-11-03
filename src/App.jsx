import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabaseClient.js'
import { DndContext, closestCenter } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const MAQUINAS = ['P1','P2','P3','I1','I2','I3','I4','I5','I6']
const STATUS = ['PRODUZINDO','BAIXA_EFICIENCIA','PARADA']

function statusClass(s){
  if(s==='PRODUZINDO') return 'card green'
  if(s==='BAIXA_EFICIENCIA') return 'card yellow'
  if(s==='PARADA') return 'card red'
  return 'card'
}

function fmtDateTime(ts) {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    const dia = d.toLocaleDateString('pt-BR')
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    return `${dia} ${hora}`
  } catch { return ts }
}

function Etiqueta({o}) {
  return (
    <div className="small">
      <div><b>Número O.P:</b> {o.code}</div>
      {o.customer && <div><b>Cliente:</b> {o.customer}</div>}
      {o.product && <div><b>Produto:</b> {o.product}</div>}
      {o.color && <div><b>Cor:</b> {o.color}</div>}
      {o.qty && <div><b>Qtd:</b> {o.qty}</div>}
      {o.boxes && <div><b>Caixas:</b> {o.boxes}</div>}
      {o.standard && <div><b>Padrão:</b> {o.standard}</div>}
      {o.due_date && (<div><b>Prazo:</b> {new Date(o.due_date).toLocaleDateString('pt-BR')}</div>)}
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

  // abertas
  const [ordens,setOrdens] = useState([])
  // finalizadas (para a aba Registro)
  const [finalizadas, setFinalizadas] = useState([])

  // =========================================================
  // Controle de nível de acesso (PCP / Supervisor)
  // =========================================================
  const [role, setRole] = useState('supervisor'); // padrão seguro

  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) return;

      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', uid)
        .single();

      if (!error && data?.role) setRole(data.role);
      else setRole('supervisor'); // fallback
    })();
  }, []);

  const isPCP = role === 'pcp';
  const isSupervisor = role === 'supervisor';

  const [editando,setEditando] = useState(null)       // modal de edição completa (usado na LISTA)
  const [finalizando,setFinalizando] = useState(null) // modal de finalizar

  // novo: edição só de observações (usado no PAINEL)
  const [obsEdit, setObsEdit] = useState(null)        // guarda a ordem que terá notes editado
  const [obsTexto, setObsTexto] = useState('')

  const [form,setForm] = useState({
    code:'', customer:'', product:'', color:'', qty:'', boxes:'', standard:'', due_date:'', notes:'', machine_id:'P1'
  })
  
  // Guarda o início da parada por máquina (só front-end)
const [paradaDesde, setParadaDesde] = useState({}); // { P1: timestampMs, ... }
// Tick para re-render a cada segundo (cronômetro)
const [tick, setTick] = useState(0);
useEffect(() => {
  const id = setInterval(() => setTick(t => t + 1), 1000);
  return () => clearInterval(id);
}, []);

// Formata duração HH:MM:SS a partir do timestamp de início
function fmtDuracaoDESDE(startMs) {
  if (!startMs) return '00:00:00';
  const total = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}


  // ========================= Supabase fetch =========================
  async function fetchOrdensAbertas(){
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('finalized', false)
      .order('pos', { ascending:true })
      .order('created_at', { ascending:true })
    if (!error) setOrdens(data || [])
  }

  async function fetchOrdensFinalizadas(){
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('finalized', true)
      .order('finalized_at', { ascending:false })
      .limit(500)
    if (!error) setFinalizadas(data || [])
  }

  useEffect(()=>{
    fetchOrdensAbertas()
    fetchOrdensFinalizadas()

    const ch = supabase.channel('orders-rt')
      .on('postgres_changes', { event:'*', schema:'public', table:'orders' }, ()=>{
        fetchOrdensAbertas()
        fetchOrdensFinalizadas()
      })
      .subscribe()

    return ()=> supabase.removeChannel(ch)
  },[])

  // ========================= CRUD =========================
  async function criarOrdem(){
    if(!form.code.trim()) return
    const count = ordens.filter(o=>o.machine_id===form.machine_id && !o.finalized).length
    const novo = {
      machine_id: form.machine_id,
      code: form.code, customer: form.customer, product: form.product, color: form.color,
      qty: form.qty, boxes: form.boxes, standard: form.standard, due_date: form.due_date || null, notes: form.notes,
      status: 'PRODUZINDO', pos: count, finalized: false
    }

    // otimista
    const tempId = `tmp-${crypto.randomUUID()}`
    setOrdens(prev => [...prev, { id: tempId, ...novo }])

    const { data, error } = await supabase
      .from('orders')
      .insert([novo])
      .select('*')
      .single()

    if (error) {
      setOrdens(prev => prev.filter(o => o.id !== tempId))
      alert('Erro ao criar ordem: ' + error.message)
      return
    }
    setOrdens(prev => prev.map(o => o.id === tempId ? data : o))

    setForm({code:'', customer:'', product:'', color:'', qty:'', boxes:'', standard:'', due_date:'', notes:'', machine_id:'P1'})
    setTab('painel')
  }

  async function atualizar(ordemParcial){
    const { error } = await supabase.from('orders').update({
      machine_id: ordemParcial.machine_id,
      code: ordemParcial.code, customer: ordemParcial.customer, product: ordemParcial.product, color: ordemParcial.color,
      qty: ordemParcial.qty, boxes: ordemParcial.boxes, standard: ordemParcial.standard, due_date: ordemParcial.due_date || null,
      notes: ordemParcial.notes, status: ordemParcial.status, pos: ordemParcial.pos ?? null
    }).eq('id', ordemParcial.id)
    if (error) alert('Erro ao atualizar: ' + error.message)
  }

async function setStatus(ordem, s) {
  const patch = { status: s };

  if (s === 'PARADA') {
    // Se ainda não havia data de parada, grava agora
    patch.stopped_at = ordem.stopped_at ?? new Date().toISOString();
  } else {
    // Se voltar a produzir ou sair do ciclo, limpa o horário de parada
    patch.stopped_at = null;
  }

  const { error } = await supabase.from('orders').update(patch).eq('id', ordem.id);
  if (error) alert('Erro ao alterar status: ' + error.message);
}

  async function finalizar(ordem, {por,data,hora}){
    const { error } = await supabase.from('orders').update({
      finalized:true, finalized_by: por, finalized_at: `${data}T${hora}:00`
    }).eq('id', ordem.id)
    if (error) alert('Erro ao finalizar: ' + error.message)
  }

  async function moverNaFila(maquina, e){
    const {active, over} = e; if(!active || !over) return
    const aId = String(active.id); const oId = String(over.id); if(aId===oId) return
    const lista = ordens
      .filter(o=>!o.finalized && o.machine_id===maquina)
      .sort((a,b)=>(a.pos ?? 999)-(b.pos ?? 999));
    if(!lista.length) return
    const ativa = lista[0]
    const fila = lista.slice(1)
    const oldIndex = fila.findIndex(x=>x.id===aId)
    const newIndex = fila.findIndex(x=>x.id===oId)
    if(oldIndex<0 || newIndex<0) return
    const novaFila = arrayMove(fila, oldIndex, newIndex)
    const nova = [ativa, ...novaFila].map((o,i)=>({ id:o.id, pos:i }))
    const { error } = await supabase.from('orders').upsert(nova)
    if (error) alert('Erro ao mover: ' + error.message)
  }

async function excluirRegistro(ordem) {
  const ok = confirm(`Excluir o registro da O.P ${ordem.code}? Esta ação é permanente.`)
  if (!ok) return

  // otimista: remove da lista visível
  setFinalizadas(prev => prev.filter(o => o.id !== ordem.id))

  const { error } = await supabase
    .from('orders')
    .delete()
    .eq('id', ordem.id)

  if (error) {
    alert('Erro ao excluir: ' + error.message)
    // rollback (recarrega do banco)
    fetchOrdensFinalizadas()
  }
}
  // ========================= Derivados =========================
  const ativosPorMaquina = useMemo(() => {
  const map = Object.fromEntries(MAQUINAS.map(m => [m, []]))
  ordens.forEach(o => { if (!o.finalized) map[o.machine_id]?.push(o) })
  for (const m of MAQUINAS) {
    map[m] = [...map[m]].sort((a,b)=>(a.pos ?? 999)-(b.pos ?? 999))
  }
  return map
}, [ordens])    // <- nada de [ordens, tick]

  // Atualiza início da parada por máquina conforme status atual
useEffect(() => {
  setParadaDesde(prev => {
    const next = { ...prev };
    for (const m of MAQUINAS) {
      const lista = ativosPorMaquina[m] || [];
      const ativa = lista[0];
      if (ativa?.status === 'PARADA') {
        // se não tinha início registrado, começa agora
        if (!next[m]) next[m] = Date.now();
      } else {
        // se não está parada, zera o cronômetro dessa máquina
        if (next[m]) delete next[m];
      }
    }
    return next;
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [ativosPorMaquina, tick]); // 'tick' faz re-render do cronômetro a cada 1s

  // ========================= UI helpers =========================
  const [confirmData, setConfirmData] = useState({por:'', data:'', hora:''})
  useEffect(()=>{
    const now = new Date()
    setConfirmData({
      por: '', data: now.toISOString().slice(0,10),
      hora: now.toTimeString().slice(0,5)
    })
  },[finalizando?.id])

  // ========================= Render =========================
  return (
    <div className="app">
      {/* Brand bar com logo do /public (corrigido) */}
      <div className="brand-bar">
        {/* coloque o arquivo exatamente em /public/Logotipo Savanti.png  */}
        <img
          src="/Logotipo Savanti.png"
          alt="Savanti Plásticos"
          className="brand-logo"
          onError={(e)=>{ e.currentTarget.src='/savanti-logo.png'; }}
        />
        <div className="brand-titles">
          <h1 className="brand-title">Painel de Produção</h1>
          <div className="brand-sub">Savanti Plásticos • Controle de Ordens</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button className={`tabbtn ${tab==='painel'?'active':''}`} onClick={()=>setTab('painel')}>Painel</button>
        <button className={`tabbtn ${tab==='lista'?'active':''}`} onClick={()=>setTab('lista')}>Lista</button>
        <button className={`tabbtn ${tab==='nova'?'active':''}`} onClick={()=>setTab('nova')}>Nova Ordem</button>
        <button className={`tabbtn ${tab==='registro'?'active':''}`} onClick={()=>setTab('registro')}>Registro</button>
      </div>

      {/* ====================== PAINEL (sem Fila) ====================== */}
      {tab === 'painel' && (
        <div className="board">   {/* força atualização visual */}
          {MAQUINAS.map(m=>{
            const lista = (ativosPorMaquina[m] ?? []);
            const ativa = lista[0] || null;

            return (
              <div key={m} className="column">
<div
  className={
    "column-header " + (ativa?.status === 'PARADA' ? "blink-red" : "")
  }>{m}{ativa?.status === 'PARADA' && (
  <span className="parada-timer">
    {fmtDuracaoDESDE(ativa.stopped_at ? new Date(ativa.stopped_at).getTime() : null)}
  </span>
)}
</div>

                <div className="column-body">
                  {/* Só o que está no painel */}
                  {ativa ? (
                    <div className={statusClass(ativa.status)}>
                      <Etiqueta o={ativa}/>
                      <div className="sep"></div>
                      <div className="grid2">
                        <div>
                          <div className="label">Situação</div>
                          <select
                            className="select"
                            value={ativa.status}
                            onChange={e=>setStatus(ativa,e.target.value)}
                          >
                            {STATUS.map(s=>(
                              <option key={s} value={s}>{s.replace('_',' ')}</option>
                            ))}
                          </select>
                        </div>
                        <div className="flex" style={{justifyContent:'flex-end'}}>
                          <button className="btn" onClick={()=>setFinalizando(ativa)}>Finalizar</button>
                          {/* Observações no lugar de Editar */}
                          <button
                            className="btn"
                            onClick={()=>{
                              setObsEdit(ativa)
                              setObsTexto(ativa.notes || '')
                            }}
                          >
                            Observações
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="muted">Sem Programação</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ====================== LISTA (visão ampla) ====================== */}
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

                {/* Painel */}
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
                          {/* Na LISTA mantém o Editar completo */}
                          <button className="btn" onClick={()=>setEditando(ativa)}>Editar</button>
                        </div>
                      </div>
                    </div>
                  ) : <div className="muted">Sem Programação</div>}
                </div>

                {/* Fila (visível e arrastável apenas na LISTA) */}
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
                <div className="label">Número O.P</div>
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

      {/* ====================== REGISTRO ====================== */}
{tab==='registro' && (
  <div className="card">
    <div className="label" style={{marginBottom:8}}>Últimas finalizações</div>
    <div className="table">
      <div
        className="thead"
        style={{gridTemplateColumns: '140px 80px 1fr 1fr 100px 160px 180px 120px'}}
      >
        <div>Número O.P</div>
        <div>Máquina</div>
        <div>Cliente</div>
        <div>Produto</div>
        <div>Qtd</div>
        <div>Operador</div>
        <div>Data/Hora</div>
        <div>Ações</div>
      </div>

      <div className="tbody">
        {finalizadas.length === 0 && (
          <div className="row muted" style={{gridColumn:'1 / -1', padding:'8px 0'}}>
            Nenhuma ordem finalizada ainda.
          </div>
        )}

        {finalizadas.map(o => (
          <div
            className="row"
            key={o.id}
            style={{gridTemplateColumns: '140px 80px 1fr 1fr 100px 160px 180px 120px'}}
          >
            <div>{o.code}</div>
            <div>{o.machine_id}</div>
            <div>{o.customer || '-'}</div>
            <div>{o.product || '-'}</div>
            <div>{o.qty || '-'}</div>
            <div>{o.finalized_by || '-'}</div>
            <div>{fmtDateTime(o.finalized_at)}</div>

            {/* Ações */}
            <div className="flex" style={{justifyContent:'flex-end'}}>
              <button
                className="btn ghost small"
                onClick={()=>excluirRegistro(o)}
                title="Excluir registro"
              >
                Excluir
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
)}

      {/* ====================== MODAL EDITAR (completo – usado na LISTA) ====================== */}
      <Modal
        open={!!editando}
        onClose={()=>setEditando(null)}
        title={editando ? `Editar O.P ${editando.code}` : ''}
      >
        {editando && (
          <div className="grid">
            <div className="grid2">
              <div>
                <div className="label">Número O.P</div>
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

      {/* ====================== MODAL OBSERVAÇÕES (apenas notes – usado no PAINEL) ====================== */}
      <Modal
        open={!!obsEdit}
        onClose={()=>setObsEdit(null)}
        title={obsEdit ? `Observações • ${obsEdit.machine_id} • O.P ${obsEdit.code}` : ''}
      >
        {obsEdit && (
          <div className="grid">
            <div>
              <div className="label">Observações da Máquina</div>
              <textarea
                className="textarea"
                rows={5}
                value={obsTexto}
                onChange={(e)=>setObsTexto(e.target.value)}
                placeholder="Anote informações importantes desta produção..."
              />
            </div>
            <div className="sep"></div>
            <div className="flex" style={{justifyContent:'flex-end'}}>
              <button className="btn ghost" onClick={()=>setObsEdit(null)}>Cancelar</button>
              <button
                className="btn primary"
                onClick={async ()=>{
                  await atualizar({ ...obsEdit, notes: obsTexto })
                  setObsEdit(null)
                }}
              >
                Salvar
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ====================== MODAL FINALIZAR ====================== */}
      <Modal
        open={!!finalizando}
        onClose={()=>setFinalizando(null)}
        title={finalizando ? `Finalizar O.P ${finalizando.code}` : ''}
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
