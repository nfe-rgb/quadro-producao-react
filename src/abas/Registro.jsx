import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import PieChartIndicadores from '../components/PieChartIndicadores'
import { fmtDateTime, fmtDuracao } from '../lib/utils'
import { MAQUINAS } from '../lib/constants'

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

function getPeriodoRange(p, customStart, customEnd, now = new Date()) {
  // Retorna { start: Date|null, end: Date|null }
  let start = null, end = null
  if (p === 'hoje') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    end = now
  } else if (p === 'ontem') {
    const ontem = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    start = new Date(ontem.getFullYear(), ontem.getMonth(), ontem.getDate(), 0, 0, 0, 0)
    end = new Date(ontem.getFullYear(), ontem.getMonth(), ontem.getDate(), 23, 59, 59, 999)
  } else if (p === 'semana') {
    const day = now.getDay() === 0 ? 7 : now.getDay()
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (day - 1), 0, 0, 0, 0)
    start = monday
    end = now
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

function unirArrays(intervalos) {
  if (!intervalos.length) return []
  intervalos.sort((a, b) => a[0] - b[0])
  const unidos = [intervalos[0].slice()]
  for (let i = 1; i < intervalos.length; i++) {
    const ultimo = unidos[unidos.length - 1]
    const atual = intervalos[i]
    if (atual[0] <= ultimo[1]) {
      ultimo[1] = Math.max(ultimo[1], atual[1])
    } else {
      unidos.push([atual[0], atual[1]])
    }
  }
  return unidos
}

function nextStartForMachine(machineGroups = [], refTime) {
  if (!Array.isArray(machineGroups) || machineGroups.length === 0) return null
  const sorted = machineGroups
    .map(g => ({ g, t: toTime(g?.ordem?.started_at) || 0 }))
    .filter(x => x.t > refTime)
    .sort((a, b) => a.t - b.t)
  return sorted.length ? sorted[0].g : null
}

/**
 * calculateAggregates - versão corrigida e centralizada
 * Retorna:
 *  { totalProdH, totalParadaH, totalLowEffH, totalSemProgH, totalH, totalDisponivelH, pct, totalMaquinasParadas, machineParadaMs }
 */
