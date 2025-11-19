// src/abas/Registro.jsx
import { useState, useMemo, useEffect } from 'react'
import PieChartIndicadores from '../components/PieChartIndicadores'
import { fmtDateTime, fmtDuracao } from '../lib/utils'
import { MAQUINAS } from '../lib/constants'

export default function Registro({ registroGrupos = [], openSet, toggleOpen }) {
  // Timer para atualização automática dos tempos em aberto
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 1000); // 1 segundo
    return () => clearInterval(interval);
  }, []);
  const [hoveredIndicador, setHoveredIndicador] = useState(null);

  // local fallback: conjunto de ordens expandidas (quando props não forem fornecidas)
  const [localOpenSet, setLocalOpenSet] = useState(() => new Set())

  // retorna um toggle local para manter compatibilidade caso não receba toggleOpen por prop
  const localToggleOpen = (id) => {
    setLocalOpenSet(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  // decide quais valores/handlers usar: props têm prioridade, senão usa local
  const effectiveOpenSet = openSet ?? localOpenSet
  const effectiveToggleOpen = toggleOpen ?? localToggleOpen

  const [openMachines, setOpenMachines] = useState(new Set())
  const [periodo, setPeriodo] = useState('hoje')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [filtroMaquina, setFiltroMaquina] = useState('todas')

  // ---------- Helpers defensivos ----------
  const safe = v => {
    if (v === null || v === undefined) return null
    if (typeof v === 'string' && (v.trim() === '' || v.toUpperCase() === 'NULL')) return null
    return v
  }

  const toTime = v => {
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
    } else if (p === 'ontem') {
      const ontem = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0)
      start = new Date(ontem.getFullYear(), ontem.getMonth(), ontem.getDate(), 0, 0, 0, 0)
      end = new Date(ontem.getFullYear(), ontem.getMonth(), ontem.getDate(), 23, 59, 59, 999)
    } else if (p === 'semana') {
      const day = now.getDay() === 0 ? 7 : now.getDay()
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (day - 1), 0, 0, 0, 0)
      const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7, 0, 0, 0, 0)
      start = monday
      end = now < sunday ? now : sunday
    } else if (p === 'mes') {
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
      end = now
    } else if (p === 'mespassado') {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0)
      end = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
    } else if (p === 'custom') {
      start = customStart ? new Date(customStart) : null
      end = customEnd ? new Date(customEnd) : null
    }
    return { start, end }
  }

  const periodoRange = useMemo(() => getPeriodoRange(periodo), [periodo, customStart, customEnd, tick])
  const filtroStart = periodoRange.start
  const filtroEnd = periodoRange.end

  // === Filtrar registroGrupos por período (defensivo) ===
  const gruposFiltrados = useMemo(() => {
    const source = Array.isArray(registroGrupos) ? registroGrupos : []
    if (periodo === 'custom' && (!customStart || !customEnd)) return []
    if (!filtroStart || !filtroEnd) return source

    return source.filter(g => {
      const o = g.ordem || {}
      const iniMs = toTime(o.started_at)
      const fimMs = toTime(o.finalized_at)
      const hasOpenStop = (g.stops || []).some(st => {
        const stIni = toTime(st.started_at)
        const emAberto = !safe(st.resumed_at)
        return emAberto && stIni < filtroEnd.getTime() && filtroStart.getTime() < filtroEnd.getTime()
      })
      return (
        (iniMs && iniMs < filtroEnd.getTime() && (!fimMs || fimMs >= filtroStart.getTime()))
        || hasOpenStop
      )
    })
  }, [registroGrupos, filtroStart, filtroEnd, tick])

  // === Filtrar por máquina ===
  const gruposFiltradosMaquina = useMemo(() => {
    if (filtroMaquina === 'todas') return gruposFiltrados
    return gruposFiltrados.filter(g => {
      const m = g?.ordem?.machine_id || 'SEM MÁQ.'
      return String(m) === String(filtroMaquina)
    })
  }, [gruposFiltrados, filtroMaquina, tick])

  // === Agrupar por máquina ===
  const gruposPorMaquina = {}
  for (const g of gruposFiltradosMaquina) {
    const m = g?.ordem?.machine_id || 'SEM MÁQ.'
    if (!gruposPorMaquina[m]) gruposPorMaquina[m] = []
    gruposPorMaquina[m].push(g)
  }

  // === Calcular totais gerais para o período filtrado ===
  const {
  totalProdH,
  totalParadaH,
  totalLowEffH,
  totalSemProgH,
  totalH,
  totalDisponivelH,
  pct,
  totalMaquinasParadas,
  machineParadaMs
} = useMemo(() => {
  let totalProdMs = 0, totalParadaMs = 0, totalLowEffMs = 0, totalSemProgMs = 0;
  const machineParadaMs = {};

  const nextStartForMachine = (machineGroups, refTime) => {
    if (!Array.isArray(machineGroups) || machineGroups.length === 0) return null;
    const sorted = machineGroups
      .map(g => ({ g, t: toTime(g?.ordem?.started_at) || 0 }))
      .filter(x => x.t > refTime)
      .sort((a, b) => a.t - b.t);
    return sorted.length ? sorted[0].g : null;
  };

  function isWeekendTime(timestamp) {
    const date = new Date(timestamp);
    const day = date.getDay();
    const hours = date.getHours();
    if (day === 6 && hours >= 13) return true;
    if (day === 0 && hours < 23) return true;
    return false;
  }

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
    const gruposOrdenados = gruposPorMaquina[m].slice().sort((a, b) => {
      const ta = toTime(a?.ordem?.started_at) || 0;
      const tb = toTime(b?.ordem?.started_at) || 0;
      return ta - tb;
    });
    let paradaMsMaquina = 0;
    gruposOrdenados.forEach((g, idx) => {
      const o = g.ordem || {};
      const intervals = [];
      let lastStart = toTime(o.started_at);
      let lastEnd = null;

      const paradaIntervalsAbertas = (g.stops || []).map(st => {
        const stIni = toTime(st.started_at);
        const emAberto = !safe(st.resumed_at);
        if (emAberto && stIni < filtroEnd.getTime()) {
          const ini = stIni < filtroStart.getTime() ? filtroStart.getTime() : stIni;
          const fim = filtroEnd.getTime();
          return ini < fim ? [ini, fim] : null;
        }
        return null;
      }).filter(Boolean);

      function unirIntervalos(intervalos) {
        if (!intervalos.length) return [];
        intervalos.sort((a, b) => a[0] - b[0]);
        const unidos = [intervalos[0]];
        for (let i = 1; i < intervalos.length; i++) {
          const ultimo = unidos[unidos.length - 1];
          const atual = intervalos[i];
          if (atual[0] <= ultimo[1]) {
            ultimo[1] = Math.max(ultimo[1], atual[1]);
          } else {
            unidos.push([...atual]);
          }
        }
        return unidos;
      }

      const paradaUnidaAbertas = unirIntervalos(paradaIntervalsAbertas);
      let deltaParadaAbertas = 0;
      paradaUnidaAbertas.forEach(([ini, fim]) => {
        deltaParadaAbertas += Math.max(0, fim - ini);
      });
      paradaMsMaquina += deltaParadaAbertas;

      if (!lastStart) {
        return;
      }

      const reinicios = [];
      if (safe(o.restarted_at)) reinicios.push({ t: toTime(o.restarted_at), type: 'restart' });
      if (safe(o.interrupted_at)) reinicios.push({ t: toTime(o.interrupted_at), type: 'interrupt' });
      if (safe(o.finalized_at)) reinicios.push({ t: toTime(o.finalized_at), type: 'final' });
      reinicios.sort((a, b) => a.t - b.t);

      if (reinicios.length === 0) {
        lastEnd = Date.now();
        if (filtroEnd && lastEnd > filtroEnd.getTime()) lastEnd = filtroEnd.getTime();
        if (lastEnd > lastStart) intervals.push([lastStart, lastEnd]);
      } else {
        let cursor = lastStart;
        for (let i = 0; i < reinicios.length; i++) {
          const r = reinicios[i];
          if (r.type === 'interrupt' || r.type === 'final') {
            if (r.t > cursor) intervals.push([cursor, r.t]);
            const nextRestart = reinicios.find(x => x.type === 'restart' && x.t > r.t);
            if (nextRestart) cursor = nextRestart.t;
            else cursor = null;
          }
        }
        if (cursor) {
          const fimAberto = filtroEnd.getTime();
          if (fimAberto > cursor) intervals.push([cursor, fimAberto]);
        }
      }

      intervals.forEach(([iniMs, fimMs]) => {
        const iniCalc = Math.max(iniMs, filtroStart.getTime());
        const fimCalc = Math.min(fimMs, filtroEnd.getTime());
        if (fimCalc > iniCalc) {
          let prodMs = fimCalc - iniCalc;
          const paradaIntervals = (g.stops || []).map(st => {
            const stIni = toTime(st.started_at);
            const emAberto = !safe(st.resumed_at);
            if (emAberto && stIni < filtroStart.getTime()) {
              return [filtroStart.getTime(), filtroEnd.getTime()];
            }
            const stFim = emAberto ? filtroEnd.getTime() : toTime(st.resumed_at);
            const stIniCalc = Math.max(stIni || iniCalc, filtroStart.getTime());
            const stFimCalc = Math.min(stFim || fimCalc, filtroEnd.getTime());
            return stIniCalc < stFimCalc ? [stIniCalc, stFimCalc] : null;
          }).filter(Boolean);

          function unirIntervalos(intervalos) {
            if (!intervalos.length) return [];
            intervalos.sort((a, b) => a[0] - b[0]);
            const unidos = [intervalos[0]];
            for (let i = 1; i < intervalos.length; i++) {
              const ultimo = unidos[unidos.length - 1];
              const atual = intervalos[i];
              if (atual[0] <= ultimo[1]) {
                ultimo[1] = Math.max(ultimo[1], atual[1]);
              } else {
                unidos.push([...atual]);
              }
            }
            return unidos;
          }

          const paradaUnida = unirIntervalos(paradaIntervals);
          let deltaParada = 0;
          paradaUnida.forEach(([ini, fim]) => {
            deltaParada += Math.max(0, fim - ini);
          });
          prodMs -= deltaParada;
          paradaMsMaquina += deltaParada;

          if (safe(o.loweff_started_at)) {
            const leIni = toTime(o.loweff_started_at);
            const leFim = toTime(o.loweff_ended_at) || fimMs;
            const leIniCalc = Math.max(leIni || iniCalc, iniCalc);
            const leFimCalc = Math.min(leFim || fimCalc, fimCalc);
            if (leIniCalc < leFimCalc) {
              const delta = Math.max(0, leFimCalc - leIniCalc);
              prodMs -= delta;
              totalLowEffMs += delta;
            }
          }
          const descontoFimDeSemana = descontarFimDeSemana(iniCalc, fimCalc);
          prodMs -= descontoFimDeSemana;
          totalProdMs += Math.max(0, prodMs);
        }
      });

      const finalizedMs = toTime(o.finalized_at);
      if (finalizedMs) {
        const prox = nextStartForMachine(gruposPorMaquina[m], finalizedMs);
        if (prox) {
          const proxIni = toTime(prox.ordem.started_at) || filtroEnd?.getTime() || Date.now();
          if (proxIni > finalizedMs && proxIni <= filtroEnd.getTime()) {
            const delta = Math.max(0, proxIni - finalizedMs);
            totalSemProgMs += delta;
          }
        }
      }
    });
    const horasPeriodoMs = (filtroEnd.getTime() - filtroStart.getTime());
    let somaMs = 0;
    const prodMsMaquina = totalProdMs;
    somaMs = prodMsMaquina + paradaMsMaquina;
    if (somaMs > horasPeriodoMs) {
      paradaMsMaquina = Math.max(0, horasPeriodoMs - prodMsMaquina);
    }
    totalParadaMs += paradaMsMaquina;
    machineParadaMs[m] = paradaMsMaquina;
  }

  const totalProdH = totalProdMs / 1000 / 60 / 60;
  const totalParadaH = totalParadaMs / 1000 / 60 / 60;
  const totalLowEffH = totalLowEffMs / 1000 / 60 / 60;
  const totalSemProgH = totalSemProgMs / 1000 / 60 / 60;
  const totalH = totalProdH + totalParadaH + totalLowEffH + totalSemProgH;

  let maquinasConsideradas = filtroMaquina === 'todas' ? MAQUINAS : [filtroMaquina];
  maquinasConsideradas = maquinasConsideradas.filter(m => MAQUINAS.includes(m));
  let horasPeriodo = 0;
  if (filtroStart && filtroEnd) {
    horasPeriodo = (filtroEnd.getTime() - filtroStart.getTime()) / 1000 / 60 / 60;
  }
  const totalDisponivelH = maquinasConsideradas.length * horasPeriodo;

  const pct = v => totalH ? ((v / totalH) * 100).toFixed(1) : '0.0';
  const totalMaquinasParadas = Object.keys(gruposPorMaquina).filter(m => (machineParadaMs[m] || 0) > 0).length;

  return {
    totalProdH,
    totalParadaH,
    totalLowEffH,
    totalSemProgH,
    totalH,
    totalDisponivelH,
    pct,
    totalMaquinasParadas,
    machineParadaMs
  };
}, [gruposPorMaquina, filtroStart, filtroEnd, filtroMaquina, tick]);


  function formatHoursToHMS(hoursDecimal) {
    const totalSec = Math.round((Number(hoursDecimal) || 0) * 3600);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = n => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  function formatPctFromHours(h) {
    const pctNum = totalH ? (Number(h) / totalH) * 100 : 0;
    return `${pctNum.toFixed(1).replace('.', ',')}%`;
  }

  const items = useMemo(() => [
    { key: 'produzindo', label: 'Produzindo', valueH: totalProdH, color: '#0a7' },
    { key: 'parada', label: 'Parada', valueH: totalParadaH, color: '#e74c3c' },
    { key: 'loweff', label: 'Baixa Eficiência', valueH: totalLowEffH, color: '#ffc107' },
    { key: 'semprog', label: 'Sem Programação', valueH: totalSemProgH, color: '#3498db' }
  ], [totalProdH, totalParadaH, totalLowEffH, totalSemProgH, tick]);

  // === Toggle individual de máquina ===
  function toggleMachine(m) {
    setOpenMachines(prev => {
      const n = new Set(prev)
      if (n.has(m)) n.delete(m)
      else n.add(m)
      return n
    })
  }

  function tsOP(o) {
    return new Date(
      toTime(o.finalized_at) ||
      toTime(o.restarted_at) ||
      toTime(o.interrupted_at) ||
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

        {/* Filtros */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <div className="select-wrap">
            <select
              className="period-select"
              aria-label="Selecionar período"
              value={periodo}
              onChange={e => setPeriodo(e.target.value)}
            >
              <option value="hoje">Hoje</option>
              <option value="ontem">Ontem</option>
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

        {/* Resumo / Pie Chart */}
        {periodo === 'custom' && (!customStart || !customEnd) ? (
          <div className="row muted" style={{ padding: '32px 0', textAlign: 'center', fontSize: 18, background: '#f6f6f6' }}>
            Selecione as duas datas para visualizar os indicadores.
          </div>
        ) : (
          <div className="card" style={{ marginBottom: 16, background: '#f6f6f6', padding: 16 }}>
            <div className="label" style={{ marginBottom: 8, textAlign: 'center' }}>Resumo do Período</div>
            <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 260 }}>
                <PieChartIndicadores
                  data={items.map(it => ({ label: it.label, value: it.valueH, color: it.color }))}
                  totalMaquinasParadas={totalMaquinasParadas}
                  hoveredIndex={hoveredIndicador}
                  setHoveredIndex={setHoveredIndicador}
                  totalDisponivelH={totalDisponivelH}
                />
              </div>
              <div className="summary-side" style={{ flex: 1, minWidth: 320 }}>
                {items.map((it, idx) => (
                  <div
                    key={it.key}
                    className="summary-item"
                    style={{ display: 'flex', gap: 8, alignItems: 'center', whiteSpace: 'nowrap', marginBottom: 6 }}
                    onMouseEnter={() => setHoveredIndicador(idx)}
                    onMouseLeave={() => setHoveredIndicador(null)}
                  >
                    <span className="swatch" style={{ background: it.color, width: 10, height: 10, display: 'inline-block', borderRadius: 2 }} />
                    <span style={{ color: it.color, fontWeight: 700 }}>{it.label}:</span>
                    <span>{formatHoursToHMS(it.valueH)}</span>
                    <span style={{ color: '#666' }}> - {formatPctFromHours(it.valueH)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Mensagem se não há registros */}
        {(!Array.isArray(gruposFiltrados) || gruposFiltrados.length === 0) ? (
          <div className="row muted" style={{ padding: '32px 0', textAlign: 'center', fontSize: 18 }}>
            Nenhum registro encontrado para o período selecionado.
          </div>
        ) : (
          MAQUINAS.map(m => {
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

                        // monta events (mantive sua lógica original)
                        if (safe(o.started_at)) {
                          events.push({
                            id: `start-${o.id}`,
                            type: 'start',
                            title: 'Início da produção',
                            when: o.started_at,
                            who: o.started_by || '-'
                          })
                        }
                        if (safe(o.interrupted_at)) {
                          events.push({
                            id: `interrupt-${o.id}`,
                            type: 'interrupt',
                            title: 'Produção interrompida',
                            when: o.interrupted_at,
                            who: o.interrupted_by || '-'
                          })
                        }
                        if (safe(o.restarted_at)) {
                          events.push({
                            id: `restart-${o.id}`,
                            type: 'restart',
                            title: 'Reinício da produção',
                            when: o.restarted_at,
                            who: o.restarted_by || '-'
                          })
                        }
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
                              onClick={() => effectiveToggleOpen(o.id)}
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
                              <div>{effectiveOpenSet.has(o.id) ? '▲' : '▼'}</div>
                            </div>

                            {effectiveOpenSet.has(o.id) && (
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
