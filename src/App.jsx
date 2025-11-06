// src/App.jsx
import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabaseClient.js'
import { DndContext, useSensor, useSensors, MouseSensor, TouchSensor } from '@dnd-kit/core'

import { MAQUINAS, STATUS, MOTIVOS_PARADA } from './lib/constants'
import { localDateTimeToISO, jaIniciou } from './lib/utils'

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
  const [lowEffModal, setLowEffModal] = useState(null)       // 🟡 início baixa eficiência
  const [lowEffEndModal, setLowEffEndModal] = useState(null) // 🟡 encerrar baixa eficiência

  const [tick, setTick] = useState(0)
  useEffect(()=>{ const id=setInterval(()=>setTick(t=>t+1),1000); return ()=>clearInterval(id) },[])

  const [form,setForm] = useState({
    code:'', customer:'', product:'', color:'', qty:'', boxes:'', standard:'', due_date:'', notes:'', machine_id:'P1'
  })

  // ========================= Fetch =========================
  async function fetchOrdensAbertas(){
    const res = await supabase.from('orders').select('*')
      .eq('finalized', false)
      .order('pos', { ascending:true })
      .order('created_at', { ascending:true })
    if (!res.error) setOrdens(res.data || [])
  }
  async function fetchOrdensFinalizadas(){
    const res = await supabase.from('orders').select('*')
      .eq('finalized', true)
      .order('finalized_at', { ascending:false })
      .limit(500)
    if (!res.error) setFinalizadas(res.data || [])
  }
  async function fetchParadas(){
    const res = await supabase.from('machine_stops').select('*')
      .order('started_at', { ascending:false })
      .limit(1000)
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
        if (r.finalized) setFinalizadas(prev=>{
          const i=prev.findIndex(x=>x.id===r.id)
          if(i>=0){const cp=[...prev]; cp[i]=r; return cp}
          return [r,...prev]
        })
      }).subscribe()
    const chStops = supabase.channel('stops-rt')
      .on('postgres_changes', { event:'*', schema:'public', table:'machine_stops' }, (p)=>{
        const r = p.new; if(!r) return;
        setParadas(prev=>{
          const i=prev.findIndex(x=>x.id===r.id)
          if(i>=0){const cp=[...prev]; cp[i]=r; return cp}
          return [r,...prev]
        })
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

    const { data: last, error: maxErr } = await supabase
      .from('orders')
      .select('pos')
      .eq('machine_id', form.machine_id)
      .eq('finalized', false)
      .order('pos', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (maxErr) { alert('Erro ao obter posição: ' + maxErr.message); return; }
    const nextPos = (last?.pos ?? -1) + 1

    const novo = {
      machine_id: form.machine_id,
      code: form.code, customer: form.customer, product: form.product, color: form.color,
      qty: form.qty, boxes: form.boxes, standard: form.standard, due_date: form.due_date || null, notes: form.notes,
      status: 'AGUARDANDO', pos: nextPos, finalized: false,
      // linhas de produção
      started_at: null, started_by: null,
      restarted_at: null, restarted_by: null,
      interrupted_at: null, interrupted_by: null,
      // baixa eficiência
      loweff_started_at: null, loweff_ended_at: null, loweff_by: null, loweff_notes: null
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
    if (!before) return

    // Troca de máquina: usa RPC para não colidir unique (machine_id,pos)
    if (before.machine_id !== ordemParcial.machine_id) {
      patchOrdemLocal(ordemParcial.id, { ...before, ...ordemParcial })
      const { data, error } = await supabase.rpc('orders_move_to_machine', {
        p_order_id: ordemParcial.id,
        p_target_machine: ordemParcial.machine_id,
        p_insert_at: null, // fim
      })
      if (error) {
        alert('Erro ao mover ordem de máquina: ' + error.message)
        patchOrdemLocal(before.id, before)
        return
      }
      if (data && data[0]) patchOrdemLocal(data[0].id, data[0])
      return
    }

    // Mesma máquina: update normal
    patchOrdemLocal(ordemParcial.id, { ...ordemParcial })
    const res = await supabase.from('orders').update({
      machine_id: ordemParcial.machine_id,
      code: ordemParcial.code, customer: ordemParcial.customer, product: ordemParcial.product, color: ordemParcial.color,
      qty: ordemParcial.qty, boxes: ordemParcial.boxes, standard: ordemParcial.standard, due_date: ordemParcial.due_date || null,
      notes: ordemParcial.notes, status: ordemParcial.status, pos: ordemParcial.pos ?? null,
      started_at: ordemParcial.started_at ?? null, started_by: ordemParcial.started_by ?? null,
      restarted_at: ordemParcial.restarted_at ?? null, restarted_by: ordemParcial.restarted_by ?? null,
      interrupted_at: ordemParcial.interrupted_at ?? null, interrupted_by: ordemParcial.interrupted_by ?? null,
      loweff_started_at: ordemParcial.loweff_started_at ?? null,
      loweff_ended_at: ordemParcial.loweff_ended_at ?? null,
      loweff_by: ordemParcial.loweff_by ?? null,
      loweff_notes: ordemParcial.loweff_notes ?? null,
    }).eq('id', ordemParcial.id).select('*').maybeSingle()

    if (res.error) {
      alert('Erro ao atualizar: ' + res.error.message)
      if (before) patchOrdemLocal(before.id, before)
      return
    }
    if (res.data) patchOrdemLocal(res.data.id, res.data)
  }

  // ========================= Fluxos: Iniciar, Parar, Retomar, Baixa Eficiência =========================
  function onStatusChange(ordem, targetStatus){
    const atual = ordem.status
    if (jaIniciou(ordem) && targetStatus === 'AGUARDANDO') {
      alert('Após iniciar a produção, não é permitido voltar para "Aguardando".')
      return
    }

    // 🟡 Entrando em BAIXA_EFICIENCIA
    if (targetStatus === 'BAIXA_EFICIENCIA' && atual !== 'BAIXA_EFICIENCIA') {
      const now = new Date()
      setLowEffModal({
        ordem,
        operador: '',
        obs: '',
        data: now.toISOString().slice(0,10),
        hora: now.toTimeString().slice(0,5),
      })
      return
    }

    // 🟡 Saindo de BAIXA_EFICIENCIA → PRODUZINDO: abrir modal para encerrar baixa ef. (limpa obs)
    if (atual === 'BAIXA_EFICIENCIA' && targetStatus === 'PRODUZINDO') {
      const now = new Date()
      setLowEffEndModal({
        ordem,
        targetStatus: 'PRODUZINDO',
        operador: '',
        data: now.toISOString().slice(0,10),
        hora: now.toTimeString().slice(0,5),
      })
      return
    }

    // 🟡 Saindo de BAIXA_EFICIENCIA → PARADA: abrir tela de parada e encerrar baixa ef no mesmo instante
    if (atual === 'BAIXA_EFICIENCIA' && targetStatus === 'PARADA') {
      const now = new Date()
      setStopModal({
        ordem,
        operador:'', motivo: MOTIVOS_PARADA[0], obs:'',
        data: now.toISOString().slice(0,10),
        hora: now.toTimeString().slice(0,5),
        endLowEffAtStopStart: true,
      })
      return
    }

    // ➜ Entrando em PARADA (de qualquer outro estado que não BAIXA_EFICIENCIA)
    if (targetStatus === 'PARADA' && atual !== 'PARADA') {
      const now=new Date()
      setStopModal({ ordem, operador:'', motivo: MOTIVOS_PARADA[0], obs:'', data: now.toISOString().slice(0,10), hora: now.toTimeString().slice(0,5) })
      return
    }

    // ➜ Saindo de PARADA
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
    const iso = localDateTimeToISO(data, hora)

    // Detecta reinício (já tinha started_at e foi interrompida)
    const isRestart = !!ordem.started_at && !!ordem.interrupted_at

    const payload = isRestart
      ? {
          // reinício após interrupção
          status: 'PRODUZINDO',
          restarted_by: operador,
          restarted_at: iso,
          // ao retomar normal, zera possíveis campos de baixa eficiência abertos
          loweff_started_at: null, loweff_ended_at: null, loweff_by: null, loweff_notes: null
        }
      : {
          // primeiro início
          started_by: operador,
          started_at: iso,
          status: 'PRODUZINDO',
          interrupted_at: null, interrupted_by: null,
          loweff_started_at: null, loweff_ended_at: null, loweff_by: null, loweff_notes: null
        }

    patchOrdemLocal(ordem.id, payload)
    const res = await supabase.from('orders').update(payload).eq('id', ordem.id).select('*').maybeSingle()
    if (res.error) { alert('Erro ao iniciar: '+res.error.message); return }
    if (res.data) patchOrdemLocal(res.data.id, res.data)
    setStartModal(null)
  }

  async function confirmarParada() {
    const { ordem, operador, motivo, obs, data, hora, endLowEffAtStopStart } = stopModal
    if (!operador || !data || !hora) { alert('Preencha operador, data e hora.'); return }
    const started_at = localDateTimeToISO(data, hora)

    // 1) Se vier de baixa eficiência, encerra-a neste mesmo timestamp + limpa observação
    if (endLowEffAtStopStart) {
      const patchLow = { loweff_ended_at: started_at, loweff_notes: null }
      patchOrdemLocal(ordem.id, patchLow)
      const upLow = await supabase.from('orders').update(patchLow).eq('id', ordem.id)
      if (upLow.error) { alert('Erro ao encerrar baixa eficiência: ' + upLow.error.message); return }
    }

    // 2) Registra parada
    const ins = await supabase.from('machine_stops')
      .insert([{ order_id: ordem.id, machine_id: ordem.machine_id, started_by: operador, started_at, reason: motivo, notes: obs }])
      .select('*').maybeSingle()
    if (ins.error) { alert('Erro ao registrar parada: ' + ins.error.message); return }

    // 3) Muda status para PARADA
    await setStatus(ordem, 'PARADA')
    setStopModal(null)
  }

  async function confirmarRetomada() {
    const { ordem, operador, data, hora, targetStatus } = resumeModal
    if (!operador || !data || !hora) { alert('Preencha operador, data e hora.'); return }
    const resumed_at = localDateTimeToISO(data, hora)
    const sel = await supabase.from('machine_stops').select('*')
      .eq('order_id', ordem.id).is('resumed_at', null)
      .order('started_at', { ascending:false })
      .limit(1).maybeSingle()
    if (sel.error) { alert('Erro ao localizar parada aberta: ' + sel.error.message); return }
    if (sel.data) {
      const upd = await supabase.from('machine_stops').update({ resumed_by: operador, resumed_at })
        .eq('id', sel.data.id)
      if (upd.error) { alert('Erro ao encerrar parada: ' + upd.error.message); return }
    }
    await setStatus(ordem, targetStatus || 'PRODUZINDO')
    setResumeModal(null)
  }

  // 🟡 Baixa Eficiência: confirmar início
  async function confirmarBaixaEf() {
    const { ordem, operador, data, hora, obs } = lowEffModal
    if (!operador || !data || !hora) { alert('Preencha operador, data e hora.'); return }

    const started_at = localDateTimeToISO(data, hora)
    const patch = {
      status: 'BAIXA_EFICIENCIA',
      loweff_started_at: started_at,
      loweff_ended_at: null,
      loweff_by: operador,
      loweff_notes: obs || null
    }
    patchOrdemLocal(ordem.id, patch)
    const res = await supabase.from('orders').update(patch).eq('id', ordem.id).select('*').maybeSingle()
    if (res.error) { alert('Erro ao registrar baixa eficiência: ' + res.error.message); return }
    if (res.data) patchOrdemLocal(res.data.id, res.data)
    setLowEffModal(null)
  }

  // 🟡 Baixa Eficiência: confirmar encerramento (retomar produção normal)
  async function confirmarEncerrarBaixaEf() {
    const { ordem, targetStatus, data, hora } = lowEffEndModal
    if (!data || !hora) { alert('Preencha data e hora.'); return }
    const ended_at = localDateTimeToISO(data, hora)

    const patch = {
      status: targetStatus || 'PRODUZINDO',
      loweff_ended_at: ended_at,
      loweff_notes: null // limpa observações conforme solicitado
    }
    const before = ordens.find(o=>o.id===ordem.id)
    patchOrdemLocal(ordem.id, patch)
    const res = await supabase.from('orders').update(patch).eq('id', ordem.id).select('*').maybeSingle()
    if (res.error) { alert('Erro ao encerrar baixa eficiência: ' + res.error.message); if(before) patchOrdemLocal(before.id, before) }
    if (res.data) patchOrdemLocal(res.data.id, res.data)
    setLowEffEndModal(null)
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
    if (res.error) {
      alert('Erro ao finalizar: ' + res.error.message)
      if(before) setOrdens(prev=>[before,...prev])
      setFinalizadas(prev=>prev.filter(o=>o.id!==ordem.id))
      return
    }
    if (res.data) upsertFinalizadaLocal(res.data)
  }

  // === ENVIAR PARA FILA (só aparece na LISTA) =======================
  async function enviarParaFila(ordemAtiva, opts) {
    const operador = opts?.operador?.trim()
    const data = opts?.data
    const hora = opts?.hora
    const maquina = ordemAtiva.machine_id
    const lista = [...ordens]
      .filter(o => !o.finalized && o.machine_id === maquina)
      .sort((a, b) => (a.pos ?? 999) - (b.pos ?? 999))

    if (!lista.length) return

    const ativa = lista[0]
    const fila = lista.slice(1)

    if (!fila.length) {
      alert('Não há itens na fila para promover.')
      return
    }

    const novoPainel = fila[0]
    const novaFilaRestante = fila.slice(1)

    // 1) posições temporárias altas para evitar UNIQUE
    const BASE = 1_000_000
    for (let i = 0; i < lista.length; i++) {
      const o = lista[i]
      const tempPos = BASE + i + 1
      const r = await supabase.from('orders').update({ pos: tempPos }).eq('id', o.id)
      if (r.error) { alert('Erro ao preparar envio para fila: ' + r.error.message); return }
    }

    // 2) promover primeiro da fila ao painel (SEM zerar started_* para não perder histórico)
    {
      const r = await supabase.from('orders').update({
        pos: 0,
        status: 'AGUARDANDO'
      }).eq('id', novoPainel.id)
      if (r.error) { alert('Erro ao promover item para o painel: ' + r.error.message); return }
    }

    // 3) reindexar fila 1..N
    for (let i = 0; i < novaFilaRestante.length; i++) {
      const o = novaFilaRestante[i]
      const r = await supabase.from('orders').update({ pos: i + 1 }).eq('id', o.id)
      if (r.error) { alert('Erro ao reordenar fila: ' + r.error.message); return }
    }

    // 4) enviar a atual para o fim e registrar interrupção
    {
      const finalPos = novaFilaRestante.length + 1
            const agoraISO = (data && hora)
        ? localDateTimeToISO(data, hora)
        : new Date().toISOString()
      const r = await supabase.from('orders').update({
        pos: finalPos,
        status: 'AGUARDANDO',
        interrupted_at: agoraISO,
        interrupted_by: operador || 'Sistema',
      }).eq('id', ativa.id)
      if (r.error) { alert('Erro ao enviar a atual para o fim da fila: ' + r.error.message); return }
    }

    // 5) atualizar estado local
    setOrdens(prev => {
      const map = new Map(prev.map(o => [o.id, { ...o }]))
      const np = map.get(novoPainel.id)
      if (np) {
        np.pos = 0;
        np.status = 'AGUARDANDO';
        // preserva started_at/started_by (não zera) para manter o histórico no Registro
      }

      novaFilaRestante.forEach((o, i) => {
        const it = map.get(o.id); if (it) it.pos = i + 1
      })

      const itAtiva = map.get(ativa.id)
      if (itAtiva) {
        itAtiva.pos = novaFilaRestante.length + 1
        itAtiva.status = 'AGUARDANDO'
        itAtiva.interrupted_at = (data && hora) ? localDateTimeToISO(data, hora) : new Date().toISOString()
        itAtiva.interrupted_by = operador || 'Sistema'
      }
      return Array.from(map.values())
    })
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
    // mantém ordens ativas que já iniciaram
    ordens.forEach(o=>{ if(o.started_at) push(o) })

    const stopsByOrder = paradas.reduce((acc,st)=>{ (acc[st.order_id] ||= []).push(st); return acc },{})

    // ordenação por recência consistente com a aba Registro
    const arr = Array.from(byId.values())
    arr.sort((a,b)=>{
      const ta = new Date(a.finalized_at || a.restarted_at || a.interrupted_at || a.started_at || a.created_at || 0).getTime()
      const tb = new Date(b.finalized_at || b.restarted_at || b.interrupted_at || b.started_at || b.created_at || 0).getTime()
      return tb - ta
    })

    return arr.map(o=>({
      ordem:o,
      stops:(stopsByOrder[o.id]||[]).sort((a,b)=>new Date(a.started_at)-new Date(b.started_at))
    }))
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
          onStatusChange={onStatusChange}
          setStartModal={setStartModal}
          setEditando={setEditando}
          setFinalizando={setFinalizando}
          enviarParaFila={enviarParaFila}
          refreshOrdens={fetchOrdensAbertas}
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

      {/* Retomada (de PARADA) */}
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

      {/* Baixa Eficiência — INÍCIO */}
      <Modal open={!!lowEffModal} onClose={()=>setLowEffModal(null)} title={lowEffModal ? `Baixa eficiência • ${lowEffModal.ordem.machine_id} • O.P ${lowEffModal.ordem.code}` : ''}>
        {lowEffModal && (
          <div className="grid">
            <div>
              <div className="label">Operador *</div>
              <input className="input" value={lowEffModal.operador} onChange={e=>setLowEffModal(v=>({...v, operador:e.target.value}))} placeholder="Nome do operador" />
            </div>
            <div className="grid2">
              <div><div className="label">Data *</div><input type="date" className="input" value={lowEffModal.data} onChange={e=>setLowEffModal(v=>({...v, data:e.target.value}))}/></div>
              <div><div className="label">Hora *</div><input type="time" className="input" value={lowEffModal.hora} onChange={e=>setLowEffModal(v=>({...v, hora:e.target.value}))}/></div>
            </div>
            <div>
              <div className="label">Observação</div>
              <textarea className="textarea" rows={3} value={lowEffModal.obs} onChange={e=>setLowEffModal(v=>({...v, obs:e.target.value}))} placeholder="Descreva o motivo da baixa eficiência, se desejar..." />
            </div>
            <div className="sep"></div>
            <div className="flex" style={{justifyContent:'flex-end', gap:8}}>
              <button className="btn ghost" onClick={()=>setLowEffModal(null)}>Cancelar</button>
              <button className="btn primary" onClick={confirmarBaixaEf}>Confirmar</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Baixa Eficiência — ENCERRAR / RETOMAR NORMAL */}
      <Modal open={!!lowEffEndModal} onClose={()=>setLowEffEndModal(null)} title={lowEffEndModal ? `Encerrar baixa eficiência • ${lowEffEndModal.ordem.machine_id} • O.P ${lowEffEndModal.ordem.code}` : ''}>
        {lowEffEndModal && (
          <div className="grid">
            <div className="grid2">
              <div><div className="label">Data *</div><input type="date" className="input" value={lowEffEndModal.data} onChange={e=>setLowEffEndModal(v=>({...v, data:e.target.value}))}/></div>
              <div><div className="label">Hora *</div><input type="time" className="input" value={lowEffEndModal.hora} onChange={e=>setLowEffEndModal(v=>({...v, hora:e.target.value}))}/></div>
            </div>
            <div className="muted" style={{marginTop:6}}>As observações de baixa eficiência serão limpas ao confirmar.</div>
            <div className="sep"></div>
            <div className="flex" style={{justifyContent:'flex-end', gap:8}}>
              <button className="btn ghost" onClick={()=>setLowEffEndModal(null)}>Cancelar</button>
              <button className="btn primary" onClick={confirmarEncerrarBaixaEf}>Confirmar</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
