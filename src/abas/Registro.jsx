// src/abas/Registro.jsx
import { fmtDateTime, fmtDuracao } from '../lib/utils'

export default function Registro({ registroGrupos, openSet, toggleOpen }) {
  return (
    <div className="card registro-wrap">
      <div className="card">
        <div className="label" style={{marginBottom:8}}>Histórico por Ordem de Produção</div>

        <div className="table">
          <div className="thead" style={{gridTemplateColumns:'140px 1fr 140px 140px 80px'}}>
            <div>O.P</div>
            <div>Cliente / Produto / Cor / Qtd</div>
            <div>Início</div>
            <div>Fim</div>
            <div>Abrir</div>
          </div>
        </div>

        <div className="tbody">
          {registroGrupos.length===0 && (
            <div className="row muted" style={{gridColumn:'1 / -1', padding:'8px 0'}}>
              Sem registros ainda.
            </div>
          )}

          {registroGrupos.map(gr=>{
            const o = gr.ordem

            const events = []
            if (o.started_at) {
              events.push({ id:`start-${o.id}`, type:'start', title:'Início da produção', when:o.started_at, who:o.started_by||'-' })
            }
            if (gr.stops.length) {
              gr.stops.forEach(st=>{
                events.push({
                  id:`stop-${st.id}`, type:'stop', title:'Parada', when:st.started_at, end:st.resumed_at||null,
                  who: st.started_by||'-', reason: st.reason||'-', notes: st.notes||''
                })
              })
            }
            if (o.finalized_at) {
              events.push({ id:`end-${o.id}`, type:'end', title:'Fim da produção', when:o.finalized_at, who:o.finalized_by||'-' })
            }
            if (!events.length) { events.push({ id:`empty-${o.id}`, type:'empty', title:'Sem eventos', when:null }) }

            return (
              <div key={o.id} style={{display:'contents'}}>
                <div
                  className="row grupo-head"
                  style={{gridTemplateColumns:'140px 1fr 140px 140px 80px', cursor:'pointer'}}
                  onClick={()=>toggleOpen(o.id)}
                >
                  <div>{o.code}</div>
                  <div>{[o.customer,o.product,o.color,o.qty].filter(Boolean).join(' • ') || '-'}</div>
                  <div>{o.started_at ? fmtDateTime(o.started_at) : '-'}</div>
                  <div>{o.finalized_at ? fmtDateTime(o.finalized_at) : '-'}</div>
                  <div>{openSet.has(o.id) ? '▲' : '▼'}</div>
                </div>

                {openSet.has(o.id) && (
                  <div className="row" style={{gridColumn:'1 / -1', background:'#fafafa'}}>
                    <div className="timeline">
                      {events.map(ev=>{
                        if (ev.type==='empty') {
                          return (
                            <div key={ev.id} className="tl-card tl-empty">
                              <div className="tl-title">Sem eventos</div>
                              <div className="tl-meta muted">Esta O.P ainda não possui início, paradas ou fim registrados.</div>
                            </div>
                          )
                        }
                        if (ev.type==='start') {
                          return (
                            <div key={ev.id} className="tl-card tl-start">
                              <div className="tl-title">🚀 {ev.title}</div>
                              <div className="tl-meta"><b>Data/Hora:</b> {fmtDateTime(ev.when)}</div>
                              <div className="tl-meta"><b>Operador:</b> {ev.who}</div>
                            </div>
                          )
                        }
                        if (ev.type==='stop') {
                          const dur = ev.end ? fmtDuracao(ev.when, ev.end) : '-'
                          return (
                            <div key={ev.id} className="tl-card tl-stop">
                              <div className="tl-title">⛔ {ev.title}</div>
                              <div className="tl-meta"><b>Início:</b> {fmtDateTime(ev.when)}</div>
                              <div className="tl-meta"><b>Fim:</b> {ev.end ? fmtDateTime(ev.end) : '— (em aberto)'}</div>
                              <div className="tl-meta"><b>Duração:</b> {dur}</div>
                              <div className="tl-meta"><b>Operador:</b> {ev.who}</div>
                              <div className="tl-meta"><b>Motivo:</b> {ev.reason}</div>
                              {ev.notes ? <div className="tl-notes">{ev.notes}</div> : null}
                            </div>
                          )
                        }
                        return (
                          <div key={ev.id} className="tl-card tl-end">
                            <div className="tl-title">🏁 {ev.title}</div>
                            <div className="tl-meta"><b>Data/Hora:</b> {fmtDateTime(ev.when)}</div>
                            <div className="tl-meta"><b>Operador:</b> {ev.who}</div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
