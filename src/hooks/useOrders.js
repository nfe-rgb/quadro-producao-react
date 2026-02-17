// src/hooks/useOrders.js
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { MAQUINAS, MOTIVOS_PARADA } from '../lib/constants'
import { localDateTimeToISO, jaIniciou } from '../lib/utils'

export default function useOrders(){
  const [ordens,setOrdens] = useState([])
  const [finalizadas, setFinalizadas] = useState([])
  const [paradas, setParadas] = useState([])

  // map local para guardar session id dos logs de baixa eficiência (key = `order_<order_id>`)
  const [lowEffSessions, setLowEffSessions] = useState({})

  // basic fetchers
  async function fetchOrdensAbertas(){
    // NOTE: scanned_count:production_scans(count) -> agrega o count de production_scans por order_id
    const res = await supabase
      .from('orders')
      .select(`
        *,
        scanned_count:production_scans(count)
      `)
      .eq('finalized', false)
      .order('pos',{ascending:true})
      .order('created_at',{ascending:true})

    if(!res.error) {
      const normalized = (res.data || []).map(row => {
        const sc = row.scanned_count;
        if (Array.isArray(sc) && sc.length > 0 && typeof sc[0].count !== 'undefined') {
          return { ...row, scanned_count: Number(sc[0].count || 0) };
        }
        if (sc && typeof sc === 'object' && typeof sc.count !== 'undefined') {
          return { ...row, scanned_count: Number(sc.count || 0) };
        }
        return { ...row, scanned_count: typeof sc === 'number' ? sc : Number(sc || 0) };
      });

      setOrdens(normalized)
    }
  }

  async function fetchOrdensFinalizadas(){
    const res = await supabase.from('orders').select('*').eq('finalized', true).order('finalized_at',{ascending:false}).limit(500)
    if(!res.error) setFinalizadas(res.data||[])
  }
  async function fetchParadas(){
    const res = await supabase.from('machine_stops').select('*').order('started_at',{ascending:false}).limit(1000)
    if(!res.error) setParadas(res.data||[])
  }

  useEffect(()=>{ 
    fetchOrdensAbertas(); fetchOrdensFinalizadas(); fetchParadas()
    const chOrders = supabase.channel('orders-rt')
      .on('postgres_changes', { event:'*', schema:'public', table:'orders' }, (p)=>{
        const r = p.new; if(!r) return;

        setOrdens(prev=>{
          const i=prev.findIndex(o=>o.id===r.id)
          const preservedScanned = i>=0 ? prev[i].scanned_count : undefined
          const merged = preservedScanned !== undefined ? { ...r, scanned_count: preservedScanned } : r

          if (r.finalized) { if(i>=0){const cp=[...prev]; cp.splice(i,1); return cp} return prev }
          if (i>=0){ const cp=[...prev]; cp[i]={...cp[i],...merged}; return cp }
          return [...prev, merged]
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

  // helpers
  function patchOrdemLocal(id, patch) { setOrdens(prev => prev.map(o => o.id === id ? { ...o, ...patch } : o)); }
  function removeOrdemLocal(id) { setOrdens(prev => prev.filter(o => o.id !== id)); }
  function upsertFinalizadaLocal(row) { setFinalizadas(prev => { const i=prev.findIndex(o=>o.id===row.id); if(i>=0){const cp=[...prev]; cp[i]=row; return cp} return [row,...prev] }) }

  // expose derived data
  const ativosPorMaquina = useMemo(()=>{
    const map = Object.fromEntries(MAQUINAS.map(m=>[m,[]]))
    ordens.forEach(o=>{ if(!o.finalized) map[o.machine_id]?.push(o) })
    for(const m of MAQUINAS) map[m]=[...map[m]].sort((a,b)=>(a.pos??999)-(b.pos??999))
    return map
  },[ordens])

  const lastFinalizadoPorMaquina = useMemo(()=>{
    const map = Object.fromEntries(MAQUINAS.map(m=>[m,null]))
    for(const o of finalizadas){ if(!o.machine_id||!o.finalized_at) continue; const prev = map[o.machine_id] ? new Date(map[o.machine_id]).getTime() : 0; const cur = new Date(o.finalized_at).getTime(); if(cur>prev) map[o.machine_id]=o.finalized_at }
    return map
  },[finalizadas])

  const registroGrupos = useMemo(()=>{
    const byId = new Map(); const push = (o)=>{ if(!o) return; byId.set(o.id,{...o}) }
    finalizadas.forEach(push); ordens.forEach(o=>{ if(o.started_at) push(o) })
    const stopsByOrder = paradas.reduce((acc,st)=>{ (acc[st.order_id] ||= []).push(st); return acc },{})
    const arr = Array.from(byId.values())
    arr.sort((a,b)=>{
      const ta = new Date(a.finalized_at||a.restarted_at||a.interrupted_at||a.started_at||a.created_at||0).getTime()
      const tb = new Date(b.finalized_at||b.restarted_at||b.interrupted_at||b.started_at||b.created_at||0).getTime()
      return tb-ta
    })
    return arr.map(o=>({ ordem:o, stops:(stopsByOrder[o.id]||[]).sort((a,b)=>new Date(a.started_at)-new Date(b.started_at)) }))
  },[finalizadas, ordens, paradas])

  // ========================= Helpers/Actions internas =========================
  async function setStatus(ordem, novoStatus) {
    const patch = { status: novoStatus, stopped_at: null }
    if (novoStatus === 'PARADA') patch.stopped_at = new Date().toISOString()
    const before = { status: ordem.status, stopped_at: ordem.stopped_at }
    patchOrdemLocal(ordem.id, patch)
    const res = await supabase.from('orders').update(patch).eq('id', ordem.id).select('*').maybeSingle()
    if (res.error) { alert('Erro ao alterar status: ' + res.error.message); patchOrdemLocal(ordem.id, before) }
    if (res.data) patchOrdemLocal(res.data.id, res.data)
    return res
  }

  // ========================= Ações públicas (assinaturas mantidas) =========================

  async function criarOrdem(form, setForm, setTab){
    if(!form.code.trim()) return
    const { data: last, error: maxErr } = await supabase.from('orders').select('pos').eq('machine_id', form.machine_id).eq('finalized', false).order('pos',{ascending:false}).limit(1).maybeSingle()
    if (maxErr) { alert('Erro ao obter posição: ' + maxErr.message); return; }
    const nextPos = (last?.pos ?? -1) + 1
    const novo = { machine_id: form.machine_id, code: form.code, customer: form.customer, product: form.product, color: form.color, qty: form.qty, boxes: form.boxes, standard: form.standard, due_date: form.due_date || null, notes: form.notes, status: 'AGUARDANDO', pos: nextPos, finalized:false, started_at:null, started_by:null, restarted_at:null, restarted_by:null, interrupted_at:null, interrupted_by:null }
    const tempId = `tmp-${crypto.randomUUID()}`
    setOrdens(prev=>[...prev,{id:tempId, ...novo}])
    const res = await supabase.from('orders').insert([novo]).select('*').maybeSingle()
    if (res.error) { setOrdens(prev => prev.filter(o => o.id !== tempId)); alert('Erro ao criar ordem: ' + res.error.message); return }
    if (res.data) setOrdens(prev => prev.map(o => o.id === tempId ? res.data : o))
    setForm({code:'', customer:'', product:'', color:'', qty:'', boxes:'', standard:'', due_date:'', notes:'', machine_id:'P1'})
    setTab('painel')
  }

  async function atualizar(ordemParcial){
    const before = ordens.find(o => o.id === ordemParcial.id)
    if (!before) return
    if (before.machine_id !== ordemParcial.machine_id) {
      patchOrdemLocal(ordemParcial.id, { ...before, ...ordemParcial })
      const { data, error } = await supabase.rpc('orders_move_to_machine', { p_order_id: ordemParcial.id, p_target_machine: ordemParcial.machine_id, p_insert_at: null })
      if (error) { alert('Erro ao mover ordem de máquina: ' + error.message); patchOrdemLocal(before.id, before); return }
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
      // NOTE: não alteramos mais campos relacionados a baixa eficiência na tabela `orders`
    }).eq('id', ordemParcial.id).select('*').maybeSingle()

    if (res.error) { alert('Erro ao atualizar: ' + res.error.message); if (before) patchOrdemLocal(before.id, before); return }
    if (res.data) patchOrdemLocal(res.data.id, res.data)
  }

  async function finalizar(ordem, payload){
    const iso = localDateTimeToISO(payload.data, payload.hora)
    const p = { finalized:true, finalized_by: payload.por, finalized_at: iso }
    const before = ordens.find(o=>o.id===ordem.id)

    // Se houver baixa eficiência aberta, encerra o log no mesmo timestamp da finalização
    try {
      if (ordem.status === 'BAIXA_EFICIENCIA') {
        const key = `order_${ordem.id}`
        const sessionId = lowEffSessions?.[key]
        if (sessionId) {
          const upd = await supabase.from('low_efficiency_logs').update({ ended_at: iso }).eq('id', sessionId)
          if (upd.error) {
            // fallback: encerra por order_id quaisquer registros abertos
            await supabase.from('low_efficiency_logs').update({ ended_at: iso }).eq('order_id', ordem.id).is('ended_at', null)
          } else {
            // remove mapeamento local
            setLowEffSessions(prev => { const c = { ...prev }; delete c[key]; return c })
          }
        } else {
          // fallback direto
          await supabase.from('low_efficiency_logs').update({ ended_at: iso }).eq('order_id', ordem.id).is('ended_at', null)
        }
      }
    } catch (e) {
      console.warn('Falha ao encerrar baixa eficiência ao finalizar ordem:', e)
    }

    // Se houver PARADA aberta, encerra (resumed_at) no mesmo timestamp da finalização
    try {
      if (ordem.status === 'PARADA') {
        const sel = await supabase.from('machine_stops').select('*')
          .eq('order_id', ordem.id).is('resumed_at', null)
          .order('started_at', { ascending:false })
          .limit(1).maybeSingle()
        if (sel.data) {
          await supabase.from('machine_stops').update({ resumed_by: payload.por || 'Sistema', resumed_at: iso })
            .eq('id', sel.data.id)
        }
      }
    } catch (e) {
      console.warn('Falha ao encerrar parada ao finalizar ordem:', e)
    }

    removeOrdemLocal(ordem.id)
    upsertFinalizadaLocal({...ordem,...p})
    const res = await supabase.from('orders').update(p).eq('id', ordem.id).select('*').maybeSingle()
    if (res.error) { alert('Erro ao finalizar: ' + res.error.message); if(before) setOrdens(prev=>[before,...prev]); setFinalizadas(prev=>prev.filter(o=>o.id!==ordem.id)); return }
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
      const finalPos = novaFilaRestante.length + 1;
      const agoraISO = (data && hora)
        ? localDateTimeToISO(data, hora)
        : new Date().toISOString();
      // Se status atual é PARADA, encerra parada aberta
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
      // Se status atual é BAIXA_EFICIENCIA, encerra o log aberto
      if (ativa.status === 'BAIXA_EFICIENCIA') {
        try {
          const key = `order_${ativa.id}`
          const sessionId = lowEffSessions?.[key]
          if (sessionId) {
            const upd = await supabase.from('low_efficiency_logs').update({ ended_at: agoraISO }).eq('id', sessionId)
            if (upd.error) {
              await supabase.from('low_efficiency_logs').update({ ended_at: agoraISO }).eq('order_id', ativa.id).is('ended_at', null)
            } else {
              setLowEffSessions(prev => { const c = { ...prev }; delete c[key]; return c })
            }
          } else {
            await supabase.from('low_efficiency_logs').update({ ended_at: agoraISO }).eq('order_id', ativa.id).is('ended_at', null)
          }
        } catch (e) {
          console.warn('Erro ao encerrar baixa eficiência ao enviar para fila:', e)
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

  // ========================= Confirmadores (agora recebem payloads) =========================

  async function confirmarInicio({ ordem, operador, data, hora }) {
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
          // ao retomar normal, zera possíveis campos de baixa eficiência abertos (apenas localmente)
        }
      : {
          // primeiro início
          started_by: operador,
          started_at: iso,
          status: 'PRODUZINDO',
          interrupted_at: null, interrupted_by: null,
        }

    patchOrdemLocal(ordem.id, payload)
    const res = await supabase.from('orders').update(payload).eq('id', ordem.id).select('*').maybeSingle()
    if (res.error) { alert('Erro ao iniciar: '+res.error.message); return }
    if (res.data) patchOrdemLocal(res.data.id, res.data)
  }

  // Evita registrar parada com horário que se sobrepõe a outra parada da mesma máquina
  async function validarSobreposicaoParada({ machineId, startedAt }) {
    try {
      // existe parada em aberto?
      const open = await supabase.from('machine_stops')
        .select('id, started_at')
        .eq('machine_id', machineId)
        .is('resumed_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (open.error) {
        console.warn('Falha ao checar parada aberta:', open.error)
        return 'Não foi possível validar paradas em aberto. Tente novamente.'
      }
      if (open.data) {
        return 'Já existe uma parada aberta nesta máquina. Encerre antes de registrar outra.'
      }

      // verifica interseção: start existente <= novo start <= end existente
      const overlaps = await supabase.from('machine_stops')
        .select('id, started_at, resumed_at')
        .eq('machine_id', machineId)
        .lte('started_at', startedAt)
        .or(`resumed_at.is.null,resumed_at.gte.${startedAt}`)

      if (overlaps.error) {
        console.warn('Falha ao validar sobreposição de parada:', overlaps.error)
        return 'Não foi possível validar sobreposição de parada. Tente novamente.'
      }

      if (Array.isArray(overlaps.data) && overlaps.data.length > 0) {
        const hit = overlaps.data[0]
        const ini = new Date(hit.started_at).toLocaleString('pt-BR')
        const fim = hit.resumed_at ? new Date(hit.resumed_at).toLocaleString('pt-BR') : 'em aberto'
        return `Já existe uma parada registrada neste intervalo (${ini} - ${fim}). Ajuste a data/hora.`
      }
    } catch (err) {
      console.warn('Erro inesperado ao validar parada:', err)
      return 'Não foi possível validar sobreposição de parada agora.'
    }

    return null
  }

  async function confirmarParada({ ordem, operador, motivo, obs, data, hora, endLowEffAtStopStart }) {
    if (!operador || !data || !hora) { alert('Preencha operador, data e hora.'); return }
    if (!String(motivo || '').trim()) { alert('Selecione o motivo da parada.'); return }
    const started_at = localDateTimeToISO(data, hora)

    const overlapMsg = await validarSobreposicaoParada({ machineId: ordem.machine_id, startedAt: started_at })
    if (overlapMsg) { alert(overlapMsg); return }

    // 1) Se vier de baixa eficiência, encerra-a neste mesmo timestamp + limpa observação NO LOG NOVO
    if (endLowEffAtStopStart) {
      // tenta encerrar log associado
      try {
        const key = `order_${ordem.id}`
        const sessionId = lowEffSessions?.[key]
        if (sessionId) {
          await supabase.from('low_efficiency_logs').update({ ended_at: started_at }).eq('id', sessionId)
          // remove mapping
          setLowEffSessions(prev => { const c={...prev}; delete c[key]; return c })
        } else {
          // fallback: encerra registros abertos para essa ordem
          await supabase.from('low_efficiency_logs').update({ ended_at: started_at }).eq('order_id', ordem.id).is('ended_at', null)
        }
      } catch (e) {
        console.warn('Erro ao encerrar baixa eficiência automaticamente ao iniciar parada:', e)
      }
    }

    // 2) Registra parada
    const ins = await supabase.from('machine_stops')
      .insert([{ order_id: ordem.id, machine_id: ordem.machine_id, started_by: operador, started_at, reason: String(motivo).trim(), notes: obs }])
      .select('*').maybeSingle()
    if (ins.error) { alert('Erro ao registrar parada: ' + ins.error.message); return }

    // 3) Muda status para PARADA
    await setStatus(ordem, 'PARADA')
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
  }

  // ========================= NOVA LÓGICA: Baixa Eficiência no low_efficiency_logs =========================

  async function confirmarBaixaEf({ ordem, operador, data, hora, obs }) {
    if (!operador || !data || !hora) { alert('Preencha operador, data e hora.'); return }
    const started_at = localDateTimeToISO(data, hora);

    // Se status anterior era PARADA, encerra-a neste mesmo timestamp + limpa observação
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

    // 1) Inserir registro na tabela nova low_efficiency_logs
    try {
      const payload = {
        order_id: ordem.id,
        machine_id: ordem.machine_id,
        started_at,
        started_by: operador,
        notes: obs || null
      }
      const ins = await supabase.from('low_efficiency_logs').insert([payload]).select('*').maybeSingle()
      if (ins.error) {
        alert('Erro ao registrar baixa eficiência no log: ' + ins.error.message);
        return;
      }
      // salva id da sessão localmente para podermos encerrar exatamente esse registro depois
      if (ins.data && ins.data.id) {
        const key = `order_${ordem.id}`
        setLowEffSessions(prev => ({ ...prev, [key]: ins.data.id }))
      }
    } catch (e) {
      console.error('Erro ao inserir low_efficiency_logs:', e)
      alert('Erro ao gravar baixa eficiência.')
      return
    }

    // 2) Atualiza somente o status da order no banco (não grava campos de baixa no orders)
    patchOrdemLocal(ordem.id, {
      status: 'BAIXA_EFICIENCIA',
      // atualiza localmente campos para UI (não persistimos estes campos em orders)
      loweff_started_at: started_at,
      loweff_ended_at: null,
      loweff_by: operador,
      loweff_notes: obs || null
    })
    const res = await supabase.from('orders').update({ status: 'BAIXA_EFICIENCIA' }).eq('id', ordem.id).select('*').maybeSingle()
    if (res.error) { alert('Erro ao registrar baixa eficiência (status): ' + res.error.message); return; }
    if (res.data) patchOrdemLocal(res.data.id, res.data);
  }

  async function confirmarEncerrarBaixaEf({ ordem, targetStatus, data, hora }) {
    if (!data || !hora) { alert('Preencha data e hora.'); return }
    const ended_at = localDateTimeToISO(data, hora)

    // 1) Encerrar o registro em low_efficiency_logs
    try {
      const key = `order_${ordem.id}`
      const sessionId = lowEffSessions?.[key]
      if (sessionId) {
        const upd = await supabase.from('low_efficiency_logs').update({ ended_at }).eq('id', sessionId)
        if (upd.error) {
          console.warn('Falha ao encerrar log por id, tentando fallback:', upd.error)
          // fallback: encerrar por order_id
          await supabase.from('low_efficiency_logs').update({ ended_at }).eq('order_id', ordem.id).is('ended_at', null)
        } else {
          // remove mapping local
          setLowEffSessions(prev => { const c = { ...prev }; delete c[key]; return c })
        }
      } else {
        // fallback: encerra por order_id registros abertos
        await supabase.from('low_efficiency_logs').update({ ended_at }).eq('order_id', ordem.id).is('ended_at', null)
      }
    } catch (e) {
      console.warn('Erro ao encerrar baixa eficiência no log:', e)
      // não interrompe o fluxo — apenas loga
    }

    // 2) Atualiza localmente para UI e atualiza status na tabela orders (sem tocar campos loweff_* no banco)
    const patch = {
      status: targetStatus || 'PRODUZINDO',
      loweff_ended_at: ended_at,
      loweff_notes: null
    }
    const before = ordens.find(o=>o.id===ordem.id)
    patchOrdemLocal(ordem.id, patch)
    const res = await supabase.from('orders').update({ status: patch.status }).eq('id', ordem.id).select('*').maybeSingle()
    if (res.error) { alert('Erro ao encerrar baixa eficiência (status): ' + res.error.message); if(before) patchOrdemLocal(before.id, before) }
    if (res.data) patchOrdemLocal(res.data.id, res.data)
  }

  const onStatusChange = async (ordem, targetStatus) => {
    const atual = ordem.status
    if (jaIniciou(ordem) && targetStatus === 'AGUARDANDO') {
      return { action: 'alert', message: 'Após iniciar a produção, não é permitido voltar para "Aguardando".' }
    }

    if (targetStatus === 'BAIXA_EFICIENCIA' && atual !== 'BAIXA_EFICIENCIA') {
      const now = new Date()
      return {
        action: 'openLowEffModal',
        payload: {
          ordem,
          operador: '',
          obs: '',
          data: now.toISOString().slice(0,10),
          hora: now.toTimeString().slice(0,5),
        }
      }
    }

    if (atual === 'BAIXA_EFICIENCIA' && targetStatus === 'PRODUZINDO') {
      const now = new Date()
      return {
        action: 'openLowEffEndModal',
        payload: {
          ordem,
          targetStatus: 'PRODUZINDO',
          operador: '',
          data: now.toISOString().slice(0,10),
          hora: now.toTimeString().slice(0,5),
        }
      }
    }

    if (atual === 'BAIXA_EFICIENCIA' && targetStatus === 'PARADA') {
      const now = new Date()
      return {
        action: 'openStopModal',
        payload: {
          ordem,
          operador:'', motivo: MOTIVOS_PARADA[0], obs:'',
          data: now.toISOString().slice(0,10),
          hora: now.toTimeString().slice(0,5),
          endLowEffAtStopStart: true,
        }
      }
    }

    if (targetStatus === 'PARADA' && atual !== 'PARADA') {
      const now=new Date()
      return { action: 'openStopModal', payload: { ordem, operador:'', motivo: MOTIVOS_PARADA[0], obs:'', data: now.toISOString().slice(0,10), hora: now.toTimeString().slice(0,5) } }
    }

    if (atual === 'PARADA' && targetStatus !== 'PARADA') {
      const now = new Date();
      if (targetStatus === 'BAIXA_EFICIENCIA') {
        try {
          const sel = await supabase.from('machine_stops').select('*')
            .eq('order_id', ordem.id).is('resumed_at', null)
            .order('started_at', { ascending:false })
            .limit(1).maybeSingle();
          if (sel.data) {
            await supabase.from('machine_stops').update({ resumed_by: 'Sistema', resumed_at: now.toISOString() })
              .eq('id', sel.data.id);
          }
        } catch (e) {
          console.warn('Erro ao encerrar parada automaticamente:', e)
        }
        await setStatus(ordem, targetStatus);
        return { action: 'statusSet', newStatus: targetStatus }
      }
      return { action: 'openResumeModal', payload: { ordem, operador:'', data: now.toISOString().slice(0,10), hora: now.toTimeString().slice(0,5), targetStatus } }
    }

    await setStatus(ordem, targetStatus)
    return { action: 'statusSet', newStatus: targetStatus }
  }

  return {
    ordens, finalizadas, paradas,
    fetchOrdensAbertas, fetchOrdensFinalizadas, fetchParadas,
    criarOrdem, atualizar, enviarParaFila, finalizar,
    confirmarInicio, confirmarParada, confirmarRetomada, confirmarBaixaEf, confirmarEncerrarBaixaEf,
    ativosPorMaquina, registroGrupos, lastFinalizadoPorMaquina, onStatusChange
  }
}
