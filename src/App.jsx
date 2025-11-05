// src/App.jsx
import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabaseClient.js'
import { DndContext, useSensor, useSensors, MouseSensor, TouchSensor } from '@dnd-kit/core'
// DndContext aqui apenas para tipagem; o uso principal está em Lista

import { MAQUINAS, STATUS, MOTIVOS_PARADA } from './lib/constants'
import { localDateTimeToISO, jaIniciou } from './lib/utils'

// Abas utilizadas
import Modal from './components/Modal'

import Painel from './abas/Painel'
import Lista from './abas/Lista'
import NovaOrdem from './abas/NovaOrdem'
import Registro from './abas/Registro'

export default function App(){
  const [tab,setTab] = useState('painel')
  const mouseSensor = useSensor(MouseSensor, { activationConstraint: { distance: 5 }})
  const touchSensor = useSensor(TouchSensor, { pressDelay: 150, activationConstraint: { distance: 5 }})
  const sensors = useSensors(mouseSensor, touchSensor)

  const [ordens,setOrdens] = useState([])
  const [finalizadas, setFinalizadas] = useState([])
  const [paradas, setParadas] = useState([])

  const [editando,setEditando] = useState(null)
  const [finalizando,setFinalizando] = useState(null)

  const [startModal, setStartModal]   = useState(null)
  const [stopModal, setStopModal]     = useState(null)
  const [resumeModal, setResumeModal] = useState(null)

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
    if (jaIniciou(ordem) && targetStatus === 'AGUARDANDO') { alert('Após iniciar a produção, não é permitido voltar para "Aguardando".'); return }
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

  async function confirmarParada() {
    const { ordem, operador, motivo, obs, data, hora } = stopModal
    if (!operador || !data || !hora) { alert('Preencha operador, data e hora.'); return }
    const started_at = localDateTimeToISO(data, hora)
    const ins = await supabase.from('machine_stops').insert([{ order_id: ordem.id, machine_id: ordem.machine_id, started_by: operador, started_at, reason: motivo, notes: obs }]).select('*').maybeSingle()
    if (ins.error) { alert('Erro ao registrar parada: ' + ins.error.message); return }
    await setStatus(ordem, 'PARADA')
    setStopModal(null)
  }

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

  // ========================= Finalizar O.P =========================
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
    const novaFila=fila.toSpliced(newIndex, 0, ...fila.splice(oldIndex,1)) // arrayMove alternative if needed

    const nova=[ativa,...novaFila].filter(o=>o&&o.id&&!String(o.id).startsWith('tmp-')).map((o,i)=>({id:o.id,pos:i}))
    setOrdens(prev=>{ const map=new Map(prev.map(o=>[o.id,{...o}])); for(const r of nova){ const o=map.get(r.id); if(o) o.pos=r.pos } return Array.from(map.values()) })
    for(const r of nova){ const rr=await supabase.from('orders').update({pos:r.pos}).eq('id',r.id); if(rr.error){ alert('Erro ao mover: '+rr.error.message); fetchOrdensAbertas(); return } }
  }

  // === ENVIAR PARA FILA (só aparece na LISTA) =======================
  async function enviarParaFila(ordemAtiva) {
    const maquina = ordemAtiva.machine_id
    const lista = [...ordens].filter(o => !o.finalized && o.machine_id === maquina).sort((a,b) => (a.pos ?? 999) - (b.pos ?? 999))
    if (!lista.length) return
    const ativa = lista[0]
    const fila = lista.slice(1)
    if (!fila.length) { alert('Não há itens na fila para promover.'); return }

    const novoPainel = fila[0]
    const novaFilaRestante = fila.slice(1)

    for (const o of lista) {
      const r = await supabase.from('orders').update({ pos: (o.pos ?? 0) + 1000 }).eq('id', o.id)
      if (r.error) { alert('Erro ao preparar envio para fila: ' + r.error.message); return }
    }

    {
      const r = await supabase.from('orders').update({ pos: 0, status: 'AGUARDANDO', started_at: null, started_by: null }).eq('id', novoPainel.id)
      if (r.error) { alert('Erro ao promover item para o painel: ' + r.error.message); return }
    }
    for (let i = 0; i < novaFilaRestante.length; i++) {
      const o = novaFilaRestante[i]
      const r = await supabase.from('orders').update({ pos: i + 1 }).eq('id', o.id)
      if (r.error) { alert('Erro ao reordenar fila: ' + r.error.message); return }
    }
    {
      const finalPos = novaFilaRestante.length + 1
      const r = await supabase.from('orders').update({ pos: finalPos, status: 'AGUARDANDO' }).eq('id', ativa.id)
      if (r.error) { alert('Erro ao enviar a atual para o fim da fila: ' + r.error.message); return }
    }

    setOrdens(prev => {
      const map = new Map(prev.map(o => [o.id, { ...o }]))
      const np = map.get(novoPainel.id); if (np) { np.pos = 0; np.status='AGUARDANDO'; np.started_at=null; np.started_by=null }
      novaFilaRestante.forEach((o, i) => { const it = map.get(o.id); if (it) it.pos = i + 1 })
      const itAtiva = map.get(ativa.id); if (itAtiva) { itAtiva.pos = novaFilaRestante.length + 1; itAtiva.status = 'AGUARDANDO' }
      return Array.from(map.values())
    })
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

  const registroGrupos = useMemo(()=>{
    const byId = new Map()
    const push = (o)=>{ if(!o) return; byId.set(o.id, { ...o }) }
    finalizadas.forEach(push)
    ordens.forEach(o=>{ if(o.started_at) push(o) })
    const stopsByOrder = paradas.reduce((acc,st)=>{ (acc[st.order_id] ||= []).push(st); return acc },{})
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

  // ========================= Render =========================
  return (
    <div className="app">
      <div className="brand-bar">
        <img src="/Logotipo Savanti.png" alt="Savanti Plásticos" className="brand-logo"
             onError={(e)=>{ e.currentTarget.src='/savanti-logo.png'; }}/>
        <div className="brand-titles">
          <h1 className="brand-title">Painel de Produção</h1>
          <div className="brand-sub">Savanti Plásticos • Controle de Ordens</div>
        </div>
      </div>

      <div className="tabs">
        <button className={`tabbtn ${tab==='painel'?'active':''}`} onClick={()=>setTab('painel')}>Painel</button>
        <button className={`tabbtn ${tab==='lista'?'active':''}`} onClick={()=>setTab('lista')}>Lista</button>
        <button className={`tabbtn ${tab==='nova'?'active':''}`} onClick={()=>setTab('nova')}>Nova Ordem</button>
        <button className={`tabbtn ${tab==='registro'?'active':''}`} onClick={()=>setTab('registro')}>Registro</button>
      </div>

      {tab === 'painel' && (
        <Painel
          ativosPorMaquina={ativosPorMaquina}
          paradas={paradas}
          tick={tick}
          onStatusChange={onStatusChange}
          setStartModal={setStartModal}
          setFinalizando={setFinalizando}
        />
      )}

      {tab === 'lista' && (
        <Lista
          ativosPorMaquina={ativosPorMaquina}
          sensors={sensors}
          moverNaFila={moverNaFila}
          onStatusChange={onStatusChange}
          setStartModal={setStartModal}
          setEditando={setEditando}
          setFinalizando={setFinalizando}
          enviarParaFila={enviarParaFila}
        />
      )}

      {tab === 'nova' && (
        <NovaOrdem form={form} setForm={setForm} criarOrdem={criarOrdem} />
      )}

      {tab === 'registro' && (
        <Registro registroGrupos={registroGrupos} openSet={openSet} toggleOpen={toggleOpen} />
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
