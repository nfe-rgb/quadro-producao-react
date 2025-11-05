// src/abas/Painel.jsx
import Etiqueta from '../components/Etiqueta'
import { MAQUINAS, STATUS } from '../lib/constants'
import { statusClass, jaIniciou } from '../lib/utils'

export default function Painel({ ativosPorMaquina, paradas, tick, onStatusChange, setStartModal, setFinalizando }) {
  return (
    <div className="board">
      {MAQUINAS.map(m=>{
        const lista = (ativosPorMaquina[m] ?? [])
        const ativa = lista[0] || null
        const openStop = ativa ? paradas.find(p=>p.order_id===ativa.id && !p.resumed_at) : null
        const sinceMs = openStop ? new Date(openStop.started_at).getTime() : null
        const durText = sinceMs ? (()=>{
          // eslint-disable-next-line no-unused-vars
          const _ = tick
          const total = Math.max(0, Math.floor((Date.now() - sinceMs)/1000))
          const h = String(Math.floor(total/3600)).padStart(2,'0')
          const mn = String(Math.floor((total%3600)/60)).padStart(2,'0')
          const s = String(total%60).padStart(2,'0')
          return `${h}:${mn}:${s}`
        })() : null

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
  )
}
