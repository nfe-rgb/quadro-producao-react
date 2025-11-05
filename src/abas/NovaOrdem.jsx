// src/abas/NovaOrdem.jsx
import { MAQUINAS } from '../lib/constants'

export default function NovaOrdem({ form, setForm, criarOrdem }) {
  return (
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
  )
}