function calculateAggregates({ gruposPorMaquina, filtroStart, filtroEnd, maquinasConsideradas }) {
  let totalProdMs = 0, totalParadaMs = 0, totalLowEffMs = 0, totalSemProgMs = 0
  const machineParadaMs = {}

  if (!filtroStart || !filtroEnd) {
    return {
      totalProdH: 0,
      totalParadaH: 0,
      totalLowEffH: 0,
      totalSemProgH: 0,
      totalH: 0,
      totalDisponivelH: 0,
      pct: () => '0.0',
      totalMaquinasParadas: 0,
      machineParadaMs: {}
    }
  }

  const filtroStartMs = filtroStart.getTime()
  const filtroEndMs = filtroEnd.getTime()
  const nowClamp = Math.min(Date.now(), filtroEndMs)

  for (const m of maquinasConsideradas) {
    const gruposOrdenados = (gruposPorMaquina[m] || []).slice().sort((a, b) => {
      const ta = toTime(a?.ordem?.started_at) || 0
      const tb = toTime(b?.ordem?.started_at) || 0
      return ta - tb
    })

    // Se nenhuma OP no período -> sem programação total
    if (gruposOrdenados.length === 0) {
      const horasPeriodoMs = Math.max(0, filtroEndMs - filtroStartMs)
      totalSemProgMs += horasPeriodoMs
      machineParadaMs[m] = 0
      continue
    }

    // --- 1) calcular paradas (stops) da máquina para o período, com clipping e unificação ---
    const allStops = []
    for (const g of gruposOrdenados) {
      const stops = g.stops || []
      for (const st of stops) {
        const stIni = toTime(st.started_at)
        if (!stIni) continue
        const stFim = safe(st.resumed_at) ? toTime(st.resumed_at) : nowClamp
        const ini = Math.max(stIni, filtroStartMs)
        const fim = Math.min(stFim, filtroEndMs)
        if (ini < fim) allStops.push([ini, fim])
      }
    }
    const stopsUnidos = unirArrays(allStops)
    let paradaMsMaquina = 0
    stopsUnidos.forEach(([ini, fim]) => { paradaMsMaquina += Math.max(0, fim - ini) })
    machineParadaMs[m] = paradaMsMaquina
    totalParadaMs += paradaMsMaquina

    // --- 2) produção / baixa eficiência ---
    let prodMsMaquina = 0
    let lowEffMsMaquina = 0

    // acumulador de ocupação para calcular sem programação por complemento
    const ocupados = []
    // adicionar paradas como ocupação (já unidas)
    stopsUnidos.forEach(([i, f]) => ocupados.push([i, f]))

    for (const g of gruposOrdenados) {
      const o = g.ordem || {}
      const startMs = toTime(o.started_at)
      if (!startMs) continue

      // coletar eventos importantes (start, interrupt, restart, final)
      const eventos = []
      // garantir que started_at apareça como 'start' se existir
      if (safe(o.started_at)) eventos.push({ t: toTime(o.started_at), type: 'start' })
      if (safe(o.restarted_at)) eventos.push({ t: toTime(o.restarted_at), type: 'restart' })
      if (safe(o.interrupted_at)) eventos.push({ t: toTime(o.interrupted_at), type: 'interrupt' })
      if (safe(o.finalized_at)) eventos.push({ t: toTime(o.finalized_at), type: 'final' })

      // ordenar por timestamp
      eventos.sort((a, b) => a.t - b.t)

      // === NOVA LÓGICA: scan linear com estado "running" ===
      const prodBaseIntervals = []
      let running = false
      let runStart = null

      // Se houver um started_at (inventário), mas nenhum evento posterior de start/restart, tratamos via eventos já inseridos.
      // Iteramos os eventos em ordem; quando encontramos start/restart abrimos, ao encontrar interrupt/final fechamos.
      for (let i = 0; i < eventos.length; i++) {
        const ev = eventos[i]
        if ((ev.type === 'start' || ev.type === 'restart')) {
          // abrir apenas se não estiver rodando
          if (!running) {
            running = true
            runStart = ev.t
          } else {
            // se já estava rodando, ignorar (evita sobreposição)
          }
        } else if (ev.type === 'interrupt' || ev.type === 'final') {
          if (running) {
            const ini = Math.max(runStart, filtroStartMs)
            const fim = Math.min(ev.t, filtroEndMs)
            if (ini < fim) prodBaseIntervals.push([ini, fim])
            running = false
            runStart = null
          } else {
            // se não estava rodando, ignoramos este interrupt/final
          }
        }
      }

      // se ao final o estado estiver "running", fechar até finalized_at (se existir) ou nowClamp
      if (running) {
        let fimAberto = safe(o.finalized_at) ? toTime(o.finalized_at) : nowClamp
        fimAberto = Math.min(fimAberto, filtroEndMs)
        const ini = Math.max(runStart || startMs, filtroStartMs)
        if (ini < fimAberto) prodBaseIntervals.push([ini, fimAberto])
      } else {
        // se não havia eventos de start/restart mas existe started_at e possivelmente finalized_at,
        // considerar o intervalo entre started_at e finalized_at/nowClamp
        const hasStartEvent = eventos.some(e => e.type === 'start' || e.type === 'restart')
        if (!hasStartEvent) {
          const lastEnd = safe(o.finalized_at) ? toTime(o.finalized_at) : nowClamp
          const ini = Math.max(startMs, filtroStartMs)
          const fim = Math.min(lastEnd, filtroEndMs)
          if (ini < fim) prodBaseIntervals.push([ini, fim])
        }
      }

      // Agora, para cada base, remover paradas (stopsUnidos) e aplicar loweff
      for (const [iniBase, fimBase] of prodBaseIntervals) {
        // calcular paradas dentro do base
        const paradaClipped = stopsUnidos
          .map(([pIni, pFim]) => {
            const ini = Math.max(pIni, iniBase)
            const fim = Math.min(pFim, fimBase)
            return ini < fim ? [ini, fim] : null
          })
          .filter(Boolean)
        const paradaUnida = unirArrays(paradaClipped)

        // gerar fatias livres (livres = porções de base sem parada)
        let livres = []
        let cursorLiv = iniBase
        for (let i = 0; i < paradaUnida.length; i++) {
          const [pIni, pFim] = paradaUnida[i]
          if (pIni > cursorLiv) livres.push([cursorLiv, pIni])
          cursorLiv = Math.max(cursorLiv, pFim)
        }
        if (cursorLiv < fimBase) livres.push([cursorLiv, fimBase])

        // dentro de cada livre, separar loweff e produção
        for (const [livreIni, livreFim] of livres) {
          if (livreFim <= livreIni) continue

          const lowEffIntervals = []
          if (safe(o.loweff_started_at)) {
            const leIni = toTime(o.loweff_started_at)
            const leFim = safe(o.loweff_ended_at) ? toTime(o.loweff_ended_at) : livreFim
            const leIniCalc = Math.max(leIni, filtroStartMs, livreIni)
            const leFimCalc = Math.min(leFim, filtroEndMs, livreFim)
            if (leIniCalc < leFimCalc) lowEffIntervals.push([leIniCalc, leFimCalc])
          }
          const lowUnidos = unirArrays(lowEffIntervals)

          if (lowUnidos.length === 0) {
            prodMsMaquina += Math.max(0, livreFim - livreIni)
            ocupados.push([livreIni, livreFim])
          } else {
            let cursorF = livreIni
            for (let i = 0; i < lowUnidos.length; i++) {
              const [leIni, leFim] = lowUnidos[i]
              if (leIni > cursorF) {
                prodMsMaquina += Math.max(0, leIni - cursorF)
                ocupados.push([cursorF, leIni])
              }
              const lowIni = Math.max(leIni, livreIni)
              const lowFim = Math.min(leFim, livreFim)
              if (lowFim > lowIni) {
                lowEffMsMaquina += Math.max(0, lowFim - lowIni)
                ocupados.push([lowIni, lowFim])
              }
              cursorF = Math.max(cursorF, leFim)
            }
            if (cursorF < livreFim) {
              prodMsMaquina += Math.max(0, livreFim - cursorF)
              ocupados.push([cursorF, livreFim])
            }
          }
        }
      } // fim prodBaseIntervals loop
    } // fim for each OP

    totalProdMs += prodMsMaquina
    totalLowEffMs += lowEffMsMaquina

    // --- 3) sem programação por complemento ---
    const ocupadosUnidos = unirArrays(ocupados)
    let ocupadoTotalMs = 0
    ocupadosUnidos.forEach(([i, f]) => { ocupadoTotalMs += Math.max(0, f - i) })
    const horasPeriodoMs = Math.max(0, filtroEndMs - filtroStartMs)
    const semProgMsMaquina = Math.max(0, horasPeriodoMs - ocupadoTotalMs)
    totalSemProgMs += semProgMsMaquina
  } // fim maquinas loop

  const totalProdH = totalProdMs / 1000 / 60 / 60
  const totalParadaH = totalParadaMs / 1000 / 60 / 60
  const totalLowEffH = totalLowEffMs / 1000 / 60 / 60
  const totalSemProgH = totalSemProgMs / 1000 / 60 / 60
  const totalH = totalProdH + totalParadaH + totalLowEffH + totalSemProgH

  const horasPeriodo = (filtroEnd.getTime() - filtroStart.getTime()) / 1000 / 60 / 60
  const totalDisponivelH = maquinasConsideradas.length * horasPeriodo

  const pct = v => totalDisponivelH ? ((v / totalDisponivelH) * 100).toFixed(1) : '0.0'
  const totalMaquinasParadas = maquinasConsideradas.filter(m => (machineParadaMs[m] || 0) > 0).length

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
  }
}

