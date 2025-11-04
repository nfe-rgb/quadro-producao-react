import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabaseClient.js'
import { DndContext, closestCenter, useSensor, useSensors, MouseSensor, TouchSensor } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const MAQUINAS = ['P1','P2','P3','I1','I2','I3','I4','I5','I6']
const STATUS = ['PRODUZINDO','BAIXA_EFICIENCIA','PARADA']
const MOTIVOS_PARADA = [
  'SET UP',
  'TROCA DE COR',
  'INÍCIO DE MÁQUINA',
  'FALTA DE OPERADOR / PREPARADOR',
  'TRY-OUT / TESTE',
  'QUALIDADE / REGULAGEM',
  'MANUTENÇÃO ELÉTRICA',
  'MANUTENÇÃO MECÂNICA',
  'FALTA DE PEDIDO',
  'FIM OP',
  'FALTA DE ABASTECIMENTO',
  'FALTA DE INSUMOS',
  'FALTA DE ENERGIA ELÉTRICA',
]

function statusClass(s){
  if(s==='PRODUZINDO') return 'card green'
  if(s==='BAIXA_EFICIENCIA') return 'card yellow'
  if(s==='PARADA') return 'card red'
  return 'card'
}

function fmtDateTime(ts) {
  if (!ts) return ''
  try {
    const d = new Date(ts)   // timestamptz -> JS Date (local)
    const dia = d.toLocaleDateString('pt-BR')
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    return `${dia} ${hora}`
  } catch { return ts }
}

