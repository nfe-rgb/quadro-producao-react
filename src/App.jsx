import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabaseClient.js'
import { DndContext, closestCenter, useSensor, useSensors, MouseSensor, TouchSensor } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const MAQUINAS = ['P1','P2','P3','I1','I2','I3','I4','I5','I6']
const STATUS = ['AGUARDANDO','PRODUZINDO','BAIXA_EFICIENCIA','PARADA']
const MOTIVOS_PARADA = [
  'SET UP','TROCA DE COR','INÍCIO DE MÁQUINA','FALTA DE OPERADOR / PREPARADOR',
  'TRY-OUT / TESTE','QUALIDADE / REGULAGEM','MANUTENÇÃO ELÉTRICA','MANUTENÇÃO MECÂNICA',
  'FALTA DE PEDIDO','FIM OP','FALTA DE ABASTECIMENTO','FALTA DE INSUMOS','FALTA DE ENERGIA ELÉTRICA',
]

function statusClass(s){
  if(s==='AGUARDANDO') return 'card gray'
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

// Converte data/hora local digitada -> ISO UTC
function localDateTimeToISO(dateStr, timeStr) {
  const [Y,M,D] = dateStr.split('-').map(Number)
  const [h,m] = timeStr.split(':').map(Number)
  const local = new Date(Y, M-1, D, h, m, 0)
  return local.toISOString()
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

// Util: a ordem JÁ iniciou produção?
function jaIniciou(ordem) {
  return Boolean(ordem?.started_at);
}

export default function App(){
  const [tab,setTab] = useState('painel')
  const mouseSensor = useSensor(MouseSensor, { activationConstraint: { distance: 5 }});
  const touchSensor = useSensor(TouchSensor, { pressDelay: 150, activationConstraint: { distance: 5 }});
  const sensors = useSensors(mouseSensor, touchSensor);

  const [ordens,setOrdens] = useState([])
  const [finalizadas, setFinalizadas] = useState([])
  const [paradas, setParadas] = useState([])

  const [editando,setEditando] = useState(null)
  const [finalizando,setFinalizando] = useState(null)

  // Modais
  const [startModal, setStartModal]   = useState(null) // {ordem, operador, data, hora}
  const [stopModal, setStopModal]     = useState(null) // {ordem, operador, motivo, obs, data, hora}
  const [resumeModal, setResumeModal] = useState(null) // {ordem, operador, data, hora, targetStatus}

  // Tick para cronômetro
  const [tick, setTick] = useState(0)
  useEffect(()=>{ const id=setInterval(()=>setTick(t=>t+1),1000); return ()=>clearInterval(id) },[])

  const [form,setForm] = useState({
    code:'', customer:'', product:'', color:'', qty:'', boxes:'', standard:'', due_date:'', notes:'', machine_id:'P1'
  })

  // ========================= Fetch =========================
  async function fetchOrdensAbertas(){
    const res = await supabase.from('orders').select('*')
      .eq('finalized', false).order('pos', { ascending:true }).order('created_at', { ascending:true })
    if (!res.error) setOrdens(res.data || [])
  }
  async function fetchOrdensFinalizadas(){
    const res = await supabase.from('orders').select('*')
      .eq('finalized', true).order('finalized_at', { ascending:false }).limit(500)
    if (!res.error) setFinalizadas(res.data || [])
  }
  async function fetchParadas(){
    const res = await supabase.from('machine_stops').select('*').order('started_at', { ascending:false }).limit(1000)
    if (!res.error) setParadas(res.data || [])
  }

  useEffect(()=>{
    fetchOrdensAbertas(); fetchOrdensFinalizadas(); fetchParadas()
    const chOrders = supabase.channel('orders-rt')
      .on('postgres_changes', { event:'*', schema:'public', table:'orders' }, (p)=>{
        const r = p.new; if(!r) return;
        setOrdens(prev=>{
          const i=prev.findIndex(o=>o.id===r.id)
          if (r.finalized) { if(i>=0){const cp=[...prev]; cp.splice(i,1); return cp} return prev }
          if (i>=0){ const cp=[...prev]; cp[i]={...cp[i],...r}; return cp }
          return [...prev, r]
        })
        if (r.finalized) setFinalizadas(prev=>{ const i=prev.findIndex(x=>x.id===r.id); if(i>=0){const cp=[...prev]; cp[i]=r; return cp} return [r,...prev] })
      }).subscribe()
    const chStops = supabase.channel('stops-rt')
      .on('postgres_changes', { event:'*', schema:'public', table:'machine_stops' }, (p)=>{
        const r = p.new; if(!r) return;
        setParadas(prev=>{ const i=prev.findIndex(x=>x.id===r.id); if(i>=0){const cp=[...prev]; cp[i]=r; return cp} return [r,...prev] })
      }).subscribe()
    return ()=>{ supabase.removeChannel(chOrders); supabase.removeChannel(chStops) }
  },[])

  // Helpers
  function patchOrdemLocal(id, patch) { setOrdens(prev => prev.map(o => o.id === id ? { ...o, ...patch } : o)); }
  function removeOrdemLocal(id) { setOrdens(prev => prev.filter(o => o.id !== id)); }
  function upsertFinalizadaLocal(row) {
    setFinalizadas(prev => { const i=prev.findIndex(o=>o.id===row.id); if(i>=0){const cp=[...prev]; cp[i]=row; return cp} return [row,...prev] })
  }

  // ========================= CRUD Básico =========================
  async function criarOrdem(){
    if(!form.code.trim()) return
    const count = ordens.filter(o=>o.machine_id===form.machine_id && !o.finalized).length
    const novo = {
      machine_id: form.machine_id,
      code: form.code, customer: form.customer, product: form.product, color: form.color,
      qty: form.qty, boxes: form.boxes, standard: form.standard, due_date: form.due_date || null, notes: form.notes,
      status: 'AGUARDANDO', pos: count, finalized: false, started_at: null, started_by: null
    }
    const tempId = `tmp-${crypto.randomUUID()}`
    setOrdens(prev => [...prev, { id: tempId, ...novo }])
    const res = await supabase.from('orders').insert([novo]).select('*').maybeSingle()
    if (res.error) { setOrdens(prev => prev.filter(o => o.id !== tempId)); alert('Erro ao criar ordem: ' + res.error.message); return }
    if (res.data) setOrdens(prev => prev.map(o => o.id === tempId ? res.data : o))
    setForm({code:'', customer:'', product:'', color:'', qty:'', boxes:'', standard:'', due_date:'', notes:'', machine_id:'P1'})
    setTab('painel')
  }

  async function atualizar(ordemParcial){
    const before = ordens.find(o => o.id === ordemParcial.id)
    patchOrdemLocal(ordemParcial.id, { ...ordemParcial })
    const res = await supabase.from('orders').update({
      machine_id: ordemParcial.machine_id,
      code: ordemParcial.code, customer: ordemParcial.customer, product: ordemParcial.product, color: ordemParcial.color,
      qty: ordemParcial.qty, boxes: ordemParcial.boxes, standard: ordemParcial.standard, due_date: ordemParcial.due_date || null,
      notes: ordemParcial.notes, status: ordemParcial.status, pos: ordemParcial.pos ?? null,
      started_at: ordemParcial.started_at ?? null, started_by: ordemParcial.started_by ?? null
    }).eq('id', ordemParcial.id).select('*').maybeSingle()
    if (res.error) { alert('Erro ao atualizar: ' + res.error.message); if (before) patchOrdemLocal(before.id, before); return }
    if (res.data) patchOrdemLocal(res.data.id, res.data)
  }

  // ========================= Fluxos: Iniciar, Parar, Retomar =========================
  function onStatusChange(ordem, targetStatus){
    const atual = ordem.status

    // se já iniciou, não permitimos voltar a AGUARDANDO
    if (jaIniciou(ordem) && targetStatus === 'AGUARDANDO') {
      alert('Após iniciar a produção, não é permitido voltar para "Aguardando".')
      return
    }

    // enquanto está AGUARDANDO, o select fica travado; inicia pelo botão
    if (atual === 'AGUARDANDO') return

    if (targetStatus === 'PARADA' && atual !== 'PARADA') {
      const now=new Date()
      setStopModal({ ordem, operador:'', motivo: MOTIVOS_PARADA[0], obs:'', data: now.toISOString().slice(0,10), hora: now.toTimeString().slice(0,5) })
      return
    }
    if (atual === 'PARADA' && targetStatus !== 'PARADA') {
      const now=new Date()
      setResumeModal({ ordem, operador:'', data: now.toISOString().slice(0,10), hora: now.toTimeString().slice(0,5), targetStatus })
      return
    }
    setStatus(ordem, targetStatus)
  }

  async function setStatus(ordem, novoStatus) {
    const patch = { status: novoStatus, stopped_at: null }
    if (novoStatus === 'PARADA') patch.stopped_at = new Date().toISOString()
    const before = { status: ordem.status, stopped_at: ordem.stopped_at }
    patchOrdemLocal(ordem.id, patch)
    const res = await supabase.from('orders').update(patch).eq('id', ordem.id).select('*').maybeSingle()
    if (res.error) { alert('Erro ao alterar status: ' + res.error.message); patchOrdemLocal(ordem.id, before) }
    if (res.data) patchOrdemLocal(ordem.id, res.data)
  }

  // Iniciar Produção
  async function confirmarInicio() {
    const { ordem, operador, data, hora } = startModal
    if (!operador || !data || !hora) { alert('Preencha operador, data e hora.'); return }
    const started_at = localDateTimeToISO(data, hora)
    const payload = { started_by: operador, started_at, status: 'PRODUZINDO' }
    patchOrdemLocal(ordem.id, payload)
    const res = await supabase.from('orders').update(payload).eq('id', ordem.id).select('*').maybeSingle()
    if (res.error) { alert('Erro ao iniciar: '+res.error.message); return }
    if (res.data) patchOrdemLocal(res.data.id, res.data)
    setStartModal(null)
  }

  // Confirmar Parada
  async function confirmarParada() {
    const { ordem, operador, motivo, obs, data, hora } = stopModal
    if (!operador || !data || !hora) { alert('Preencha operador, data e hora.'); return }
    const started_at = localDateTimeToISO(data, hora)
    const ins = await supabase.from('machine_stops').insert([{
      order_id: ordem.id, machine_id: ordem.machine_id, started_by: operador, started_at, reason: motivo, notes: obs
    }]).select('*').maybeSingle()
    if (ins.error) { alert('Erro ao registrar parada: ' + ins.error.message); return }
    await setStatus(ordem, 'PARADA')
    setStopModal(null)
  }

  // Confirmar Retomada (PARADA -> PRODUZINDO/BAIXA_EFICIENCIA)
  async function confirmarRetomada() {
    const { ordem, operador, data, hora, targetStatus } = resumeModal
    if (!operador || !data || !hora) { alert('Preencha operador, data e hora.'); return }
    const resumed_at = localDateTimeToISO(data, hora)
    const sel = await supabase.from('machine_stops').select('*').eq('order_id', ordem.id).is('resumed_at', null).order('started_at', { ascending:false }).limit(1).maybeSingle()
    if (sel.error) { alert('Erro ao localizar parada aberta: ' + sel.error.message); return }
    if (sel.data) {
      const upd = await supabase.from('machine_stops').update({ resumed_by: operador, resumed_at }).eq('id', sel.data.id)
      if (upd.error) { alert('Erro ao encerrar parada: ' + upd.error.message); return }
    }
    await setStatus(ordem, targetStatus || 'PRODUZINDO')
    setResumeModal(null)
  }

  // ========================= Finalizar O.P (usa UTC) =========================
  const [confirmData, setConfirmData] = useState({por:'', data:'', hora:''})
  useEffect(()=>{
    const now = new Date()
    setConfirmData({ por:'', data: now.toISOString().slice(0,10), hora: now.toTimeString().slice(0,5) })
  },[finalizando?.id])

  async function finalizar(ordem, {por, data, hora}){
    const iso = localDateTimeToISO(data, hora)
    const payload = { finalized:true, finalized_by: por, finalized_at: iso }
    const before = ordens.find(o=>o.id===ordem.id)
    removeOrdemLocal(ordem.id)
    upsertFinalizadaLocal({ ...ordem, ...payload })
    const res = await supabase.from('orders').update(payload).eq('id', ordem.id).select('*').maybeSingle()
    if (res.error) { alert('Erro ao finalizar: ' + res.error.message); if(before) setOrdens(prev=>[before,...prev]); setFinalizadas(prev=>prev.filter(o=>o.id!==ordem.id)); return }
    if (res.data) upsertFinalizadaLocal(res.data)
  }

  // ========================= Drag fila =========================
  async function moverNaFila(maquina, e){
    const {active, over} = e; if(!active || !over) return;
    const aId=String(active.id), oId=String(over.id); if(aId===oId) return;
    const lista=[...ordens].filter(o=>!o.finalized && o.machine_id===maquina).sort((a,b)=>(a.pos??999)-(b.pos??999))
    if(!lista.length) return; const ativa=lista[0], fila=lista.slice(1)
    const oldIndex=fila.findIndex(x=>String(x.id)===aId), newIndex=fila.findIndex(x=>String(x.id)===oId)
    if(oldIndex<0||newIndex<0) return
    const novaFila=arrayMove(fila,oldIndex,newIndex)
    const nova=[ativa,...novaFila].filter(o=>o&&o.id&&!String(o.id).startsWith('tmp-')).map((o,i)=>({id:o.id,pos:i}))
    setOrdens(prev=>{ const map=new Map(prev.map(o=>[o.id,{...o}])); for(const r of nova){ const o=map.get(r.id); if(o) o.pos=r.pos } return Array.from(map.values()) })
    for(const r of nova){ const rr=await supabase.from('orders').update({pos:r.pos}).eq('id',r.id); if(rr.error){ alert('Erro ao mover: '+rr.error.message); fetchOrdensAbertas(); return } }
  }

  // === ENVIAR PARA FILA (só aparece na LISTA) =======================
  async function enviarParaFila(ordemAtiva) {
    const maquina = ordemAtiva.machine_id;

    const lista = [...ordens]
      .filter(o => !o.finalized && o.machine_id === maquina)
      .sort((a,b) => (a.pos ?? 999) - (b.pos ?? 999));

    if (!lista.length) return;
    const ativa = lista[0];
    const fila = lista.slice(1);
    if (!fila.length) {
      alert('Não há itens na fila para promover.');
      return;
    }

    const novoPainel = fila[0];
    const novaFilaRestante = fila.slice(1);

    // Fase 1: desloca todo mundo +1000 (evita colisão do índice único)
    for (const o of lista) {
      const r = await supabase.from('orders').update({ pos: (o.pos ?? 0) + 1000 }).eq('id', o.id);
      if (r.error) { alert('Erro ao preparar envio para fila: ' + r.error.message); return; }
    }

    // Fase 2:
    // - novoPainel => pos 0, AGUARDANDO, sem started_at/by
    {
      const r = await supabase.from('orders').update({
        pos: 0, status: 'AGUARDANDO', started_at: null, started_by: null
      }).eq('id', novoPainel.id);
      if (r.error) { alert('Erro ao promover item para o painel: ' + r.error.message); return; }
    }
    // - restante da fila => pos 1..N-1
    for (let i = 0; i < novaFilaRestante.length; i++) {
      const o = novaFilaRestante[i];
      const r = await supabase.from('orders').update({ pos: i + 1 }).eq('id', o.id);
      if (r.error) { alert('Erro ao reordenar fila: ' + r.error.message); return; }
    }
    // - ativa => fim da fila com AGUARDANDO
    {
      const finalPos = novaFilaRestante.length + 1;
      const r = await supabase.from('orders').update({
        pos: finalPos, status: 'AGUARDANDO'
      }).eq('id', ativa.id);
      if (r.error) { alert('Erro ao enviar a atual para o fim da fila: ' + r.error.message); return; }
    }

    // Otimista local
    setOrdens(prev => {
      const map = new Map(prev.map(o => [o.id, { ...o }]));
      const np = map.get(novoPainel.id); if (np) { np.pos = 0; np.status='AGUARDANDO'; np.started_at=null; np.started_by=null; }
      novaFilaRestante.forEach((o, i) => { const it = map.get(o.id); if (it) it.pos = i + 1; });
      const itAtiva = map.get(ativa.id); if (itAtiva) { itAtiva.pos = novaFilaRestante.length + 1; itAtiva.status = 'AGUARDANDO'; }
      return Array.from(map.values());
    });
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

  // Agrupamento para Registro (uma entrada por O.P com eventos)
  const registroGrupos = useMemo(()=>{
    const byId = new Map()
    const push = (o)=>{ if(!o) return; byId.set(o.id, { ...o }) }
    finalizadas.forEach(push)
    ordens.forEach(o=>{ if(o.started_at) push(o) })
    const stopsByOrder = paradas.reduce((acc,st)=>{
      (acc[st.order_id] ||= []).push(st); return acc
    },{})
    const arr = Array.from(byId.values())
    arr.sort((a,b)=>{
      const ta = new Date(a.finalized_at || a.started_at || a.created_at || 0).getTime()
      const tb = new Date(b.finalized_at || b.started_at || b.created_at || 0).getTime()
      return tb - ta
    })
    return arr.map(o=>({ ordem:o, stops:(stopsByOrder[o.id]||[]).sort((a,b)=>new Date(a.started_at)-new Date(b.started_at)) }))
  },[finalizadas, ordens, paradas])

  const [openSet, setOpenSet] = useState(()=>new Set())
  function toggleOpen(id){ setOpenSet(prev=>{ const n=new Set(prev); if(n.has(id)) n.delete(id); else n.add(id); return n }) }

  function fmtDuracao(startIso, endIso){
    if(!startIso || !endIso) return '-'
    const sec = Math.max(0, Math.floor((new Date(endIso) - new Date(startIso))/1000))
    const h = String(Math.floor(sec/3600)).padStart(2,'0')
    const m = String(Math.floor((sec%3600)/60)).padStart(2,'0')
    const s = String(sec%60).padStart(2,'0')
    return `${h}:${m}:${s}`
  }

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

      {/* ====================== PAINEL ====================== */}
      {tab === 'painel' && (
        <div className="board">
          {MAQUINAS.map(m=>{
            const lista = (ativosPorMaquina[m] ?? []);
            const ativa = lista[0] || null;
            // cronômetro: parada aberta dessa O.P
            const openStop = ativa ? paradas.find(p=>p.order_id===ativa.id && !p.resumed_at) : null;
            const sinceMs = openStop ? new Date(openStop.started_at).getTime() : null;
            const durText = sinceMs ? (()=>{
              // usa 'tick' para re-render
              // eslint-disable-next-line no-unused-vars
              const _ = tick;
              const total = Math.max(0, Math.floor((Date.now() - sinceMs)/1000));
              const h = String(Math.floor(total/3600)).padStart(2,'0');
              const mn = String(Math.floor((total%3600)/60)).padStart(2,'0');
              const s = String(total%60).padStart(2,'0');
              return `${h}:${mn}:${s}`;
            })() : null;

            return (
              <div key={m} className="column">
                <div className={"column-header " + (ativa?.status === 'PARADA' ? "blink-red" : "")}>
                  {m}
                  {ativa?.status === 'PARADA' && durText && (
                    <span className="parada-timer">{durText}</span>
                  )}
                </div>
                <div className="column-body">
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
                            <button className="btn"
                              onClick={()=>{
                                const now=new Date()
                                setStartModal({ ordem:ativa, operador:'', data: now.toISOString().slice(0,10), hora: now.toTimeString().slice(0,5) })
                              }}>
                              Iniciar Produção
                            </button>
                          ) : (
                            <>
                              {/* Painel NÃO mostra "Enviar para fila" */}
                              <button className="btn" onClick={()=>setFinalizando(ativa)}>Finalizar</button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (<div className="muted">Sem Programação</div>)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ====================== LISTA ====================== */}
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
      )}

      {/* ====================== NOVA ORDEM ====================== */}
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

      {/* ====================== REGISTRO (agrupado por O.P) ====================== */}
      {tab==='registro' && (
        <div className="card">
          <div className="label" style={{marginBottom:8}}>Histórico por Ordem de Produção</div>
          <div className="table">
            <div className="thead" style={{gridTemplateColumns:'140px 1fr 120px 120px 100px'}}>
              <div>O.P</div><div>Cliente / Produto / Cor / Qtd</div><div>Início</div><div>Fim</div><div>Abrir</div>
            </div>
            <div className="tbody">
              {registroGrupos.length===0 && (
                <div className="row muted" style={{gridColumn:'1 / -1', padding:'8px 0'}}>Sem registros ainda.</div>
              )}
              {registroGrupos.map(gr=>{
                const o = gr.ordem
                return (
                  <div key={o.id} style={{display:'contents'}}>
                    {/* Cabeçalho do grupo */}
                    <div className="row" style={{gridTemplateColumns:'140px 1fr 120px 120px 100px', cursor:'pointer'}} onClick={()=>toggleOpen(o.id)}>
                      <div>{o.code}</div>
                      <div>{[o.customer,o.product,o.color,o.qty].filter(Boolean).join(' • ') || '-'}</div>
                      <div>{o.started_at ? fmtDateTime(o.started_at) : '-'}</div>
                      <div>{o.finalized_at ? fmtDateTime(o.finalized_at) : '-'}</div>
                      <div>{openSet.has(o.id) ? '▲' : '▼'}</div>
                    </div>

                    {/* Corpo expandido */}
                    {openSet.has(o.id) && (
                      <div className="row" style={{gridColumn:'1 / -1', background:'#fafafa'}}>
                        <div className="grid" style={{width:'100%', gap:8}}>
                          {/* Início */}
                          <div className="small"><b>Início da produção:</b> {o.started_at ? `${fmtDateTime(o.started_at)} • ${o.started_by||'-'}` : '-'}</div>
                          {/* Paradas */}
                          {gr.stops.length===0 ? (
                            <div className="small muted">Sem paradas registradas.</div>
                          ) : gr.stops.map(st=>(
                            <div key={st.id} className="small">
                              <b>Parada:</b> {fmtDateTime(st.started_at)} {st.started_by?`• ${st.started_by}`:''}
                              {' '}→ {st.resumed_at ? fmtDateTime(st.resumed_at) : '—'}
                              {' '}<b>Duração:</b> {fmtDuracao(st.started_at, st.resumed_at)}
                              {' '}<b>Motivo:</b> {st.reason || '-'}
                              {st.notes ? ` — ${st.notes}` : ''}
                            </div>
                          ))}
                          {/* Fim */}
                          <div className="small"><b>Fim da produção:</b> {o.finalized_at ? `${fmtDateTime(o.finalized_at)} • ${o.finalized_by||'-'}` : '-'}</div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ====================== MODAIS ====================== */}
      {/* Editar */}
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

      {/* Finalizar */}
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

      {/* Início Produção */}
      <Modal open={!!startModal} onClose={()=>setStartModal(null)} title={startModal ? `Iniciar Produção • ${startModal.ordem.machine_id} • O.P ${startModal.ordem.code}` : ''}>
        {startModal && (
          <div className="grid">
            <div><div className="label">Operador *</div><input className="input" value={startModal.operador} onChange={e=>setStartModal(v=>({...v, operador:e.target.value}))} placeholder="Nome do operador"/></div>
            <div className="grid2">
              <div><div className="label">Data *</div><input type="date" className="input" value={startModal.data} onChange={e=>setStartModal(v=>({...v, data:e.target.value}))}/></div>
              <div><div className="label">Hora *</div><input type="time" className="input" value={startModal.hora} onChange={e=>setStartModal(v=>({...v, hora:e.target.value}))}/></div>
            </div>
            <div className="sep"></div>
            <div className="flex" style={{justifyContent:'flex-end', gap:8}}>
              <button className="btn ghost" onClick={()=>setStartModal(null)}>Cancelar</button>
              <button className="btn primary" onClick={confirmarInicio}>Iniciar</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Parada */}
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
            <div className="flex" style={{justifyContent:'flex-end', gap:8}}>
              <button className="btn ghost" onClick={()=>setStopModal(null)}>Cancelar</button>
              <button className="btn primary" onClick={confirmarParada}>Confirmar Parada</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Retomada */}
      <Modal open={!!resumeModal} onClose={()=>setResumeModal(null)} title={resumeModal ? `Retomar produção • ${resumeModal.ordem.machine_id} • O.P ${resumeModal.ordem.code}` : ''}>
        {resumeModal && (
          <div className="grid">
            <div><div className="label">Operador *</div><input className="input" value={resumeModal.operador} onChange={e=>setResumeModal(v=>({...v, operador:e.target.value}))} placeholder="Nome do operador"/></div>
            <div className="grid2">
              <div><div className="label">Data *</div><input type="date" className="input" value={resumeModal.data} onChange={e=>setResumeModal(v=>({...v, data:e.target.value}))}/></div>
              <div><div className="label">Hora *</div><input type="time" className="input" value={resumeModal.hora} onChange={e=>setResumeModal(v=>({...v, hora:e.target.value}))}/></div>
            </div>
            <div className="sep"></div>
            <div className="flex" style={{justifyContent:'flex-end', gap:8}}>
              <button className="btn ghost" onClick={()=>setResumeModal(null)}>Cancelar</button>
              <button className="btn primary" onClick={confirmarRetomada}>Confirmar Retomada</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
