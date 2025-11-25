// src/abas/Registro.jsx
// Observação: imagem enviada pelo usuário (path local): /mnt/data/a45bfa5c-8539-4b8a-8e43-14eb0c0bab14.png

import { useState, useMemo, useEffect } from 'react'
import PieChartIndicadores from '../components/PieChartIndicadores'
import { fmtDateTime, fmtDuracao } from '../lib/utils'
import { MAQUINAS } from '../lib/constants'

const UPLOADED_IMAGE = '/mnt/data/a45bfa5c-8539-4b8a-8e43-14eb0c0bab14.png'

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

  // Definir maquinasConsideradas após o useState de filtroMaquina
  let maquinasConsideradas = filtroMaquina === 'todas' ? MAQUINAS : [filtroMaquina];
  maquinasConsideradas = maquinasConsideradas.filter(m => MAQUINAS.includes(m));

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

      // Corrigido: verifica stops abertos ou que cruzam o filtro (relevantes)
      const hasOpenStop = (g.stops || []).some(st => {
        const stIni = toTime(st.started_at)
        const stFim = toTime(st.resumed_at)
        // Considera stop relevante se iniciou antes do fim do filtro
        // e (ou) não foi retomado, ou foi retomado depois do início do filtro.
        return stIni && stIni < filtroEnd.getTime() && (!stFim || stFim >= filtroStart.getTime());
      })

      // incluir O.P. se ela cruza o início do filtro (começou antes e terminou depois do início do filtro)
      const cruzouInicioFiltro = iniMs && iniMs < filtroStart.getTime() && fimMs && fimMs >= filtroStart.getTime();

      // Exclui ordens que foram finalizadas/interrompidas antes do início do filtro (mas mantém as que cruzam o início)
      const interruptedMs = toTime(o.interrupted_at);
      const endedBeforeFilter = (fimMs && fimMs < filtroStart.getTime() && !cruzouInicioFiltro) || (interruptedMs && interruptedMs < filtroStart.getTime());
      if (endedBeforeFilter) return false;

      const startedInRange = iniMs && iniMs < filtroEnd.getTime() && (!fimMs || fimMs >= filtroStart.getTime());
      const finalizedInRange = fimMs && fimMs >= filtroStart.getTime() && fimMs <= filtroEnd.getTime();
      const openInRange = !fimMs && iniMs < filtroEnd.getTime();
      const resultado = startedInRange || finalizedInRange || openInRange || cruzouInicioFiltro || hasOpenStop;
      return resultado;
    })
  }, [registroGrupos, filtroStart, filtroEnd, periodo, customStart, customEnd, tick])

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

    // Verificações defensivas para filtroStart/filtroEnd
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
      };
    }

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

    function unirArrays(intervalos) {
      if (!intervalos.length) return [];
      intervalos.sort((a, b) => a[0] - b[0]);
      const unidos = [intervalos[0].slice()];
      for (let i = 1; i < intervalos.length; i++) {
        const ultimo = unidos[unidos.length - 1];
        const atual = intervalos[i];
        if (atual[0] <= ultimo[1]) {
          ultimo[1] = Math.max(ultimo[1], atual[1]);
        } else {
          unidos.push([atual[0], atual[1]]);
        }
      }
      return unidos;
    }

    // CORRIGIDO: Percorre todas as máquinas do filtro
    for (const m of maquinasConsideradas) {
      const gruposOrdenados = (gruposPorMaquina[m] || []).slice().sort((a, b) => {
        const ta = toTime(a?.ordem?.started_at) || 0;
        const tb = toTime(b?.ordem?.started_at) || 0;
        return ta - tb;
      });
      let paradaMsMaquina = 0;
      let prodMsMaquina = 0;

      // Para evitar erro de 'sem programação' antes da primeira O.P. e após a última O.P.
      const firstOP = gruposOrdenados[0]?.ordem;
      const lastOP = gruposOrdenados[gruposOrdenados.length - 1]?.ordem;
      const firstOPStart = toTime(firstOP?.started_at);
      const lastOPEnd = toTime(lastOP?.finalized_at);

      // Se não há O.P. para a máquina no período, contabiliza sem programação para o período inteiro
      if (gruposOrdenados.length === 0) {
        totalSemProgMs += filtroEnd.getTime() - filtroStart.getTime();
        machineParadaMs[m] = 0;
        continue;
      }

      // Se a última O.P. terminou antes do início do filtro -> sem programação desde filtroStart até próxima OP (ou até filtroEnd)
      if (!lastOP || (lastOPEnd && lastOPEnd < filtroStart.getTime())) {
        const proxOP = gruposOrdenados.find(g => toTime(g?.ordem?.started_at) > filtroStart.getTime());
        const inicioSemProg = filtroStart.getTime();
        const fimSemProg = proxOP ? toTime(proxOP?.ordem?.started_at) : filtroEnd.getTime();
        if (fimSemProg > inicioSemProg) {
          totalSemProgMs += fimSemProg - inicioSemProg;
        }
      } else if (lastOPEnd && lastOPEnd < filtroEnd.getTime()) {
        const inicioSemProg = lastOPEnd;
        const fimSemProg = filtroEnd.getTime();
        if (fimSemProg > inicioSemProg) {
          totalSemProgMs += fimSemProg - inicioSemProg;
        }
      }


      gruposOrdenados.forEach((g, idx) => {
        const o = g.ordem || {};
        const intervals = [];
        let lastStart = toTime(o.started_at);
        let lastEnd = null;

        if (!lastStart) {
          return;
        }

        // Corrigido: sempre cria intervalo de produção para O.P. finalizada,
        // mesmo que tenha começado antes do filtro (clipping com filtro)
        if (safe(o.finalized_at)) {
          const ini = Math.max(toTime(o.started_at) || filtroStart.getTime(), filtroStart.getTime());
          const fim = Math.min(toTime(o.finalized_at), filtroEnd.getTime());
          if (fim > ini) intervals.push({ tipo: 'producao', ini, fim });
        }

        // Paradas (todas, não só abertas)
        const paradaIntervalsTodos = (g.stops || []).map(st => {
          const stIni = toTime(st.started_at);
          // Se a parada está em aberto, usa o horário atual (Date.now()), mas nunca ultrapassa filtroEnd
          let stFim;
          if (safe(st.resumed_at)) {
            stFim = toTime(st.resumed_at);
          } else {
            stFim = Math.min(Date.now(), filtroEnd.getTime());
          }
          const ini = Math.max(stIni, filtroStart.getTime());
          const fim = Math.min(stFim, filtroEnd.getTime());
          return ini < fim ? [ini, fim] : null;
        }).filter(Boolean);
        // Unir e somar todos os intervalos de parada
        const paradaUnidaTodos = unirArrays(paradaIntervalsTodos);
        let deltaParadaTodos = 0;
        paradaUnidaTodos.forEach(([ini, fim]) => {
          deltaParadaTodos += Math.max(0, fim - ini);
        });
        paradaMsMaquina += deltaParadaTodos;

        // reinicios/interrupções/final
        const reinicios = [];
        if (safe(o.restarted_at)) reinicios.push({ t: toTime(o.restarted_at), type: 'restart' });
        if (safe(o.interrupted_at)) reinicios.push({ t: toTime(o.interrupted_at), type: 'interrupt' });
        if (safe(o.finalized_at)) reinicios.push({ t: toTime(o.finalized_at), type: 'final' });
        reinicios.sort((a, b) => a.t - b.t);

        if (reinicios.length === 0) {
          // Se a O.P. está aberta, considera até o fim do filtro
          if (!safe(o.finalized_at)) {
            lastEnd = Date.now();
            if (filtroEnd && lastEnd > filtroEnd.getTime()) lastEnd = filtroEnd.getTime();
            if (lastEnd > lastStart) intervals.push({ tipo: 'producao', ini: lastStart, fim: lastEnd });
          } else {
            lastEnd = toTime(o.finalized_at);
            if (lastEnd > lastStart) intervals.push({ tipo: 'producao', ini: lastStart, fim: lastEnd });
          }
        } else {
          let cursor = lastStart;
          for (let i = 0; i < reinicios.length; i++) {
            const r = reinicios[i];
            if (r.type === 'interrupt' || r.type === 'final') {
              if (r.t > cursor) intervals.push({ tipo: 'producao', ini: cursor, fim: r.t });
              const nextRestart = reinicios.find(x => x.type === 'restart' && x.t > r.t);
              if (nextRestart) {
                cursor = nextRestart.t;
              } else {
                cursor = null;
                // Se for o último evento e for 'final', garantir que o tempo entre o fim da última parada e o final da O.P. seja contabilizado
                if (r.type === 'final' && r.t < toTime(o.finalized_at)) {
                  const finalTime = toTime(o.finalized_at);
                  if (finalTime > r.t) intervals.push({ tipo: 'producao', ini: r.t, fim: finalTime });
                }
              }
            }
          }
          // Se ainda restar tempo após o último evento até o fim do filtro ou final da O.P., contabiliza como produção
          if (cursor) {
            let fimAberto = filtroEnd.getTime();
            if (safe(o.finalized_at)) fimAberto = Math.min(fimAberto, toTime(o.finalized_at));
            if (fimAberto > cursor) intervals.push({ tipo: 'producao', ini: cursor, fim: fimAberto });
          }
        }

        // PROCESSA os intervals calculados para esta O.P.
        if (Array.isArray(intervals)) {
          intervals.forEach((intervalo) => {
            if (!intervalo || intervalo.tipo !== 'producao') return;
            const iniCalc = Math.max(intervalo.ini, filtroStart.getTime());
            const fimCalc = Math.min(intervalo.fim, filtroEnd.getTime());
            if (fimCalc > iniCalc) {
              let prodMs = fimCalc - iniCalc;

              // Unir intervalos de baixa eficiência para evitar sobreposição
              let lowEffIntervals = [];
              if (safe(o.loweff_started_at)) {
                const leIni = toTime(o.loweff_started_at);
                const leFim = toTime(o.loweff_ended_at) || intervalo.fim;
                const leIniCalc = Math.max(leIni, filtroStart.getTime(), iniCalc);
                const leFimCalc = Math.min(leFim, filtroEnd.getTime(), fimCalc);
                if (leIniCalc < leFimCalc) {
                  lowEffIntervals.push([leIniCalc, leFimCalc]);
                }
              }

              // Separar intervalos exclusivos de baixa eficiência e produção
              // 1. Unir todos os intervalos de baixa eficiência
              const allIntervals = unirArrays([...lowEffIntervals]);
              // 2. Criar lista de "eventos" (início/fim de cada intervalo)
              let eventos = [];
              allIntervals.forEach(([ini, fim]) => {
                eventos.push({ t: ini, tipo: 'ini' });
                eventos.push({ t: fim, tipo: 'fim' });
              });
              eventos.push({ t: iniCalc, tipo: 'iniTotal' });
              eventos.push({ t: fimCalc, tipo: 'fimTotal' });
              eventos = eventos.sort((a, b) => a.t - b.t);

              // 3. Percorrer timeline, marcando o que é cada fatia
              let fatias = [];
              let dentro = 0;
              let cursor = iniCalc;
              for (let i = 0; i < eventos.length; i++) {
                const ev = eventos[i];
                if (ev.t > cursor) {
                  fatias.push([cursor, ev.t, dentro]);
                  cursor = ev.t;
                }
                if (ev.tipo === 'ini') dentro++;
                if (ev.tipo === 'fim') dentro--;
              }

              // 4. Classificar cada fatia: baixa eficiência ou produção
              let totalLowEff = 0;
              let totalProd = 0;
              fatias.forEach(([ini, fim, dentro]) => {
                if (fim <= ini) return;
                // Verifica se está dentro de algum intervalo de baixa eficiência
                const isLowEff = lowEffIntervals.some(([leIni, leFim]) => ini < leFim && fim > leIni);
                if (isLowEff) {
                  totalLowEff += fim - ini;
                } else {
                  totalProd += fim - ini;
                }
              });
              // 5. Atualizar totais
              prodMs = totalProd;
              totalLowEffMs += totalLowEff;

              // desconto de fim de semana (se necessário)
              const descontoFimDeSemana = descontarFimDeSemana(iniCalc, fimCalc);
              prodMs -= descontoFimDeSemana;

              // soma para a máquina (observe: NÃO zera prodMsMaquina dentro do loop)
              prodMsMaquina += Math.max(0, prodMs);
            }
          });
        }

        // considera sem programação entre O.P. finalizada e próxima O.P. (dentro do filtro)
        const finalizedMs = toTime(o.finalized_at);
        if (finalizedMs) {
          const prox = nextStartForMachine(gruposPorMaquina[m], finalizedMs);
          if (prox) {
            const proxIni = toTime(prox.ordem.started_at) || filtroEnd.getTime();
            // Se houver intervalo real entre finalizedMs e proxIni dentro do filtro -> sem programação
            if (proxIni > finalizedMs && finalizedMs >= filtroStart.getTime() && proxIni <= filtroEnd.getTime()) {
              const delta = Math.max(0, proxIni - finalizedMs);
              totalSemProgMs += delta;
            }
          }
        }
      });

      const horasPeriodoMs = (filtroEnd.getTime() - filtroStart.getTime());
      let somaMs = prodMsMaquina + paradaMsMaquina;
      // se soma de produção+paradas extrapolar horas do período, corrige paradas
      if (somaMs > horasPeriodoMs) {
        paradaMsMaquina = Math.max(0, horasPeriodoMs - prodMsMaquina);
      }
      totalProdMs += prodMsMaquina;
      totalParadaMs += paradaMsMaquina;
      machineParadaMs[m] = paradaMsMaquina;
    }

    const totalProdH = totalProdMs / 1000 / 60 / 60;
    const totalParadaH = totalParadaMs / 1000 / 60 / 60;
    const totalLowEffH = totalLowEffMs / 1000 / 60 / 60;
    const totalSemProgH = totalSemProgMs / 1000 / 60 / 60;
    const totalH = totalProdH + totalParadaH + totalLowEffH + totalSemProgH;

    let horasPeriodo = 0;
    if (filtroStart && filtroEnd) {
      horasPeriodo = (filtroEnd.getTime() - filtroStart.getTime()) / 1000 / 60 / 60;
    }
    const totalDisponivelH = maquinasConsideradas.length * horasPeriodo;

    // agora pct usa totalDisponivelH (tempo disponível) como denominador
    const pct = v => totalDisponivelH ? ((v / totalDisponivelH) * 100).toFixed(1) : '0.0';
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
  }, [gruposPorMaquina, filtroStart, filtroEnd, filtroMaquina, tick, maquinasConsideradas.length]);

  function formatHoursToHMS(hoursDecimal) {
    const totalSec = Math.round((Number(hoursDecimal) || 0) * 3600);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = n => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  function formatPctFromHours(h) {
    // usa totalDisponivelH como denominador (percentual do tempo disponível)
    const pctNum = totalDisponivelH ? (Number(h) / totalDisponivelH) * 100 : 0;
    return `${pctNum.toFixed(1).replace('.', ',')}%`;
  }

  // Ajuste: normaliza os valores se a soma ultrapassar o totalDisponivelH
  const items = useMemo(() => {
    const raw = [
      { key: 'produzindo', label: 'Produzindo', valueH: totalProdH, color: '#0a7' },
      { key: 'parada', label: 'Parada', valueH: totalParadaH, color: '#e74c3c' },
      { key: 'loweff', label: 'Baixa Eficiência', valueH: totalLowEffH, color: '#ffc107' },
      { key: 'semprog', label: 'Sem Programação', valueH: totalSemProgH, color: '#3498db' }
    ];
    const soma = raw.reduce((acc, it) => acc + it.valueH, 0);
    if (totalDisponivelH > 0 && soma > totalDisponivelH) {
      // Normaliza proporcionalmente
      return raw.map(it => ({
        ...it,
        valueH: (it.valueH / soma) * totalDisponivelH
      }));
    }
    return raw;
  }, [totalProdH, totalParadaH, totalLowEffH, totalSemProgH, totalDisponivelH, tick]);

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