// Constrói um ISO em UTC a partir de data/hora locais informadas pelo usuário,
// para que ao exibir no Brasil volte o mesmo horário digitado.
function localDateTimeToISO(dateStr, timeStr) {
  const [Y, M, D] = dateStr.split('-').map(Number)
  const [h, m] = timeStr.split(':').map(Number)
  const local = new Date(Y, (M - 1), D, h, m, 0) // Local time
  return local.toISOString() // UTC
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

function FilaSortableItem({ordem, onEdit}) {
  const {attributes, listeners, setNodeRef, transform, transition, isDragging} =
    useSortable({ id: ordem.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1
  }

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

export default function App(){
  const [tab,setTab] = useState('painel')
  const mouseSensor = useSensor(MouseSensor, { activationConstraint: { distance: 5 }});
  const touchSensor = useSensor(TouchSensor, { pressDelay: 150, activationConstraint: { distance: 5 }});
  const sensors = useSensors(mouseSensor, touchSensor);

  const [ordens,setOrdens] = useState([])
  const [finalizadas, setFinalizadas] = useState([])
  const [paradas, setParadas] = useState([]) // registros de paradas (machine_stops)

  // Acesso
  const [role, setRole] = useState('supervisor');
  useEffect(() => {
    (async () => {
      const resUser = await supabase.auth.getUser();
      const uid = resUser?.data?.user?.id;
      if (!uid) return;

      const resRole = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', uid)
        .single();

      if (!resRole.error && resRole.data?.role) setRole(resRole.data.role);
      else setRole('supervisor');
    })();
  }, []);

  const [editando,setEditando] = useState(null)
  const [finalizando,setFinalizando] = useState(null)

  // Modais de parada/retomada
  const [stopModal, setStopModal] = useState(null);     // { ordem, operador, motivo, obs, data, hora, targetStatus }
  const [resumeModal, setResumeModal] = useState(null); // { ordem, operador, data, hora, targetStatus }

  // Observações (painel)
  const [obsEdit, setObsEdit] = useState(null)
  const [obsTexto, setObsTexto] = useState('')

  const [form,setForm] = useState({
    code:'', customer:'', product:'', color:'', qty:'', boxes:'', standard:'', due_date:'', notes:'', machine_id:'P1'
  })

  // Cronômetro visual (mantido)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  function fmtDuracaoDESDE(startMs) {
    if (!startMs) return '00:00:00';
    const total = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
    const h = String(Math.floor(total / 3600)).padStart(2, '0');
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  // ========================= Fetch =========================
  async function fetchOrdensAbertas(){
    const res = await supabase
      .from('orders').select('*')
      .eq('finalized', false)
      .order('pos', { ascending:true })
      .order('created_at', { ascending:true })
    if (!res.error) setOrdens(res.data || [])
  }

  async function fetchOrdensFinalizadas(){
    const res = await supabase
      .from('orders').select('*')
      .eq('finalized', true)
      .order('finalized_at', { ascending:false })
      .limit(500)
    if (!res.error) setFinalizadas(res.data || [])
  }

  async function fetchParadas(){
    const res = await supabase
      .from('machine_stops').select('*')
      .order('started_at', { ascending:false })
      .limit(500)
    if (!res.error) setParadas(res.data || [])
  }

  useEffect(()=>{
    fetchOrdensAbertas()
    fetchOrdensFinalizadas()
    fetchParadas()

    // Realtime: aplica payloads sem refetch
    const chOrders = supabase
      .channel('orders-rt')
      .on('postgres_changes', { event:'*', schema:'public', table:'orders' }, (payload)=>{
        const r = payload.new
        if (!r) return
        setOrdens(prev=>{
          const idx = prev.findIndex(o=>o.id===r.id)
          if (r.finalized) {
            // saiu das abertas
            if (idx>=0) {
              const cp = [...prev]; cp.splice(idx,1); return cp
            }
            return prev
          } else {
            if (idx>=0) { const cp=[...prev]; cp[idx]={...cp[idx],...r}; return cp }
            return [...prev, r]
          }
        })
        if (r.finalized) {
          setFinalizadas(prev=>{
            const i = prev.findIndex(x=>x.id===r.id)
            if (i>=0) { const cp=[...prev]; cp[i]={...cp[i],...r}; return cp }
            return [r, ...prev]
          })
        }
      })
      .subscribe()

    const chStops = supabase
      .channel('stops-rt')
      .on('postgres_changes', { event:'*', schema:'public', table:'machine_stops' }, (payload)=>{
        const r = payload.new
        if (!r) return
        setParadas(prev=>{
          const idx = prev.findIndex(x=>x.id===r.id)
          if (idx>=0) { const cp=[...prev]; cp[idx]=r; return cp }
          return [r, ...prev]
        })
      })
      .subscribe()

    return ()=>{
      supabase.removeChannel(chOrders)
      supabase.removeChannel(chStops)
    }
  },[])

  // Helpers estado
  function patchOrdemLocal(id, patch) {
    setOrdens(prev => prev.map(o => o.id === id ? { ...o, ...patch } : o));
  }
  function removeOrdemLocal(id) { setOrdens(prev => prev.filter(o => o.id !== id)); }
  function upsertFinalizadaLocal(row) {
    setFinalizadas(prev => {
      const i = prev.findIndex(o=>o.id===row.id)
      if (i>=0) { const cp=[...prev]; cp[i]=row; return cp }
      return [row, ...prev]
    })
  }

  // ========================= CRUD básicas =========================
  async function criarOrdem(){
    if(!form.code.trim()) return
    const count = ordens.filter(o=>o.machine_id===form.machine_id && !o.finalized).length
    const novo = {
      machine_id: form.machine_id,
      code: form.code, customer: form.customer, product: form.product, color: form.color,
      qty: form.qty, boxes: form.boxes, standard: form.standard, due_date: form.due_date || null, notes: form.notes,
      status: 'PRODUZINDO', pos: count, finalized: false
    }

    const tempId = `tmp-${crypto.randomUUID()}`
    setOrdens(prev => [...prev, { id: tempId, ...novo }])

    const res = await supabase.from('orders').insert([novo]).select('*').maybeSingle()
    if (res.error) {
      setOrdens(prev => prev.filter(o => o.id !== tempId))
      alert('Erro ao criar ordem: ' + res.error.message)
      return
    }
    if (res.data) setOrdens(prev => prev.map(o => o.id === tempId ? res.data : o))

    setForm({code:'', customer:'', product:'', color:'', qty:'', boxes:'', standard:'', due_date:'', notes:'', machine_id:'P1'})
    setTab('painel')
  }

  async function atualizar(ordemParcial){
    const before = ordens.find(o => o.id === ordemParcial.id)
    patchOrdemLocal(ordemParcial.id, { ...ordemParcial })
    const res = await supabase
      .from('orders')
      .update({
        machine_id: ordemParcial.machine_id,
        code: ordemParcial.code, customer: ordemParcial.customer, product: ordemParcial.product, color: ordemParcial.color,
        qty: ordemParcial.qty, boxes: ordemParcial.boxes, standard: ordemParcial.standard, due_date: ordemParcial.due_date || null,
        notes: ordemParcial.notes, status: ordemParcial.status, pos: ordemParcial.pos ?? null
      })
      .eq('id', ordemParcial.id)
      .select('*').maybeSingle()
    if (res.error) {
      alert('Erro ao atualizar: ' + res.error.message)
      if (before) patchOrdemLocal(before.id, before)
      return
    }
    if (res.data) patchOrdemLocal(res.data.id, res.data)
  }

  // ========================= Fluxo de PARADA / RETOMADA =========================
  // Handler único chamado pelo <select> de situação
  function onStatusChange(ordem, targetStatus){
    const atual = ordem.status
    if (targetStatus === 'PARADA' && atual !== 'PARADA') {
      const now = new Date()
      setStopModal({
        ordem,
        operador: '',
        motivo: MOTIVOS_PARADA[0],
        obs: '',
        data: now.toISOString().slice(0,10),
        hora: now.toTimeString().slice(0,5),
        targetStatus
      })
      return
    }
    if (atual === 'PARADA' && targetStatus !== 'PARADA') {
      const now = new Date()
      setResumeModal({
        ordem,
        operador: '',
        data: now.toISOString().slice(0,10),
        hora: now.toTimeString().slice(0,5),
        targetStatus
      })
      return
    }
    // demais trocas diretas
    setStatus(ordem, targetStatus)
  }

  // efetiva troca simples (sem paradas)
  async function setStatus(ordem, novoStatus) {
    const patch = { status: novoStatus, stopped_at: null }
    if (novoStatus === 'PARADA') patch.stopped_at = new Date().toISOString()
    const before = { status: ordem.status, stopped_at: ordem.stopped_at }
    patchOrdemLocal(ordem.id, patch)
    const res = await supabase.from('orders').update(patch).eq('id', ordem.id).select('*').maybeSingle()
    if (res.error) { alert('Erro ao alterar status: ' + res.error.message); patchOrdemLocal(ordem.id, before) }
    if (res.data) patchOrdemLocal(ordem.id, res.data)
  }

  // confirmar PARADA: cria registro em machine_stops e põe status=PARADA
  async function confirmarParada() {
    const { ordem, operador, motivo, obs, data, hora, targetStatus } = stopModal
    if (!operador) { alert('Informe o operador.'); return }
    const started_at = localDateTimeToISO(data, hora)

    // cria registro de parada "aberta"
    const ins = await supabase.from('machine_stops').insert([{
      order_id: ordem.id,
      machine_id: ordem.machine_id,
      started_by: operador,
      started_at,
      reason: motivo,
      notes: obs
    }]).select('*').maybeSingle()
    if (ins.error) { alert('Erro ao registrar parada: ' + ins.error.message); return }

    // status -> PARADA
    await setStatus(ordem, targetStatus)
    setStopModal(null)
  }

  // confirmar RETOMADA: fecha a parada aberta e muda status
  async function confirmarRetomada() {
    const { ordem, operador, data, hora, targetStatus } = resumeModal
    if (!operador) { alert('Informe o operador.'); return }
    const resumed_at = localDateTimeToISO(data, hora)

    // pega a última parada aberta dessa O.P
    const sel = await supabase
      .from('machine_stops')
      .select('*')
      .eq('order_id', ordem.id)
      .is('resumed_at', null)
      .order('started_at', { ascending:false })
      .limit(1)
      .maybeSingle()
    if (sel.error) { alert('Erro ao localizar parada aberta: ' + sel.error.message); return }
    if (!sel.data) { /* sem parada aberta: segue só o status */ }
    else {
      const upd = await supabase
        .from('machine_stops')
        .update({ resumed_by: operador, resumed_at })
        .eq('id', sel.data.id)
      if (upd.error) { alert('Erro ao encerrar parada: ' + upd.error.message); return }
    }

    await setStatus(ordem, targetStatus)
    setResumeModal(null)
  }

  // ========================= Finalizar O.P (fuso corrigido) =========================
  const [confirmData, setConfirmData] = useState({por:'', data:'', hora:''})
  useEffect(()=>{
    const now = new Date()
    setConfirmData({
      por: '', data: now.toISOString().slice(0,10),
      hora: now.toTimeString().slice(0,5)
    })
  },[finalizando?.id])

  async function finalizar(ordem, {por, data, hora}){
    const iso = localDateTimeToISO(data, hora) // <<< fuso corrigido
    const payload = { finalized:true, finalized_by: por, finalized_at: iso }

    const before = ordens.find(o => o.id === ordem.id)
    removeOrdemLocal(ordem.id)
    upsertFinalizadaLocal({ ...ordem, ...payload })

    const res = await supabase.from('orders').update(payload).eq('id', ordem.id).select('*').maybeSingle()
    if (res.error) {
      alert('Erro ao finalizar: ' + res.error.message)
      if (before) setOrdens(prev => [before, ...prev])
      setFinalizadas(prev => prev.filter(o => o.id !== ordem.id))
      return
    }
    if (res.data) upsertFinalizadaLocal(res.data)
  }

  // ========================= Fila (drag) =========================
  async function moverNaFila(maquina, e){
    const {active, over} = e;
    if(!active || !over) return;
    const aId = String(active.id);
    const oId = String(over.id);
    if(aId === oId) return;

    const lista = [...ordens].filter(o => !o.finalized && o.machine_id === maquina)
      .sort((a,b) => (a.pos ?? 999) - (b.pos ?? 999));
    if (!lista.length) return;
    const ativa = lista[0];
    const fila = lista.slice(1);

    const oldIndex = fila.findIndex(x => String(x.id) === aId);
    const newIndex = fila.findIndex(x => String(x.id) === oId);
    if (oldIndex < 0 || newIndex < 0) return;

    const novaFila = arrayMove(fila, oldIndex, newIndex);
    const nova = [ativa, ...novaFila].filter(o => o && o.id && !String(o.id).startsWith('tmp-')).map((o,i)=>({id:o.id,pos:i}));

    setOrdens(prev=>{
      const map = new Map(prev.map(o=>[o.id,{...o}]));
      for (const row of nova){ const o = map.get(row.id); if(o) o.pos=row.pos; }
      return Array.from(map.values());
    });

    for (const row of nova) {
      const r = await supabase.from('orders').update({ pos: row.pos }).eq('id', row.id);
      if (r.error) { alert('Erro ao mover: ' + r.error.message); fetchOrdensAbertas(); return; }
    }
  }

  async function excluirRegistro(ordem) {
    const ok = confirm(`Excluir o registro da O.P ${ordem.code}? Esta ação é permanente.`)
    if (!ok) return
    setFinalizadas(prev => prev.filter(o => o.id !== ordem.id))
    const res = await supabase.from('orders').delete().eq('id', ordem.id)
    if (res.error) { alert('Erro ao excluir: ' + res.error.message); fetchOrdensFinalizadas() }
  }

  // ========================= Derivados =========================
  const ativosPorMaquina = useMemo(() => {
    const map = Object.fromEntries(MAQUINAS.map(m => [m, []]))
    ordens.forEach(o => { if (!o.finalized) map[o.machine_id]?.push(o) })
    for (const m of MAQUINAS) map[m] = [...map[m]].sort((a,b)=>(a.pos ?? 999)-(b.pos ?? 999))
    return map
  }, [ordens])

  // ========================= Render =========================
  return (
    <div className="app">
      {/* Brand */}
      <div className="brand-bar">
        <img src="/Logotipo Savanti.png" alt="Savanti Plásticos" className="brand-logo"
             onError={(e)=>{ e.currentTarget.src='/savanti-logo.png'; }}/>
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

      {/* ===== PAINEL ===== */}
      {tab === 'painel' && (
        <div className="board">
          {MAQUINAS.map(m=>{
            const lista = (ativosPorMaquina[m] ?? []);
            const ativa = lista[0] || null;

            return (
              <div key={m} className="column">
                <div className={"column-header " + (ativa?.status === 'PARADA' ? "blink-red" : "")}>
                  {m}
                </div>
                <div className="column-body">
                  {ativa ? (
                    <div className={statusClass(ativa.status)}>
                      <Etiqueta o={ativa}/>
                      <div className="sep"></div>
                      <div className="grid2">
                        <div>
                          <div className="label">Situação</div>
                          <select className="select" value={ativa.status} onChange={e=>onStatusChange(ativa, e.target.value)}>
                            {STATUS.map(s=>(
                              <option key={s} value={s}>
                                {s === 'BAIXA_EFICIENCIA' ? 'Baixa Eficiência' :
                                 s === 'PRODUZINDO' ? 'Produzindo' :
                                 s === 'PARADA' ? 'Parada' : s}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex" style={{justifyContent:'flex-end'}}>
                          <button className="btn" onClick={()=>setFinalizando(ativa)}>Finalizar</button>
                          <button className="btn" onClick={()=>{
                            setObsEdit(ativa); setObsTexto(ativa.notes || '')
                          }}>Observações</button>
                        </div>
                      </div>
                    </div>
                  ) : (<div className="muted">Sem Programação</div>)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ===== LISTA ===== */}
      {tab==='lista' && (
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
                          <select className="select" value={ativa.status} onChange={e=>onStatusChange(ativa, e.target.value)}>
                            {STATUS.map(s=>(
                              <option key={s} value={s}>
                                {s === 'BAIXA_EFICIENCIA' ? 'Baixa Eficiência' :
                                 s === 'PRODUZINDO' ? 'Produzindo' :
                                 s === 'PARADA' ? 'Parada' : s}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex" style={{justifyContent:'flex-end'}}>
                          <button className="btn" onClick={()=>setFinalizando(ativa)}>Finalizar</button>
                          <button className="btn" onClick={()=>setEditando(ativa)}>Editar</button>
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
      )}

      {/* ===== NOVA ORDEM ===== */}
      {tab==='nova' && (
        <div className="grid" style={{maxWidth:900}}>
          <div className="card">
            <div className="grid2">
              <div><div className="label">Número O.P</div><input className="input" value={form.code} onChange={e=>setForm(f=>({...f, code:e.target.value}))}/></div>
              <div><div className="label">Máquina</div><select className="select" value={form.machine_id} onChange={e=>setForm(f=>({...f, machine_id:e.target.value}))}>{MAQUINAS.map(m=><option key={m} value={m}>{m}</option>)}</select></div>
              <div><div className="label">Cliente</div><input className="input" value={form.customer} onChange={e=>setForm(f=>({...f, customer:e.target.value}))}/></div>
              <div><div className="label">Produto</div><input className="input" value={form.product} onChange={e=>setForm(f=>({...f, product:e.target.value}))}/></div>
              <div><div className="label">Cor</div><input className="input" value={form.color} onChange={e=>setForm(f=>({...f, color:e.target.value}))}/></div>
              <div><div className="label">Quantidade</div><input className="input" value={form.qty} onChange={e=>setForm(f=>({...f, qty:e.target.value}))}/></div>
              <div><div className="label">Caixas</div><input className="input" value={form.boxes} onChange={e=>setForm(f=>({...f, boxes:e.target.value}))}/></div>
              <div><div className="label">Padrão</div><input className="input" value={form.standard} onChange={e=>setForm(f=>({...f, standard:e.target.value}))}/></div>
              <div><div className="label">Prazo de Entrega</div><input type="date" className="input" value={form.due_date} onChange={e=>setForm(f=>({...f, due_date:e.target.value}))}/></div>
              <div><div className="label">Observações</div><input className="input" value={form.notes} onChange={e=>setForm(f=>({...f, notes:e.target.value}))}/></div>
            </div>
            <div className="sep"></div>
            <button className="btn primary" onClick={criarOrdem}>Adicionar</button>
          </div>
        </div>
      )}

      {/* ===== REGISTRO ===== */}
      {tab==='registro' && (
        <div className="grid" style={{gap:16}}>
          {/* Finalizações */}
          <div className="card">
            <div className="label" style={{marginBottom:8}}>Últimas finalizações</div>
            <div className="table">
              <div className="thead" style={{gridTemplateColumns:'140px 80px 1fr 1fr 100px 160px 180px 120px'}}>
                <div>Número O.P</div><div>Máquina</div><div>Cliente</div><div>Produto</div>
                <div>Qtd</div><div>Operador</div><div>Data/Hora</div><div>Ações</div>
              </div>
              <div className="tbody">
                {finalizadas.length===0 && (<div className="row muted" style={{gridColumn:'1 / -1', padding:'8px 0'}}>Nenhuma ordem finalizada ainda.</div>)}
                {finalizadas.map(o=>(
                  <div className="row" key={o.id} style={{gridTemplateColumns:'140px 80px 1fr 1fr 100px 160px 180px 120px'}}>
                    <div>{o.code}</div><div>{o.machine_id}</div><div>{o.customer||'-'}</div><div>{o.product||'-'}</div>
                    <div>{o.qty||'-'}</div><div>{o.finalized_by||'-'}</div><div>{fmtDateTime(o.finalized_at)}</div>
                    <div className="flex" style={{justifyContent:'flex-end'}}><button className="btn ghost small" onClick={()=>excluirRegistro(o)}>Excluir</button></div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Paradas */}
          <div className="card">
            <div className="label" style={{marginBottom:8}}>Registro de Paradas</div>
            <div className="table">
              <div className="thead" style={{gridTemplateColumns:'140px 80px 160px 160px 140px 1fr'}}>
                <div>O.P</div><div>Máquina</div><div>Início</div><div>Fim</div><div>Duração</div><div>Motivo / Observações</div>
              </div>
              <div className="tbody">
                {paradas.length===0 && (<div className="row muted" style={{gridColumn:'1 / -1', padding:'8px 0'}}>Nenhuma parada registrada.</div>)}
                {paradas.map(p=>{
                  let dur = '-'
                  if (p.started_at && p.resumed_at) {
                    const sec = Math.max(0, Math.floor((new Date(p.resumed_at) - new Date(p.started_at))/1000))
                    const h = String(Math.floor(sec/3600)).padStart(2,'0')
                    const m = String(Math.floor((sec%3600)/60)).padStart(2,'0')
                    const s = String(sec%60).padStart(2,'0')
                    dur = `${h}:${m}:${s}`
                  }
                  return (
                    <div className="row" key={p.id} style={{gridTemplateColumns:'140px 80px 160px 160px 140px 1fr'}}>
                      <div>{(ordens.find(o=>o.id===p.order_id)?.code) || (finalizadas.find(f=>f.id===p.order_id)?.code) || '-'}</div>
                      <div>{p.machine_id}</div>
                      <div>{fmtDateTime(p.started_at)} {p.started_by ? `• ${p.started_by}`:''}</div>
                      <div>{p.resumed_at ? fmtDateTime(p.resumed_at) : '-' } {p.resumed_by ? `• ${p.resumed_by}`:''}</div>
                      <div>{dur}</div>
                      <div><b>{p.reason || '-'}</b>{p.notes ? ` — ${p.notes}` : ''}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL EDITAR ===== */}
      <Modal open={!!editando} onClose={()=>setEditando(null)} title={editando ? `Editar O.P ${editando.code}` : ''}>
        {editando && (
          <div className="grid">
            <div className="grid2">
              <div><div className="label">Número O.P</div><input className="input" value={editando.code} onChange={e=>setEditando(v=>({...v, code:e.target.value}))}/></div>
              <div><div className="label">Máquina</div><select className="select" value={editando.machine_id} onChange={e=>setEditando(v=>({...v, machine_id:e.target.value}))}>{MAQUINAS.map(m=><option key={m} value={m}>{m}</option>)}</select></div>
              <div><div className="label">Cliente</div><input className="input" value={editando.customer||''} onChange={e=>setEditando(v=>({...v, customer:e.target.value}))}/></div>
              <div><div className="label">Produto</div><input className="input" value={editando.product||''} onChange={e=>setEditando(v=>({...v, product:e.target.value}))}/></div>
              <div><div className="label">Cor</div><input className="input" value={editando.color||''} onChange={e=>setEditando(v=>({...v, color:e.target.value}))}/></div>
              <div><div className="label">Quantidade</div><input className="input" value={editando.qty||''} onChange={e=>setEditando(v=>({...v, qty:e.target.value}))}/></div>
              <div><div className="label">Caixas</div><input className="input" value={editando.boxes||''} onChange={e=>setEditando(v=>({...v, boxes:e.target.value}))}/></div>
              <div><div className="label">Padrão</div><input className="input" value={editando.standard||''} onChange={e=>setEditando(v=>({...v, standard:e.target.value}))}/></div>
              <div><div className="label">Prazo de Entrega</div><input type="date" className="input" value={editando.due_date||''} onChange={e=>setEditando(v=>({...v, due_date:e.target.value}))}/></div>
              <div><div className="label">Observações</div><input className="input" value={editando.notes||''} onChange={e=>setEditando(v=>({...v, notes:e.target.value}))}/></div>
            </div>
            <div className="sep"></div>
            <div className="flex" style={{justifyContent:'flex-end'}}>
              <button className="btn ghost" onClick={()=>setEditando(null)}>Cancelar</button>
              <button className="btn primary" onClick={async ()=>{ await atualizar(editando); setEditando(null) }}>Salvar</button>
            </div>
          </div>
        )}
      </Modal>

      {/* ===== MODAL OBSERVAÇÕES ===== */}
      <Modal open={!!obsEdit} onClose={()=>setObsEdit(null)} title={obsEdit ? `Observações • ${obsEdit.machine_id} • O.P ${obsEdit.code}` : ''}>
        {obsEdit && (
          <div className="grid">
            <div>
              <div className="label">Observações da Máquina</div>
              <textarea className="textarea" rows={5} value={obsTexto} onChange={(e)=>setObsTexto(e.target.value)} placeholder="Anote informações importantes desta produção..."/>
            </div>
            <div className="sep"></div>
            <div className="flex" style={{justifyContent:'flex-end'}}>
              <button className="btn ghost" onClick={()=>setObsEdit(null)}>Cancelar</button>
              <button className="btn primary" onClick={async ()=>{ await atualizar({ ...obsEdit, notes: obsTexto }); setObsEdit(null) }}>Salvar</button>
            </div>
          </div>
        )}
      </Modal>

      {/* ===== MODAL FINALIZAR ===== */}
      <Modal open={!!finalizando} onClose={()=>setFinalizando(null)} title={finalizando ? `Finalizar O.P ${finalizando.code}` : ''}>
        {finalizando && (
          <div className="grid">
            <div><div className="label">Finalizado por *</div><input className="input" value={confirmData.por} onChange={e=>setConfirmData(v=>({...v, por:e.target.value}))} placeholder="Nome do operador"/></div>
            <div className="grid2">
              <div><div className="label">Data *</div><input type="date" className="input" value={confirmData.data} onChange={e=>setConfirmData(v=>({...v, data:e.target.value}))}/></div>
              <div><div className="label">Hora *</div><input type="time" className="input" value={confirmData.hora} onChange={e=>setConfirmData(v=>({...v, hora:e.target.value}))}/></div>
            </div>
            <div className="sep"></div>
            <div className="flex" style={{justifyContent:'flex-end'}}>
              <button className="btn ghost" onClick={()=>setFinalizando(null)}>Cancelar</button>
              <button className="btn primary" onClick={async ()=>{ if(!confirmData.por || !confirmData.data || !confirmData.hora) return; await finalizar(finalizando, confirmData); setFinalizando(null) }}>Confirmar</button>
            </div>
          </div>
        )}
      </Modal>

      {/* ===== MODAL CONFIRMAR PARADA ===== */}
      <Modal open={!!stopModal} onClose={()=>setStopModal(null)} title={stopModal ? `Parar máquina • ${stopModal.ordem.machine_id} • O.P ${stopModal.ordem.code}` : ''}>
        {stopModal && (
          <div className="grid">
            <div><div className="label">Operador *</div><input className="input" value={stopModal.operador} onChange={e=>setStopModal(v=>({...v, operador:e.target.value}))} placeholder="Nome do operador"/></div>
            <div className="grid2">
              <div><div className="label">Data *</div><input type="date" className="input" value={stopModal.data} onChange={e=>setStopModal(v=>({...v, data:e.target.value}))}/></div>
              <div><div className="label">Hora *</div><input type="time" className="input" value={stopModal.hora} onChange={e=>setStopModal(v=>({...v, hora:e.target.value}))}/></div>
            </div>
            <div>
              <div className="label">Motivo da Parada *</div>
              <select className="select" value={stopModal.motivo} onChange={e=>setStopModal(v=>({...v, motivo:e.target.value}))}>
                {MOTIVOS_PARADA.map(m=> <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <div className="label">Observações</div>
              <textarea className="textarea" rows={4} value={stopModal.obs} onChange={e=>setStopModal(v=>({...v, obs:e.target.value}))} placeholder="Detalhe o problema, se necessário..."/>
            </div>
            <div className="sep"></div>
            <div className="flex" style={{justifyContent:'flex-end'}}>
              <button className="btn ghost" onClick={()=>setStopModal(null)}>Cancelar</button>
              <button className="btn primary" onClick={confirmarParada}>Confirmar Parada</button>
            </div>
          </div>
        )}
      </Modal>

      {/* ===== MODAL CONFIRMAR RETOMADA ===== */}
      <Modal open={!!resumeModal} onClose={()=>setResumeModal(null)} title={resumeModal ? `Retomar produção • ${resumeModal.ordem.machine_id} • O.P ${resumeModal.ordem.code}` : ''}>
        {resumeModal && (
          <div className="grid">
            <div><div className="label">Operador *</div><input className="input" value={resumeModal.operador} onChange={e=>setResumeModal(v=>({...v, operador:e.target.value}))} placeholder="Nome do operador"/></div>
            <div className="grid2">
              <div><div className="label">Data *</div><input type="date" className="input" value={resumeModal.data} onChange={e=>setResumeModal(v=>({...v, data:e.target.value}))}/></div>
              <div><div className="label">Hora *</div><input type="time" className="input" value={resumeModal.hora} onChange={e=>setResumeModal(v=>({...v, hora:e.target.value}))}/></div>
            </div>
            <div className="sep"></div>
            <div className="flex" style={{justifyContent:'flex-end'}}>
              <button className="btn ghost" onClick={()=>setResumeModal(null)}>Cancelar</button>
              <button className="btn primary" onClick={confirmarRetomada}>Confirmar Retomada</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
