// src/hooks/useOrders.jsx
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { MAQUINAS, MOTIVOS_PARADA } from '../lib/constants'
import { localDateTimeToISO, jaIniciou } from '../lib/utils'

export default function useOrders() {
  const [ordens,setOrdens] = useState([])
  const [finalizadas, setFinalizadas] = useState([])
  const [paradas, setParadas] = useState([])
  const [tick, setTick] = useState(0)

  // modais state (apenas os dados; os próprios componentes de modal ficam separados)
  const [editando,setEditando] = useState(null)
  const [finalizando,setFinalizando] = useState(null)
  const [startModal, setStartModal]   = useState(null)
  const [stopModal, setStopModal]     = useState(null)
  const [resumeModal, setResumeModal] = useState(null)
  const [lowEffModal, setLowEffModal] = useState(null)
  const [lowEffEndModal, setLowEffEndModal] = useState(null)

  useEffect(()=>{ const id=setInterval(()=>setTick(t=>t+1),1000); return ()=>clearInterval(id) },[])

  // ===== Fetch =====
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

  // ===== Helpers locais =====
  function patchOrdemLocal(id, patch) { setOrdens(prev => prev.map(o => o.id === id ? { ...o, ...patch } : o)); }
  function removeOrdemLocal(id) { setOrdens(prev => prev.filter(o => o.id !== id)); }
  function upsertFinalizadaLocal(row) {
    setFinalizadas(prev => { const i=prev.findIndex(o=>o.id===row.id); if(i>=0){const cp=[...prev]; cp[i]=row; return cp} return [row,...prev] })
  }

  // ===== CRUD / ações =====
  async function criarOrdem(form, setForm, setTab) {
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
      started_at: null, started_by: null,
      restarted_at: null, restarted_by: null,
      interrupted_at: null, interrupted_by: null,
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

  async function atualizar(ordemParcial) {
    const before = ordens.find(o => o.id === ordemParcial.id)
    if (!before) return

    if (before.machine_id !== ordemParcial.machine_id) {
      patchOrdemLocal(ordemParcial.id, { ...before, ...ordemParcial })
      const { data, error } = await supabase.rpc('orders_move_to_machine', {
        p_order_id: ordemParcial.id,
        p_target_machine: ordemParcial.machine_id,
        p_insert_at: null,
      })
      if (error) {
        alert('Erro ao mover ordem de máquina: ' + error.message)
        patchOrdemLocal(before.id, before)
        return
      }
      if (data && data[0]) patchOrdemLocal(data[0].id, data[0])
      return
    }

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

  async function setStatus(ordem, novoStatus) {
    const patch = { status: novoStatus, stopped_at: null }
    if (novoStatus === 'PARADA') patch.stopped_at = new Date().toISOString()
    const before = { status: ordem.status, stopped_at: ordem.stopped_at }
    patchOrdemLocal(ordem.id, patch)
    const res = await supabase.from('orders').update(patch).eq('id', ordem.id).select('*').maybeSingle()
    if (res.error) { alert('Erro ao alterar status: ' + res.error.message); patchOrdemLocal(ordem.id, before) }
    if (res.data) patchOrdemLocal(ordem.id, res.data)
  }

  async function confirmarInicio({ ordem, operador, data, hora }) {
    if (!operador || !data || !hora) { alert('Preencha operador, data e hora.'); return }
    const iso = localDateTimeToISO(data, hora)
    const isRestart = !!ordem.started_at && !!ordem.interrupted_at
    const payload = isRestart
      ? { status: 'PRODUZINDO', restarted_by: operador, restarted_at: iso, loweff_started_at: null, loweff_ended_at: null, loweff_by: null, loweff_notes: null }
      : { started_by: operador, started_at: iso, status: 'PRODUZINDO', interrupted_at: null, interrupted_by: null, loweff_started_at: null, loweff_ended_at: null, loweff_by: null, loweff_notes: null }
    patchOrdemLocal(ordem.id, payload)
    const res = await supabase.from('orders').update(payload).eq('id', ordem.id).select('*').maybeSingle()
    if (res.error) { alert('Erro ao iniciar: '+res.error.message); return }
    if (res.data) patchOrdemLocal(res.data.id, res.data)
    setStartModal(null)
  }

  async function confirmarParada({ ordem, operador, motivo, obs, data, hora, endLowEffAtStopStart }) {
    if (!operador || !data || !hora) { alert('Preencha operador, data e hora.'); return }
    const started_at = localDateTimeToISO(data, hora)

    if (endLowEffAtStopStart) {
      const patchLow = { loweff_ended_at: started_at, loweff_notes: null }
      patchOrdemLocal(ordem.id, patchLow)
      const upLow = await supabase.from('orders').update(patchLow).eq('id', ordem.id)
      if (upLow.error) { alert('Erro ao encerrar baixa eficiência: ' + upLow.error.message); return }
    }

    const ins = await supabase.from('machine_stops')
      .insert([{ order_id: ordem.id, machine_id: ordem.machine_id, started_by: operador, started_at, reason: motivo, notes: obs }])
      .select('*').maybeSingle()
    if (ins.error) { alert('Erro ao registrar parada: ' + ins.error.message); return }

    await setStatus(ordem, 'PARADA')
    setStopModal(null)
  }

  async function confirmarRetomada({ ordem, operador, data, hora, targetStatus }) {
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

  async function confirmarBaixaEf({ ordem, operador, data, hora, obs }) {
    if (!operador || !data || !hora) { alert('Preencha operador, data e hora.'); return }
    const started_at = localDateTimeToISO(data, hora)
    if (ordem.status === 'PARADA') {
      const sel = await supabase.from('machine_stops').select('*')
        .eq('order_id', ordem.id).is('resumed_at', null)
        .order('started_at', { ascending:false })
        .limit(1).maybeSingle();
      if (sel.data) {
        await supabase.from('machine_stops').update({ resumed_by: operador, resumed_at: started_at })
          .eq('id', sel.data.id);
      }
    }
    const patch = { status: 'BAIXA_EFICIENCIA', loweff_started_at: started_at, loweff_ended_at: null, loweff_by: operador, loweff_notes: obs || null }
    patchOrdemLocal(ordem.id, patch)
    const res = await supabase.from('orders').update(patch).eq('id', ordem.id).select('*').maybeSingle()
    if (res.error) { alert('Erro ao registrar baixa eficiência: ' + res.error.message); return }
    if (res.data) patchOrdemLocal(res.data.id, res.data)
    setLowEffModal(null)
  }

  async function confirmarEncerrarBaixaEf({ ordem, targetStatus, data, hora }) {
    if (!data || !hora) { alert('Preencha data e hora.'); return }
    const ended_at = localDateTimeToISO(data, hora)
    const patch = { status: targetStatus || 'PRODUZINDO', loweff_ended_at: ended_at, loweff_notes: null }
    const before = ordens.find(o=>o.id===ordem.id)
    patchOrdemLocal(ordem.id, patch)
    const res = await supabase.from('orders').update(patch).eq('id', ordem.id).select('*').maybeSingle()
    if (res.error) { alert('Erro ao encerrar baixa eficiência: ' + res.error.message); if(before) patchOrdemLocal(before.id, before) }
    if (res.data) patchOrdemLocal(res.data.id, res.data)
    setLowEffEndModal(null)
  }

  const [confirmData, setConfirmData] = useState({por:'', data:'', hora:''})
  useEffect(()=>{
    const now = new Date()
    setConfirmData({ por:'', data: now.toISOString().slice(0,10), hora: now.toTimeString().slice(0,5) })
  },[finalizando?.id])

  async function finalizar(ordem, {por, data, hora}) {
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

    const BASE = 1_000_000
    for (let i = 0; i < lista.length; i++) {
      const o = lista[i]
      const tempPos = BASE + i + 1
      const r = await supabase.from('orders').update({ pos: tempPos }).eq('id', o.id)
      if (r.error) { alert('Erro ao preparar envio para fila: ' + r.error.message); return }
    }

    {
      const r = await supabase.from('orders').update({
        pos: 0,
        status: 'AGUARDANDO'
      }).eq('id', novoPainel.id)
      if (r.error) { alert('Erro ao promover item para o painel: ' + r.error.message); return }
    }

    for (let i = 0; i < novaFilaRestante.length; i++) {
      const o = novaFilaRestante[i]
      const r = await supabase.from('orders').update({ pos: i + 1 }).eq('id', o.id)
      if (r.error) { alert('Erro ao reordenar fila: ' + r.error.message); return }
    }

    {
      const finalPos = novaFilaRestante.length + 1;
      const agoraISO = (data && hora) ? localDateTimeToISO(data, hora) : new Date().toISOString();
      if (ativa.status === 'PARADA') {
        const sel = await supabase.from('machine_stops').select('*')
          .eq('order_id', ativa.id).is('resumed_at', null)
          .order('started_at', { ascending:false })
          .limit(1).maybeSingle();
        if (sel.data) {
          await supabase.from('machine_stops').update({ resumed_by: operador || 'Sistema', resumed_at: agoraISO })
            .eq('id', sel.data.id);
        }
      }
      const r = await supabase.from('orders').update({
        pos: finalPos,
        status: 'AGUARDANDO',
        interrupted_at: agoraISO,
        interrupted_by: operador || 'Sistema',
      }).eq('id', ativa.id);
      if (r.error) { alert('Erro ao enviar a atual para o fim da fila: ' + r.error.message); return; }
    }

    setOrdens(prev => {
      const map = new Map(prev.map(o => [o.id, { ...o }]))
      const np = map.get(novoPainel.id)
      if (np) {
        np.pos = 0;
        np.status = 'AGUARDANDO';
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

  // ===== Derivados =====
  const ativosPorMaquina = useMemo(() => {
    const map = Object.fromEntries(MAQUINAS.map(m => [m, []]))
    ordens.forEach(o => { if (!o.finalized) map[o.machine_id]?.push(o) })
    for (const m of MAQUINAS) map[m] = [...map[m]].sort((a,b)=>(a.pos ?? 999)-(b.pos ?? 999))
    return map
  }, [ordens])

  const lastFinalizadoPorMaquina = useMemo(() => {
    const map = Object.fromEntries(MAQUINAS.map(m => [m, null]))
    for (const o of finalizadas) {
      if (!o.machine_id || !o.finalized_at) continue
      const prev = map[o.machine_id] ? new Date(map[o.machine_id]).getTime() : 0
      const cur  = new Date(o.finalized_at).getTime()
      if (cur > prev) map[o.machine_id] = o.finalized_at
    }
    return map
  }, [finalizadas])

  const registroGrupos = useMemo(() => {
  const byId = new Map();

  const push = (o) => {
    if (!o || !o.id) return;  // segurança
    byId.set(o.id, { ...o });
  };

  finalizadas.forEach(push);

  // somente ordens realmente iniciadas e com ID válido
  ordens.forEach(o => {
    if (o?.id && o.started_at) push(o);
  });

  const stopsByOrder = paradas.reduce((acc, st) => {
    if (!st?.order_id) return acc;
    (acc[st.order_id] ||= []).push(st);
    return acc;
  }, {});

  const arr = Array.from(byId.values());

  arr.sort((a, b) => {
    const ta = new Date(
      a.finalized_at || a.restarted_at || a.interrupted_at || a.started_at || a.created_at || 0
    ).getTime();
    const tb = new Date(
      b.finalized_at || b.restarted_at || b.interrupted_at || b.started_at || b.created_at || 0
    ).getTime();
    return tb - ta;
  });

  return arr.map(o => ({
    ordem: o,
    stops: (stopsByOrder[o.id] || []).sort(
      (a, b) => new Date(a.started_at) - new Date(b.started_at)
    ),
  }));
}, [finalizadas, ordens, paradas]);

  return {
    ordens, finalizadas, paradas, tick,
    editando, setEditando, finalizando, setFinalizando,
    startModal, setStartModal, stopModal, setStopModal, resumeModal, setResumeModal,
    lowEffModal, setLowEffModal, lowEffEndModal, setLowEffEndModal,
    fetchOrdensAbertas, fetchOrdensFinalizadas, fetchParadas,
    criarOrdem, atualizar, setStatus, confirmarInicio, confirmarParada, confirmarRetomada,
    confirmarBaixaEf, confirmarEncerrarBaixaEf, finalizar, enviarParaFila,
    ativosPorMaquina, lastFinalizadoPorMaquina, registroGrupos,
    confirmData, setConfirmData,
  }
}