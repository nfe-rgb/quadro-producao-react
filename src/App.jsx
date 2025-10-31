import { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient.js';

const MAQUINAS = ['P1','P2','P3','I1','I2','I3','I4','I5','I6']

export default function App() {
  const [ordens, setOrdens] = useState([])
  const [form, setForm] = useState({
    code:'', customer:'', product:'', color:'', qty:'', boxes:'', standard:'',
    due_date:'', notes:'', machine_id:'P1'
  })

  async function fetchOrdens() {
    const { data } = await supabase
      .from('orders').select('*').eq('finalized', false)
      .order('pos', { ascending: true }).order('created_at', { ascending: true })
    setOrdens(data || [])
  }

  useEffect(() => {
    fetchOrdens()
    const ch = supabase.channel('orders-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, fetchOrdens)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  async function criarOrdem() {
    if (!form.code.trim()) return
    const count = ordens.filter(o => o.machine_id === form.machine_id).length
    await supabase.from('orders').insert([{
      machine_id: form.machine_id, code: form.code,
      customer: form.customer, product: form.product, color: form.color,
      qty: form.qty, boxes: form.boxes, standard: form.standard,
      due_date: form.due_date || null, notes: form.notes,
      status: 'PRODUZINDO', pos: count
    }])
    setForm({ code:'', customer:'', product:'', color:'', qty:'', boxes:'', standard:'', due_date:'', notes:'', machine_id:'P1' })
  }

  async function mudarStatus(id, novo) {
    await supabase.from('orders').update({ status: novo }).eq('id', id)
  }
  async function finalizar(id, por) {
    const now = new Date(), data = now.toISOString().slice(0,10), hora = now.toTimeString().slice(0,5)
    await supabase.from('orders').update({ finalized: true, finalized_by: por || 'Operador', finalized_at: `${data}T${hora}:00` }).eq('id', id)
  }

  return (
    <div style={{padding:16}}>
      <h1>Painel de Produção</h1>

      <fieldset style={{display:'grid', gap:8, maxWidth:800, padding:12, border:'1px solid #ddd'}}>
        <legend><b>Nova ordem</b></legend>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
          <input placeholder="Código" value={form.code} onChange={e=>setForm(f=>({...f, code:e.target.value}))}/>
          <select value={form.machine_id} onChange={e=>setForm(f=>({...f, machine_id:e.target.value}))}>
            {MAQUINAS.map(m=><option key={m} value={m}>{m}</option>)}
          </select>
          <input placeholder="Cliente" value={form.customer} onChange={e=>setForm(f=>({...f, customer:e.target.value}))}/>
          <input placeholder="Produto" value={form.product} onChange={e=>setForm(f=>({...f, product:e.target.value}))}/>
          <input placeholder="Cor" value={form.color} onChange={e=>setForm(f=>({...f, color:e.target.value}))}/>
          <input placeholder="Quantidade" value={form.qty} onChange={e=>setForm(f=>({...f, qty:e.target.value}))}/>
          <input placeholder="Caixas" value={form.boxes} onChange={e=>setForm(f=>({...f, boxes:e.target.value}))}/>
          <input placeholder="Padrão" value={form.standard} onChange={e=>setForm(f=>({...f, standard:e.target.value}))}/>
          <input type="date" value={form.due_date} onChange={e=>setForm(f=>({...f, due_date:e.target.value}))}/>
          <input placeholder="Observações" value={form.notes} onChange={e=>setForm(f=>({...f, notes:e.target.value}))}/>
        </div>
        <button onClick={criarOrdem}>Adicionar</button>
      </fieldset>

      <h3 style={{marginTop:24}}>Ordens (ativas + fila)</h3>
      <div style={{display:'grid', gap:8}}>
        {ordens.map(o=>(
          <div key={o.id} style={{border:'1px solid #ccc', padding:8}}>
            <div><b>{o.machine_id}</b> — {o.code}</div>
            <div style={{fontSize:13}}>Status: {o.status}</div>
            <div style={{display:'flex', gap:8, marginTop:8}}>
              <button onClick={()=>mudarStatus(o.id,'PRODUZINDO')}>Produzindo</button>
              <button onClick={()=>mudarStatus(o.id,'FORA_DE_CICLO')}>Fora de Ciclo</button>
              <button onClick={()=>mudarStatus(o.id,'PARADA')}>Parada</button>
              <button onClick={()=>finalizar(o.id,'Operador')}>Finalizar</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
