// src/abas/Registro.jsx
import { useState, useMemo } from 'react'
import PieChartIndicadores from '../components/PieChartIndicadores'
import { fmtDateTime, fmtDuracao } from '../lib/utils'
import { MAQUINAS } from '../lib/constants'

export default function Registro({ registroGrupos = [], openSet, toggleOpen }) {
  const [openMachines, setOpenMachines] = useState(new Set())
  const [periodo, setPeriodo] = useState('hoje')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [filtroMaquina, setFiltroMaquina] = useState('todas')

  // ---------- Helpers defensivos ----------
  const safe = v => {
    // trata null, undefined, string "NULL", string vazia como nulo
    if (v === null || v === undefined) return null
    if (typeof v === 'string' && (v.trim() === '' || v.toUpperCase() === 'NULL')) return null
    return v
  }

  const toTime = v => {
    // retorna null ou timestamp (ms)
    const s = safe(v)
    if (!s) return null
    const t = new Date(s).getTime()
    return Number.isFinite(t) ? t : null
  }

  // === Filtro de período ===
  function getPeriodoRange(p) {
    const now = new Date()
    let start = null, end = null
    if (p === 'hoje') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds())
    } else if (p === 'semana') {
      // Segunda-feira 00:00 até domingo 00:00
      const day = now.getDay() === 0 ? 7 : now.getDay() // domingo = 7
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (day - 1), 0, 0, 0, 0)
      const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7, 0, 0, 0, 0)
      start = monday
      end = now < sunday ? now : sunday // até agora ou domingo 00:00, o que vier primeiro
    } else if (p === 'mes') {
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
      end = now // até o horário atual
    } else if (p === 'mespassado') {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0)
      end = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
    } else if (p === 'custom') {
      start = customStart ? new Date(customStart) : null
      end = customEnd ? new Date(customEnd) : null
    }
    return { start, end }
  }

  // memoiza range do período
  const periodoRange = useMemo(() => getPeriodoRange(periodo), [periodo, customStart, customEnd])
  const filtroStart = periodoRange.start
  const filtroEnd = periodoRange.end

  // === Filtrar registroGrupos por período (defensivo) ===
  const gruposFiltrados = useMemo(() => {
    const source = Array.isArray(registroGrupos) ? registroGrupos : []
    if (!filtroStart || !filtroEnd) return source

    return source.filter(g => {
      const o = g.ordem || {}
      const iniMs = toTime(o.started_at)
      const fimMs = toTime(o.finalized_at)
      // Inclui ordens que:
      // - Foram iniciadas antes do fim do período
      // - E não foram finalizadas antes do início do período
      return (
        iniMs && iniMs < filtroEnd.getTime() &&
        (!fimMs || fimMs >= filtroStart.getTime())
      )
    })
  }, [registroGrupos, filtroStart, filtroEnd])

  // === Filtrar por máquina ===
  const gruposFiltradosMaquina = useMemo(() => {
    if (filtroMaquina === 'todas') return gruposFiltrados
    return gruposFiltrados.filter(g => {
      const m = g?.ordem?.machine_id || 'SEM MÁQ.'
      return String(m) === String(filtroMaquina)
    })
  }, [gruposFiltrados, filtroMaquina])

  // === Agrupar por máquina ===
  const gruposPorMaquina = {}
  for (const g of gruposFiltradosMaquina) {
    const m = g?.ordem?.machine_id || 'SEM MÁQ.'
    if (!gruposPorMaquina[m]) gruposPorMaquina[m] = []
    gruposPorMaquina[m].push(g)
  }

  // === Calcular totais gerais para o período filtrado ===
  let totalProdMs = 0, totalParadaMs = 0, totalLowEffMs = 0, totalSemProgMs = 0

  // helper para encontrar próxima ordem por started_at ordenada (garante próxima cronológica)
  const nextStartForMachine = (machineGroups, refTime) => {
    if (!Array.isArray(machineGroups) || machineGroups.length === 0) return null
    // cria lista ordenada por started_at asc
    const sorted = machineGroups
      .map(g => ({ g, t: toTime(g?.ordem?.started_at) || 0 }))
      .filter(x => x.t > refTime)
      .sort((a, b) => a.t - b.t)
    return sorted.length ? sorted[0].g : null
  }

  // Função para verificar se um horário está dentro do intervalo de fim de semana
  function isWeekendTime(timestamp) {
    const date = new Date(timestamp);
    const day = date.getDay(); // 0 = Domingo, 6 = Sábado
    const hours = date.getHours();

    // Sábado após 13:00
    if (day === 6 && hours >= 13) {
      return true;
    }

    // Domingo até 23:00
    if (day === 0 && hours < 23) {
      return true;
    }

    return false;
  }

  // Função para descontar o tempo de fim de semana
  function descontarFimDeSemana(iniCalc, fimCalc) {
    let desconto = 0;
    let current = iniCalc;

    while (current < fimCalc) {
      if (isWeekendTime(current)) {
        const nextHour = new Date(current);
        nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
        desconto += Math.min(nextHour.getTime(), fimCalc) - current;
        current = nextHour.getTime();
      } else {
        const nextCheck = new Date(current);
        nextCheck.setHours(nextCheck.getHours() + 1, 0, 0, 0);
        current = Math.min(nextCheck.getTime(), fimCalc);
      }
    }

    return desconto;
  }

  for (const m of Object.keys(gruposPorMaquina)) {
    gruposPorMaquina[m].forEach(g => {
      const o = g.ordem || {}
      // inicio e fim (se não finalizada, usa now)
      let iniMs = toTime(o.started_at)
      let fimMs = toTime(o.finalized_at) || Date.now()
      // Limita intervalo ao filtro
      if (iniMs && fimMs) {
        const iniCalc = Math.max(iniMs, filtroStart.getTime())
        const fimCalc = Math.min(fimMs, filtroEnd.getTime())
        // Só calcula se a O.P. está realmente produzindo dentro do intervalo e não foi interrompida
        const interrompida = safe(o.interrupted_at) && toTime(o.interrupted_at) <= fimCalc;
        if (fimCalc > iniCalc && fimCalc > filtroStart.getTime() && !interrompida) {
          let prodMs = fimCalc - iniCalc
          // Desconta paradas
          ;(g.stops || []).forEach(st => {
            const stIni = toTime(st.started_at)
            const stFim = toTime(st.resumed_at) || fimMs
            const stIniCalc = Math.max(stIni || iniCalc, iniCalc)
            const stFimCalc = Math.min(stFim || fimCalc, fimCalc)
            if (stIniCalc < stFimCalc) {
              const delta = Math.max(0, stFimCalc - stIniCalc)
              prodMs -= delta
              totalParadaMs += delta
              // LOG DE DEBUG PARADA
              console.log(`[DEBUG] Parada O.P.: ${o.code} | stIniCalc: ${new Date(stIniCalc).toLocaleString()} | stFimCalc: ${new Date(stFimCalc).toLocaleString()} | delta: ${(delta/1000/60/60).toFixed(2)}h`)
            }
          })
          // Desconta baixa eficiência
          if (safe(o.loweff_started_at)) {
            const leIni = toTime(o.loweff_started_at)
            const leFim = toTime(o.loweff_ended_at) || fimMs
            const leIniCalc = Math.max(leIni || iniCalc, iniCalc)
            const leFimCalc = Math.min(leFim || fimCalc, fimCalc)
            if (leIniCalc < leFimCalc) {
              const delta = Math.max(0, leFimCalc - leIniCalc)
              prodMs -= delta
              totalLowEffMs += delta
            }
          }
          // Desconta o tempo de fim de semana
          // LOG DE DEBUG PARA ENTRADA E SAÍDA DA FUNÇÃO descontarFimDeSemana
          console.log(`[DEBUG] Máquina: ${m} | O.P.: ${o.code} | iniCalc: ${new Date(iniCalc).toLocaleString()} | fimCalc: ${new Date(fimCalc).toLocaleString()}`);
          const descontoFimDeSemana = descontarFimDeSemana(iniCalc, fimCalc);
          console.log(`[DEBUG] Máquina: ${m} | O.P.: ${o.code} | Desconto Fim de Semana: ${(descontoFimDeSemana / 1000 / 60 / 60).toFixed(2)}h`);
          prodMs -= descontoFimDeSemana;
          totalProdMs += Math.max(0, prodMs)
        }
      }

      // Tempo sem programação: entre finalized_at (se existir) e próxima started_at (ou fim do período)
      const finalizedMs = toTime(o.finalized_at)
      if (finalizedMs) {
        // busca próxima ordem na mesma máquina (cronologicamente depois de finalizedMs)
        const prox = nextStartForMachine(gruposPorMaquina[m], finalizedMs)
        const semProgFim = prox ? (toTime(prox.ordem.started_at) || filtroEnd?.getTime() || Date.now()) : (filtroEnd?.getTime() || Date.now())
        const delta = Math.max(0, semProgFim - finalizedMs)
        totalSemProgMs += delta
      }
    })
  }

  // Conversão para horas
  const totalProdH = totalProdMs / 1000 / 60 / 60
  const totalParadaH = totalParadaMs / 1000 / 60 / 60
  const totalLowEffH = totalLowEffMs / 1000 / 60 / 60
  const totalSemProgH = totalSemProgMs / 1000 / 60 / 60
  const totalH = totalProdH + totalParadaH + totalLowEffH + totalSemProgH

  // Percentuais
  const pct = v => totalH ? ((v / totalH) * 100).toFixed(1) : '0.0'

  // === Toggle individual de máquina ===
  function toggleMachine(m) {
    setOpenMachines(prev => {
      const n = new Set(prev)
      if (n.has(m)) n.delete(m)
      else n.add(m)
      return n
    })
  }

  // Helper para timestamp de "recência" da O.P. (ordenação das linhas) — usa toTime defensivo
  function tsOP(o) {
    return new Date(
      toTime(o.finalized_at) ||
      toTime(o.restarted_at) ||      // reinício conta como atividade recente
      toTime(o.interrupted_at) ||    // envio para fila também conta
      toTime(o.started_at) ||
      toTime(o.created_at) ||
      0
    ).getTime()
  }

  return (
    <div className="card registro-wrap">
      <div className="card">
        <div className="label" style={{ marginBottom: 8 }}>
          Histórico de Produção por Máquina
        </div>
        {/* Filtro de período e máquina */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <div className="select-wrap">
            <select
              className="period-select"
              aria-label="Selecionar período"
              value={periodo}
              onChange={e => setPeriodo(e.target.value)}
            >
              <option value="hoje">Hoje</option>
              <option value="semana">Esta Semana</option>
              <option value="mes">Este Mês</option>
              <option value="mespassado">Mês Passado</option>
              <option value="custom">Intervalo personalizado</option>
            </select>
          </div>

          {periodo === 'custom' && (
            <>
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} />
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
            </>
          )}

          {/* Filtro por máquina */}
          <div className="select-wrap">
            <select
              className="period-select"
              aria-label="Filtrar por máquina"
              value={filtroMaquina}
              onChange={e => setFiltroMaquina(e.target.value)}
            >
              <option value="todas">Todas as máquinas</option>
              {MAQUINAS.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Relatório geral do período */}
        <div className="card" style={{ marginBottom: 16, background: '#f6f6f6', padding: 16 }}>
          <div className="label" style={{ marginBottom: 8 }}>Resumo do Período</div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <PieChartIndicadores
                data={[
                  { label: 'Produzindo', value: totalProdH, color: '#0a7' },
                  { label: 'Parada', value: totalParadaH, color: '#e74c3c' },
                  { label: 'Baixa Eficiência', value: totalLowEffH, color: '#ffc107' },
                  { label: 'Sem Programação', value: totalSemProgH, color: '#3498db' },
                ]}
              />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                <span style={{ color: '#0a7' }}>■ Produzindo</span>
                <span style={{ color: '#e74c3c' }}>■ Parada</span>
                <span style={{ color: '#ffc107' }}>■ Baixa Eficiência</span>
                <span style={{ color: '#3498db' }}>■ Sem Programação</span>
              </div>
            </div>
            <div>
              <div><b>Tempo produzindo:</b> {totalProdH.toFixed(2)} h ({pct(totalProdH)}%)</div>
              <div><b>Tempo parada:</b> {totalParadaH.toFixed(2)} h ({pct(totalParadaH)}%)</div>
              <div><b>Tempo baixa eficiência:</b> {totalLowEffH.toFixed(2)} h ({pct(totalLowEffH)}%)</div>
              <div><b>Tempo sem programação:</b> {totalSemProgH.toFixed(2)} h ({pct(totalSemProgH)}%)</div>
              <div><b>Total:</b> {totalH.toFixed(2)} h</div>
            </div>
          </div>
        </div>

        {/* Mensagem se não há registros */}
        {(!Array.isArray(gruposFiltrados) || gruposFiltrados.length === 0) ? (
          <div className="row muted" style={{ padding: '32px 0', textAlign: 'center', fontSize: 18 }}>
            Nenhum registro encontrado para o período selecionado.
          </div>
        ) : (
          MAQUINAS.map(m => {
            // Se filtro de máquina está ativo, só renderiza a máquina selecionada
            if (filtroMaquina !== 'todas' && m !== filtroMaquina) return null;
            const grupos = (gruposPorMaquina[m] || []).slice().sort((a, b) => tsOP(b.ordem) - tsOP(a.ordem));
            const aberto = openMachines.has(m);
            return (
              <div key={m} className="registro-maquina-bloco" style={{ marginBottom: 16 }}>
                <div
                  className="maquina-head"
                  onClick={() => toggleMachine(m)}
                  style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <div>{aberto ? '▾' : '▸'} Máquina {m} ({grupos.length || 0} O.P.)</div>
                </div>

                {aberto && (
                  <>
                    <div className="table">
                      <div className="thead" style={{ gridTemplateColumns: '140px 1fr 140px 140px 80px' }}>
                        <div>O.P</div>
                        <div>Cliente / Produto / Cor / Qtd</div>
                        <div>Início</div>
                        <div>Fim</div>
                        <div>Abrir</div>
                      </div>
                    </div>

                    <div className="tbody">
                      {grupos.length === 0 && (
                        <div className="row muted" style={{ gridColumn: '1 / -1', padding: '8px 0', textAlign: 'center' }}>
                          Nenhuma O.P. registrada nesta máquina.
                        </div>
                      )}

                      {grupos.map(gr => {
                        const o = gr.ordem || {}
                        const events = []

                        // 1) Início
                        if (safe(o.started_at)) {
                          events.push({
                            id: `start-${o.id}`,
                            type: 'start',
                            title: 'Início da produção',
                            when: o.started_at,
                            who: o.started_by || '-'
                          })
                        }

                        // 2) Produção interrompida (envio pra fila)
                        if (safe(o.interrupted_at)) {
                          events.push({
                            id: `interrupt-${o.id}`,
                            type: 'interrupt',
                            title: 'Produção interrompida',
                            when: o.interrupted_at,
                            who: o.interrupted_by || '-'
                          })
                        }

                        // 3) Reinício (após interrupção)
                        if (safe(o.restarted_at)) {
                          events.push({
                            id: `restart-${o.id}`,
                            type: 'restart',
                            title: 'Reinício da produção',
                            when: o.restarted_at,
                            who: o.restarted_by || '-'
                          })
                        }

                        // 4) Baixa eficiência (período)
                        if (safe(o.loweff_started_at)) {
                          events.push({
                            id: `loweff-${o.id}`,
                            type: 'loweff',
                            title: 'Baixa eficiência',
                            when: o.loweff_started_at,
                            end: safe(o.loweff_ended_at) ? o.loweff_ended_at : null,
                            who: o.loweff_by || '-',
                            notes: o.loweff_notes || ''
                          })
                        }

                        // 5) Paradas (podem existir várias)
                        ;(gr.stops || []).forEach(st => {
                          if (safe(st.started_at)) {
                            events.push({
                              id: `stop-${st.id}`,
                              type: 'stop',
                              title: 'Parada',
                              when: st.started_at,
                              end: safe(st.resumed_at) ? st.resumed_at : null,
                              who: st.started_by || '-',
                              reason: st.reason || '-',
                              notes: st.notes || ''
                            })
                          }
                        })

                        // 6) Fim
                        if (safe(o.finalized_at)) {
                          events.push({
                            id: `end-${o.id}`,
                            type: 'end',
                            title: 'Fim da produção',
                            when: o.finalized_at,
                            who: o.finalized_by || '-'
                          })
                        }

                        if (!events.length) {
                          events.push({ id: `empty-${o.id}`, type: 'empty', title: 'Sem eventos', when: null })
                        }

                        // Ordena cartões por data/hora (mais antigo → mais novo)
                        events.sort((a, b) => {
                          const ta = toTime(a.when) || 0
                          const tb = toTime(b.when) || 0
                          return ta - tb
                        })

                        return (
                          <div key={o.id} style={{ display: 'contents' }}>
                            <div
                              className="row grupo-head"
                              style={{ gridTemplateColumns: '140px 1fr 140px 140px 80px', cursor: 'pointer' }}
                              onClick={() => toggleOpen(o.id)}
                            >
                              <div>{o.code}</div>
                              <div>{[o.customer, o.product, o.color, o.qty].filter(Boolean).join(' • ') || '-'}</div>
                              <div>
                                {safe(o.started_at) ? (
                                  (() => {
                                    const dt = fmtDateTime(o.started_at)
                                    const [data, hora] = dt.split(' ')
                                    return <span>{data}<br />{hora}</span>
                                  })()
                                ) : '-'}
                              </div>
                              <div>
                                {safe(o.finalized_at) ? (
                                  (() => {
                                    const dt = fmtDateTime(o.finalized_at)
                                    const [data, hora] = dt.split(' ')
                                    return <span>{data}<br />{hora}</span>
                                  })()
                                ) : '-'}
                              </div>
                              <div>{openSet.has(o.id) ? '▲' : '▼'}</div>
                            </div>

                            {openSet.has(o.id) && (
                              <div className="row" style={{ gridColumn: '1 / -1', background: '#fafafa' }}>
                                <div className="timeline">
                                  {events.map(ev => {
                                    if (ev.type === 'empty') {
                                      return (
                                        <div key={ev.id} className="tl-card tl-empty">
                                          <div className="tl-title">Sem eventos</div>
                                          <div className="tl-meta muted">Esta O.P ainda não possui início, paradas ou fim registrados.</div>
                                        </div>
                                      )
                                    }

                                    if (ev.type === 'start') {
                                      return (
                                        <div key={ev.id} className="tl-card tl-start">
                                          <div className="tl-title">🚀 {ev.title}</div>
                                          <div className="tl-meta"><b>Data/Hora:</b> {fmtDateTime(ev.when)}</div>
                                          <div className="tl-meta"><b>Operador:</b> {ev.who}</div>
                                        </div>
                                      )
                                    }

                                    if (ev.type === 'restart') {
                                      return (
                                        <div key={ev.id} className="tl-card tl-start">
                                          <div className="tl-title">🔁 {ev.title}</div>
                                          <div className="tl-meta"><b>Data/Hora:</b> {fmtDateTime(ev.when)}</div>
                                          <div className="tl-meta"><b>Operador:</b> {ev.who}</div>
                                        </div>
                                      )
                                    }

                                    if (ev.type === 'loweff') {
                                      const dur = ev.end ? fmtDuracao(ev.when, ev.end) : '-'
                                      return (
                                        <div key={ev.id} className="tl-card tl-interrupt">
                                          <div className="tl-title">🟡 {ev.title}</div>
                                          <div className="tl-meta"><b>Início:</b> {fmtDateTime(ev.when)}</div>
                                          <div className="tl-meta"><b>Fim:</b> {ev.end ? fmtDateTime(ev.end) : '— (em aberto)'}</div>
                                          <div className="tl-meta"><b>Duração:</b> {dur}</div>
                                          <div className="tl-meta"><b>Operador:</b> {ev.who}</div>
                                          {ev.notes ? <div className="tl-notes">{ev.notes}</div> : null}
                                        </div>
                                      )
                                    }

                                    if (ev.type === 'stop') {
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

                                    if (ev.type === 'interrupt') {
                                      return (
                                        <div key={ev.id} className="tl-card tl-interrupt">
                                          <div className="tl-title">🟡 {ev.title}</div>
                                          <div className="tl-meta"><b>Data/Hora:</b> {fmtDateTime(ev.when)}</div>
                                          <div className="tl-meta"><b>Registrado por:</b> {ev.who}</div>
                                          <div className="tl-meta muted">A O.P foi removida do painel e enviada ao fim da fila.</div>
                                        </div>
                                      )
                                    }

                                    // end
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
                  </>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