// =========================
// Subcomponentes pequenos (apenas para organização visual)
// =========================
function Filters({ periodo, setPeriodo, customStart, setCustomStart, customEnd, setCustomEnd, filtroMaquina, setFiltroMaquina }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
      <div className="select-wrap">
        <select className="period-select" aria-label="Selecionar período" value={periodo} onChange={e => setPeriodo(e.target.value)}>
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
        <select className="period-select" aria-label="Filtrar por máquina ou grupo" value={filtroMaquina} onChange={e => setFiltroMaquina(e.target.value)}>
          <option value="todas">Todas as máquinas</option>
          <option value="pet">PET</option>
          <option value="injecao">Injeção</option>
          {MAQUINAS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
    </div>
  )
}

// =========================
// Componente principal (refatorado e com pontos de extensão claros)
// =========================
export default function Registro({ registroGrupos = [], openSet, toggleOpen }) {
  // Estado para armazenar logs de baixa eficiência por ordem
  // ...existing code...
  // Estado para armazenar logs de baixa eficiência por ordem
  const [lowEffLogsByOrder, setLowEffLogsByOrder] = useState({});
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  // Buscar logs de baixa eficiência para as ordens exibidas
  useEffect(() => {
    async function fetchLowEffLogs() {
      const orderIds = registroGrupos.map(g => g?.ordem?.id).filter(Boolean);
      if (!orderIds.length) {
        setLowEffLogsByOrder({});
        return;
      }
      const { data, error } = await supabase
        .from('low_efficiency_logs')
        .select('*')
        .in('order_id', orderIds);
      if (error) {
        setLowEffLogsByOrder({});
        return;
      }
      // Agrupa por order_id
      const logsByOrder = {};
      for (const log of data) {
        if (!logsByOrder[log.order_id]) logsByOrder[log.order_id] = [];
        logsByOrder[log.order_id].push(log);
      }
      setLowEffLogsByOrder(logsByOrder);
    }
    fetchLowEffLogs();
  }, [registroGrupos]);

  const [hoveredIndicador, setHoveredIndicador] = useState(null)
  const [localOpenSet, setLocalOpenSet] = useState(() => new Set())
  const localToggleOpen = (id) => setLocalOpenSet(prev => {
    const n = new Set(prev)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })
  const effectiveOpenSet = openSet ?? localOpenSet
  const effectiveToggleOpen = toggleOpen ?? localToggleOpen

  const [openMachines, setOpenMachines] = useState(new Set())
  const [periodo, setPeriodo] = useState('hoje')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [filtroMaquina, setFiltroMaquina] = useState('todas')

  // Único filtro incluindo grupos PET/Injeção
  const grupoPET = MAQUINAS.filter(m => String(m).toUpperCase().startsWith('P'))
  const grupoINJ = MAQUINAS.filter(m => String(m).toUpperCase().startsWith('I'))
  let maquinasConsideradas = MAQUINAS
  if (filtroMaquina === 'todas') {
    maquinasConsideradas = MAQUINAS
  } else if (filtroMaquina === 'pet') {
    maquinasConsideradas = grupoPET
  } else if (filtroMaquina === 'injecao') {
    maquinasConsideradas = grupoINJ
  } else {
    maquinasConsideradas = [filtroMaquina]
  }
  maquinasConsideradas = maquinasConsideradas.filter(m => MAQUINAS.includes(m))

  // 1) Period range (centralizado)
  const periodoRange = useMemo(() => getPeriodoRange(periodo, customStart, customEnd, new Date()), [periodo, customStart, customEnd, tick])
  const filtroStart = periodoRange.start
  const filtroEnd = periodoRange.end

  // 2) Filtrar registros por período (clean)
  const gruposFiltrados = useMemo(() => {
    const source = Array.isArray(registroGrupos) ? registroGrupos : []
    if (periodo === 'custom' && (!customStart || !customEnd)) return []
    if (!filtroStart || !filtroEnd) return source

    return source.filter(g => {
      const o = g.ordem || {}
      const iniMs = toTime(o.started_at)
      const fimMs = toTime(o.finalized_at)
      const restartedMs = toTime(o.restarted_at)
      const interruptedMs = toTime(o.interrupted_at)
      const filtroStartMs = filtroStart.getTime();
      const filtroEndMs = filtroEnd.getTime();

      const hasOpenStop = (g.stops || []).some(st => {
        const stIni = toTime(st.started_at)
        const stFim = toTime(st.resumed_at)
        return stIni && stIni < filtroEndMs && (!stFim || stFim >= filtroStartMs)
      })

      // OP iniciada antes do período, mas ainda aberta ou reiniciada dentro do período
      const abertaAposInicio = iniMs && iniMs < filtroStartMs && (!fimMs || fimMs >= filtroStartMs)
      // OP reiniciada dentro do período e ainda aberta
      const reiniciadaAberta = restartedMs && restartedMs >= filtroStartMs && restartedMs < filtroEndMs && !fimMs

      // Ignorar apenas se FINALIZOU antes do período e não há cruzamento/abertura
      const endedBeforeFilter = (fimMs && fimMs < filtroStartMs && !abertaAposInicio && !reiniciadaAberta)
      if (endedBeforeFilter) return false

      // OPs iniciadas ou reiniciadas dentro do range
      const startedInRange = iniMs && iniMs >= filtroStartMs && iniMs < filtroEndMs
      const restartedInRange = restartedMs && restartedMs >= filtroStartMs && restartedMs < filtroEndMs
      const finalizedInRange = fimMs && fimMs >= filtroStartMs && fimMs <= filtroEndMs
      const openInRange = !fimMs && (iniMs < filtroEndMs || (restartedMs && restartedMs < filtroEndMs))
      const resultado = startedInRange || restartedInRange || finalizedInRange || openInRange || abertaAposInicio || reiniciadaAberta || hasOpenStop
      return resultado
    })
  }, [registroGrupos, filtroStart, filtroEnd, periodo, customStart, customEnd, tick])

  // 3) Filtrar por máquina
  const gruposFiltradosMaquina = useMemo(() => {
    if (filtroMaquina === 'todas') return gruposFiltrados
    if (filtroMaquina === 'pet') {
      return gruposFiltrados.filter(g => String(g?.ordem?.machine_id || '').toUpperCase().startsWith('P'))
    }
    if (filtroMaquina === 'injecao') {
      return gruposFiltrados.filter(g => String(g?.ordem?.machine_id || '').toUpperCase().startsWith('I'))
    }
    return gruposFiltrados.filter(g => String(g?.ordem?.machine_id || 'SEM MÁQ.') === String(filtroMaquina))
  }, [gruposFiltrados, filtroMaquina, tick])

  // 4) Agrupar por máquina (simples e previsível)
  const gruposPorMaquina = useMemo(() => {
    const map = {}
    for (const g of gruposFiltradosMaquina) {
      const m = g?.ordem?.machine_id || 'SEM MÁQ.'
      if (!map[m]) map[m] = []
      map[m].push(g)
    }
    return map
  }, [gruposFiltradosMaquina])

  // 5) Calcular agregados, somando baixa eficiência dos logs reais
  const aggregates = useMemo(() => {
    // Calcula intervalos de parada e baixa eficiência por máquina, sem sobreposição
    const filtroStartMs = filtroStart ? filtroStart.getTime() : null;
    const filtroEndMs = filtroEnd ? filtroEnd.getTime() : null;
    const machineLowEffMs = {};
    const machineLowEffNoStopMs = {};
    const machineParadaMs = {};
    let totalLowEffMs = 0;
    let totalParadaMs = 0;
    for (const m of maquinasConsideradas) {
      // Busca ordens dessa máquina
      const grupos = gruposPorMaquina[m] || [];
      // Coleta intervalos de parada
      const paradaIntervals = [];
      for (const gr of grupos) {
        const stops = gr.stops || [];
        for (const st of stops) {
          let ini = toTime(st.started_at);
          let fim = safe(st.resumed_at) ? toTime(st.resumed_at) : Date.now();
          if (filtroStartMs !== null && ini < filtroStartMs) ini = filtroStartMs;
          if (filtroEndMs !== null && fim > filtroEndMs) fim = filtroEndMs;
          if (ini && fim && fim > ini) paradaIntervals.push([ini, fim]);
        }
      }
      // Coleta intervalos de baixa eficiência
      const lowEffIntervals = [];
      for (const gr of grupos) {
        const o = gr.ordem || {};
        const logs = lowEffLogsByOrder[o.id] || [];
        for (const log of logs) {
          let ini = toTime(log.started_at);
          let fim = log.ended_at ? toTime(log.ended_at) : Date.now();
          if (filtroStartMs !== null && ini < filtroStartMs) ini = filtroStartMs;
          if (filtroEndMs !== null && fim > filtroEndMs) fim = filtroEndMs;
          if (ini && fim && fim > ini) lowEffIntervals.push([ini, fim]);
        }
      }
      // Unir intervalos de parada e baixa eficiência
      function unir(arr) {
        if (!arr.length) return [];
        arr.sort((a, b) => a[0] - b[0]);
        const unidos = [arr[0].slice()];
        for (let i = 1; i < arr.length; i++) {
          const ultimo = unidos[unidos.length - 1];
          const atual = arr[i];
          if (atual[0] <= ultimo[1]) {
            ultimo[1] = Math.max(ultimo[1], atual[1]);
          } else {
            unidos.push([atual[0], atual[1]]);
          }
        }
        return unidos;
      }
      const paradaUnida = unir(paradaIntervals);
      const lowEffUnida = unir(lowEffIntervals);
      // 1. Baixa eficiência integral dos logs (para exibição)
      let lowEffMs = 0;
      for (const [leIni, leFim] of lowEffUnida) {
        if (leFim > leIni) lowEffMs += Math.max(0, leFim - leIni);
      }
      // 1a. Baixa eficiência sem sobreposição com parada (para ajuste de produção)
      let lowEffNoStopMs = 0;
      for (const [leIni, leFim] of lowEffUnida) {
        let fatias = [[leIni, leFim]];
        for (const [pIni, pFim] of paradaUnida) {
          const novasFatias = [];
          for (const [fIni, fFim] of fatias) {
            if (pFim <= fIni || pIni >= fFim) {
              novasFatias.push([fIni, fFim]);
              continue;
            }
            if (pIni > fIni && pIni < fFim) novasFatias.push([fIni, pIni]);
            if (pFim > fIni && pFim < fFim) novasFatias.push([pFim, fFim]);
          }
          fatias = novasFatias;
        }
        for (const [fIni, fFim] of fatias) {
          if (fFim > fIni) lowEffNoStopMs += Math.max(0, fFim - fIni);
        }
      }
      // 2. Parada: desconta trechos de baixa eficiência (mantém exclusão para não duplicar parada)
      let paradaMs = 0;
      for (const [pIni, pFim] of paradaUnida) {
        let fatias = [[pIni, pFim]];
        for (const [leIni, leFim] of lowEffUnida) {
          const novasFatias = [];
          for (const [fIni, fFim] of fatias) {
            if (leFim <= fIni || leIni >= fFim) {
              novasFatias.push([fIni, fFim]);
              continue;
            }
            if (leIni > fIni && leIni < fFim) novasFatias.push([fIni, leIni]);
            if (leFim > fIni && leFim < fFim) novasFatias.push([leFim, fFim]);
          }
          fatias = novasFatias;
        }
        for (const [fIni, fFim] of fatias) {
          if (fFim > fIni) paradaMs += Math.max(0, fFim - fIni);
        }
      }
      machineLowEffMs[m] = lowEffMs;
      machineLowEffNoStopMs[m] = lowEffNoStopMs;
      machineParadaMs[m] = paradaMs;
      totalLowEffMs += lowEffMs;
      totalParadaMs += paradaMs;
    }
    // Chama agregador original, mas ignora os campos de parada e baixa eficiência dele
    const aggs = calculateAggregates({ gruposPorMaquina, filtroStart, filtroEnd, maquinasConsideradas });
    const totalLowEffH_logs = totalLowEffMs / 1000 / 60 / 60;
    // Ajustar produção: subtrair apenas o delta de baixa eficiência (sem parada) que não foi considerado pelo agregador nativo
    const totalLowEffNoStopH_logs = Object.values(machineLowEffNoStopMs).reduce((acc, ms) => acc + ms, 0) / 1000 / 60 / 60;
    const deltaLowEffNoStopH = Math.max(0, totalLowEffNoStopH_logs - (aggs.totalLowEffH || 0));
    const totalProdH_corrigido = Math.max(0, (aggs.totalProdH || 0) - deltaLowEffNoStopH);
    return {
      ...aggs,
      totalProdH: totalProdH_corrigido,
      totalLowEffH: totalLowEffH_logs,
      // Mantém 'Sem Programação' calculado pelo agregador (evita subtração global indevida)
      totalSemProgH: aggs.totalSemProgH,
      machineLowEffH: Object.fromEntries(Object.entries(machineLowEffMs).map(([k, v]) => [k, v / 1000 / 60 / 60])),
      totalParadaH: totalParadaMs / 1000 / 60 / 60,
      machineParadaH: Object.fromEntries(Object.entries(machineParadaMs).map(([k, v]) => [k, v / 1000 / 60 / 60]))
    };
  }, [gruposPorMaquina, filtroStart, filtroEnd, maquinasConsideradas.length, tick, lowEffLogsByOrder]);

  const { totalProdH, totalParadaH, totalLowEffH, totalSemProgH, totalDisponivelH, pct, totalMaquinasParadas, machineParadaMs } = aggregates;

  const items = useMemo(() => {
    const raw = [
      { key: 'produzindo', label: 'Produzindo', valueH: totalProdH, color: '#0a7' },
      { key: 'parada', label: 'Parada', valueH: totalParadaH, color: '#e74c3c' },
      { key: 'loweff', label: 'Baixa Eficiência', valueH: totalLowEffH, color: '#ffc107' },
      { key: 'semprog', label: 'Sem Programação', valueH: totalSemProgH, color: '#3498db' }
    ]
    // NÃO fazer rescaling silencioso — manter números reais e tratar visualmente se necessário
    return raw
  }, [totalProdH, totalParadaH, totalLowEffH, totalSemProgH, totalDisponivelH, tick])

  function formatHoursToHMS(hoursDecimal) {
    const totalSec = Math.round((Number(hoursDecimal) || 0) * 3600)
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    const pad = n => String(n).padStart(2, '0')
    return `${pad(h)}:${pad(m)}:${pad(s)}`
  }

  function formatPctFromHours(h) {
    const pctNum = totalDisponivelH ? (Number(h) / totalDisponivelH) * 100 : 0
    return `${pctNum.toFixed(1).replace('.', ',')}%`
  }

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
      toTime(o.finalized_at) || toTime(o.restarted_at) || toTime(o.interrupted_at) || toTime(o.started_at) || toTime(o.created_at) || 0
    ).getTime()
  }

  return (
    <div className="card registro-wrap">
      <div className="card">
        <div className="label" style={{ marginBottom: 8 }}>Histórico de Produção por Máquina</div>

        <Filters periodo={periodo} setPeriodo={setPeriodo} customStart={customStart} setCustomStart={setCustomStart} customEnd={customEnd} setCustomEnd={setCustomEnd} filtroMaquina={filtroMaquina} setFiltroMaquina={setFiltroMaquina} />

        {periodo === 'custom' && (!customStart || !customEnd) ? (
          <div className="row muted" style={{ padding: '32px 0', textAlign: 'center', fontSize: 18, background: '#f6f6f6' }}>Selecione as duas datas para visualizar os indicadores.</div>
        ) : (
          <div className="card" style={{ marginBottom: 16, background: '#f6f6f6', padding: 16 }}>
            <div className="label" style={{ marginBottom: 8, textAlign: 'center' }}>Resumo do Período</div>
            <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 260 }}>
                <PieChartIndicadores data={items.map(it => ({ label: it.label, value: it.valueH, color: it.color }))} totalMaquinasParadas={totalMaquinasParadas} hoveredIndex={hoveredIndicador} setHoveredIndex={setHoveredIndicador} totalDisponivelH={totalDisponivelH} />
              </div>
              <div className="summary-side" style={{ flex: 1, minWidth: 320 }}>
                {items.map((it, idx) => (
                  <div key={it.key} className="summary-item" style={{ display: 'flex', gap: 8, alignItems: 'center', whiteSpace: 'nowrap', marginBottom: 6 }} onMouseEnter={() => setHoveredIndicador(idx)} onMouseLeave={() => setHoveredIndicador(null)}>
                    <span className="swatch" style={{ background: it.color, width: 10, height: 10, display: 'inline-block', borderRadius: 2 }} />
                    <span style={{ color: it.color, fontWeight: 700 }}>{it.label}:</span>
                    <span>{formatHoursToHMS(it.valueH)}</span>
                    <span style={{ color: '#666' }}> - {formatPctFromHours(it.valueH)}</span>
                  </div>
                ))}
                {/* Exibir aviso se soma exceder a disponibilidade */}
                {totalDisponivelH > 0 && Math.abs((totalProdH + totalParadaH + totalLowEffH + totalSemProgH) - totalDisponivelH) > 0.01 && (
                  <div className="muted" style={{ marginTop: 8, color: '#a00' }}>
                    Atenção: soma das categorias diferente do total disponível — revise o período/filtros ou verifique eventos com timestamps fora do intervalo.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Lista por máquina */}
        {(!Array.isArray(gruposFiltrados) || gruposFiltrados.length === 0) ? (
          <div className="row muted" style={{ padding: '32px 0', textAlign: 'center', fontSize: 18 }}>Nenhum registro encontrado para o período selecionado.</div>
        ) : (
          MAQUINAS.map(m => {
            // Aplicar filtro único
            if (filtroMaquina === 'pet' && !String(m).toUpperCase().startsWith('P')) return null
            if (filtroMaquina === 'injecao' && !String(m).toUpperCase().startsWith('I')) return null
            if (filtroMaquina !== 'todas' && filtroMaquina !== 'pet' && filtroMaquina !== 'injecao' && m !== filtroMaquina) return null
            const grupos = (gruposPorMaquina[m] || []).slice().sort((a, b) => tsOP(b.ordem) - tsOP(a.ordem))
            const aberto = openMachines.has(m)
            return (
              <div key={m} className="registro-maquina-bloco" style={{ marginBottom: 16 }}>
                <div className="maquina-head" onClick={() => toggleMachine(m)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                      {grupos.length === 0 && <div className="row muted" style={{ gridColumn: '1 / -1', padding: '8px 0', textAlign: 'center' }}>Nenhuma O.P. registrada nesta máquina.</div>}

                      {grupos.map(gr => {
                        const o = gr.ordem || {}
                        const events = []
                        if (safe(o.started_at)) events.push({ id: `start-${o.id}`, type: 'start', title: 'Início da produção', when: o.started_at, who: o.started_by || '-' })
                        if (safe(o.interrupted_at)) events.push({ id: `interrupt-${o.id}`, type: 'interrupt', title: 'Produção interrompida', when: o.interrupted_at, who: o.interrupted_by || '-' })
                        if (safe(o.restarted_at)) events.push({ id: `restart-${o.id}`, type: 'restart', title: 'Reinício da produção', when: o.restarted_at, who: o.restarted_by || '-' })
                        // Adiciona eventos de baixa eficiência vindos dos logs
                        const lowEffLogs = lowEffLogsByOrder[o.id] || [];
                        for (const log of lowEffLogs) {
                          events.push({
                            id: `lowefflog-${log.id}`,
                            type: 'loweff',
                            title: 'Baixa eficiência',
                            when: log.started_at,
                            end: log.ended_at || null,
                            who: log.started_by || '-',
                            notes: log.notes || ''
                          });
                        }
                        ;(gr.stops || []).forEach(st => { if (safe(st.started_at)) events.push({ id: `stop-${st.id}`, type: 'stop', title: 'Parada', when: st.started_at, end: safe(st.resumed_at) ? st.resumed_at : null, who: st.started_by || '-', reason: st.reason || '-', notes: st.notes || '' }) })
                        if (safe(o.finalized_at)) events.push({ id: `end-${o.id}`, type: 'end', title: 'Fim da produção', when: o.finalized_at, who: o.finalized_by || '-' })
                        if (!events.length) events.push({ id: `empty-${o.id}`, type: 'empty', title: 'Sem eventos', when: null })
                        events.sort((a, b) => (toTime(a.when) || 0) - (toTime(b.when) || 0))

                        return (
                          <div key={o.id} style={{ display: 'contents' }}>
                            <div className="row grupo-head" style={{ gridTemplateColumns: '140px 1fr 140px 140px 80px', cursor: 'pointer' }} onClick={() => effectiveToggleOpen(o.id)}>
                              <div>{o.code}</div>
                              <div>{[o.customer, o.product, o.color, o.qty].filter(Boolean).join(' • ') || '-'}</div>
                              <div>{safe(o.started_at) ? (() => { const dt = fmtDateTime(o.started_at); const [data, hora] = dt.split(' '); return <span>{data}<br />{hora}</span> })() : '-'}</div>
                              <div>{safe(o.finalized_at) ? (() => { const dt = fmtDateTime(o.finalized_at); const [data, hora] = dt.split(' '); return <span>{data}<br />{hora}</span> })() : '-'}</div>
                              <div>{effectiveOpenSet.has(o.id) ? '▲' : '▼'}</div>
                            </div>

                            {effectiveOpenSet.has(o.id) && (
                              <div className="row" style={{ gridColumn: '1 / -1', background: '#fafafa' }}>
                                <div className="timeline">
                                  {events.map(ev => {
                                    if (ev.type === 'empty') return (<div key={ev.id} className="tl-card tl-empty"><div className="tl-title">Sem eventos</div><div className="tl-meta muted">Esta O.P ainda não possui início, paradas ou fim registrados.</div></div>)
                                    if (ev.type === 'start') return (<div key={ev.id} className="tl-card tl-start"><div className="tl-title">🚀 {ev.title}</div><div className="tl-meta"><b>Data/Hora:</b> {fmtDateTime(ev.when)}</div><div className="tl-meta"><b>Operador:</b> {ev.who}</div></div>)
                                    if (ev.type === 'restart') return (<div key={ev.id} className="tl-card tl-start"><div className="tl-title">🔁 {ev.title}</div><div className="tl-meta"><b>Data/Hora:</b> {fmtDateTime(ev.when)}</div><div className="tl-meta"><b>Operador:</b> {ev.who}</div></div>)
                                    if (ev.type === 'loweff') {
                                      const dur = ev.end ? fmtDuracao(ev.when, ev.end) : '-'
                                      return (<div key={ev.id} className="tl-card tl-interrupt"><div className="tl-title">🟡 {ev.title}</div><div className="tl-meta"><b>Início:</b> {fmtDateTime(ev.when)}</div><div className="tl-meta"><b>Fim:</b> {ev.end ? fmtDateTime(ev.end) : '— (em aberto)'}</div><div className="tl-meta"><b>Duração:</b> {dur}</div><div className="tl-meta"><b>Operador:</b> {ev.who}</div>{ev.notes ? <div className="tl-notes">{ev.notes}</div> : null}</div>)
                                    }
                                    if (ev.type === 'stop') {
                                      const dur = ev.end ? fmtDuracao(ev.when, ev.end) : '-'
                                      return (<div key={ev.id} className="tl-card tl-stop"><div className="tl-title">⛔ {ev.title}</div><div className="tl-meta"><b>Início:</b> {fmtDateTime(ev.when)}</div><div className="tl-meta"><b>Fim:</b> {ev.end ? fmtDateTime(ev.end) : '— (em aberto)'}</div><div className="tl-meta"><b>Duração:</b> {dur}</div><div className="tl-meta"><b>Operador:</b> {ev.who}</div><div className="tl-meta"><b>Motivo:</b> {ev.reason}</div>{ev.notes ? <div className="tl-notes">{ev.notes}</div> : null}</div>)
                                    }
                                    if (ev.type === 'interrupt') return (<div key={ev.id} className="tl-card tl-interrupt"><div className="tl-title">🟡 {ev.title}</div><div className="tl-meta"><b>Data/Hora:</b> {fmtDateTime(ev.when)}</div><div className="tl-meta"><b>Registrado por:</b> {ev.who}</div><div className="tl-meta muted">A O.P foi removida do painel e enviada ao fim da fila.</div></div>)
                                    return (<div key={ev.id} className="tl-card tl-end"><div className="tl-title">🏁 {ev.title}</div><div className="tl-meta"><b>Data/Hora:</b> {fmtDateTime(ev.when)}</div><div className="tl-meta"><b>Operador:</b> {ev.who}</div></div>)
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
