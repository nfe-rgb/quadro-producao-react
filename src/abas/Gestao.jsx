import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { supabase } from '../lib/supabaseClient';
import { MAQUINAS } from '../lib/constants';
import { formatMsToHHmm } from '../lib/paradasPorTurno';
import { getTurnoAtual } from '../lib/utils';
import '../styles/Gestao.css';

const parsePiecesPerBox = (val) => {
  if (val == null) return 0;
  const s = String(val).trim();
  if (!s) return 0;
  const digitsOnly = s.replace(/[^0-9]/g, '');
  if (!digitsOnly) return 0;
  return parseInt(digitsOnly, 10);
};

const parseFlexibleNumber = (val) => {
  if (val == null) return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  const s = String(val).trim();
  if (!s) return 0;
  const normalized = s
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
};

const formatMinutesToHM = (minutes) => {
  const mins = Math.max(0, Number(minutes) || 0);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}min`;
  if (h > 0) return `${h}h`;
  return `${m}min`;
};

const formatBRL = (val) => {
  const n = Number(val) || 0;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatKg = (val) => {
  const n = Number(val) || 0;
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatInt = (val) => (Number(val) || 0).toLocaleString('pt-BR');

const extractItemCodeFromOrderProduct = (product) => {
  if (!product) return null;
  const t = String(product);
  return t.split('-')[0]?.trim() || null;
};

function getPeriodoRange(p, selectedDate) {
  const nowZ = DateTime.now().setZone('America/Sao_Paulo');
  let startZ = null;
  let endZ = null;
  if (p === 'hoje') {
    startZ = nowZ.startOf('day');
    endZ = nowZ.endOf('day');
  } else if (p === 'ontem') {
    const ontemZ = nowZ.minus({ days: 1 });
    startZ = ontemZ.startOf('day');
    endZ = ontemZ.endOf('day');
  } else if (p === 'semana') {
    const mondayZ = nowZ.startOf('week');
    startZ = mondayZ;
    endZ = nowZ;
  } else if (p === 'mes') {
    startZ = nowZ.startOf('month');
    endZ = nowZ;
  } else if (p === 'mespassado') {
    const lastMonthZ = nowZ.minus({ months: 1 });
    startZ = lastMonthZ.startOf('month');
    endZ = lastMonthZ.endOf('month');
  } else if (p === 'custom') {
    if (selectedDate) {
      const dZ = DateTime.fromISO(selectedDate, { zone: 'America/Sao_Paulo' });
      startZ = dZ.startOf('day');
      endZ = dZ.endOf('day');
    }
  }
  const start = startZ ? startZ.toUTC().toJSDate() : null;
  const end = endZ ? endZ.toUTC().toJSDate() : null;
  return { start, end };
}

function getTurnoIntervalsDiaLocal(date) {
  const dia = date.getDay();
  if (dia === 0) {
    return [{ ini: 23 * 60, fim: 24 * 60, turnoKey: '3' }];
  }
  if (dia >= 1 && dia <= 5) {
    return [
      { ini: 5 * 60, fim: 13 * 60 + 30, turnoKey: '1' },
      { ini: 13 * 60 + 30, fim: 22 * 60, turnoKey: '2' },
      { ini: 22 * 60, fim: 24 * 60, turnoKey: '3' },
      { ini: 0, fim: 5 * 60, turnoKey: '3' },
    ];
  }
  if (dia === 6) {
    return [
      { ini: 0, fim: 5 * 60, turnoKey: '3' },
      { ini: 5 * 60, fim: 9 * 60, turnoKey: '1' },
      { ini: 9 * 60, fim: 13 * 60, turnoKey: '2' },
    ];
  }
  return [];
}

export default function Gestao() {
  const [periodo, setPeriodo] = useState('hoje');
  const [selectedDate, setSelectedDate] = useState('');
  const [viewMode, setViewMode] = useState('resumo');

  const [bipagens, setBipagens] = useState([]);
  const [refugos, setRefugos] = useState([]);
  const [paradas, setParadas] = useState([]);
  const [apontamentos, setApontamentos] = useState([]);
  const [orders, setOrders] = useState([]);
  const [openOrders, setOpenOrders] = useState([]);
  const [itemsMap, setItemsMap] = useState({});
  const [valorViewType, setValorViewType] = useState('setor');
  const [valorSetorFiltro, setValorSetorFiltro] = useState('pet');
  const [valorMachineFiltro, setValorMachineFiltro] = useState(MAQUINAS[0] || '');

  const periodoRange = useMemo(() => getPeriodoRange(periodo, selectedDate), [periodo, selectedDate]);
  const filtroStart = periodoRange.start;
  const filtroEnd = periodoRange.end;

  const grupoPET = useMemo(() => MAQUINAS.filter(m => String(m).toUpperCase().startsWith('P')), []);
  const grupoINJ = useMemo(() => MAQUINAS.filter(m => String(m).toUpperCase().startsWith('I')), []);
  const maquinasFiltradas = useMemo(() => {
    if (valorViewType === 'maquina') {
      return valorMachineFiltro ? [valorMachineFiltro] : [];
    }
    return valorSetorFiltro === 'inj' ? grupoINJ : grupoPET;
  }, [valorViewType, valorMachineFiltro, valorSetorFiltro, grupoINJ, grupoPET]);

  const duracaoTurnoHoras = useMemo(() => {
    if (!filtroStart || !filtroEnd) return { '1': 0, '2': 0, '3': 0 };
    const resMs = { '1': 0, '2': 0, '3': 0 };

    let cursor = DateTime.fromJSDate(filtroStart).setZone('America/Sao_Paulo').startOf('day');
    const endZ = DateTime.fromJSDate(filtroEnd).setZone('America/Sao_Paulo').endOf('day');

    while (cursor <= endZ) {
      const fatias = getTurnoIntervalsDiaLocal(cursor.toJSDate());
      fatias.forEach((f) => {
        let iniMin = f.ini;
        let fimMin = f.fim;
        if (fimMin <= iniMin) fimMin += 24 * 60;
        const durMin = Math.max(0, fimMin - iniMin);
        resMs[f.turnoKey] = (resMs[f.turnoKey] || 0) + (durMin * 60 * 1000);
      });
      cursor = cursor.plus({ days: 1 });
    }

    return {
      '1': (resMs['1'] || 0) / (1000 * 60 * 60),
      '2': (resMs['2'] || 0) / (1000 * 60 * 60),
      '3': (resMs['3'] || 0) / (1000 * 60 * 60),
    };
  }, [filtroStart, filtroEnd]);

  useEffect(() => {
    let mounted = true;

    async function fetchData() {
      if (!filtroStart || !filtroEnd) {
        if (!mounted) return;
        setBipagens([]);
        setRefugos([]);
        setParadas([]);
        setApontamentos([]);
        setOrders([]);
        return;
      }

      try {
        const bipQuery = supabase
          .from('production_scans')
          .select('*')
          .gte('created_at', filtroStart.toISOString())
          .lte('created_at', filtroEnd.toISOString());

        const refQuery = supabase
          .from('scrap_logs')
          .select('*')
          .gte('created_at', filtroStart.toISOString())
          .lte('created_at', filtroEnd.toISOString());

        const paradaQuery = supabase
          .from('machine_stops')
          .select('*')
          .lte('started_at', filtroEnd.toISOString())
          .or(`resumed_at.gte.${filtroStart.toISOString()},resumed_at.is.null`);

        const apontQuery = supabase
          .from('injection_production_entries')
          .select('*')
          .gte('created_at', filtroStart.toISOString())
          .lte('created_at', filtroEnd.toISOString());

        const [bipRes, refRes, parRes, apRes] = await Promise.all([bipQuery, refQuery, paradaQuery, apontQuery]);
        if (!mounted) return;

        const bip = bipRes?.data || [];
        const ref = refRes?.data || [];
        const par = parRes?.data || [];
        const aps = apRes?.data || [];

        setBipagens(bip);
        setRefugos(ref);
        setParadas(par);
        setApontamentos(aps);

        const orderIdsSet = new Set();
        bip.forEach(b => { if (b.order_id != null) orderIdsSet.add(String(b.order_id)); });
        ref.forEach(r => { if (r.order_id != null) orderIdsSet.add(String(r.order_id)); });
        aps.forEach(a => { if (a.order_id != null) orderIdsSet.add(String(a.order_id)); });

        const orderIds = Array.from(orderIdsSet);
        if (orderIds.length > 0) {
          const { data: ords } = await supabase
            .from('orders')
            .select('id, code, product, standard, created_at')
            .in('id', orderIds);
          if (!mounted) return;
          setOrders(ords || []);
        } else {
          setOrders([]);
        }
      } catch (err) {
        console.warn('Erro ao buscar dados de gestao:', err);
        if (mounted) {
          setBipagens([]);
          setRefugos([]);
          setParadas([]);
          setApontamentos([]);
          setOrders([]);
        }
      }
    }

    fetchData();
    return () => { mounted = false; };
  }, [filtroStart, filtroEnd]);

  useEffect(() => {
    let active = true;

    async function fetchOpenOrders() {
      try {
        const { data, error } = await supabase
          .from('orders')
          .select(`
            id,
            machine_id,
            pos,
            code,
            product,
            qty,
            boxes,
            standard,
            scanned_count:production_scans(count)
          `)
          .eq('finalized', false)
          .order('machine_id', { ascending: true })
          .order('pos', { ascending: true });

        if (error) throw error;
        if (!active) return;

        const normalized = (data || []).map(row => {
          const sc = row.scanned_count;
          if (Array.isArray(sc) && sc.length > 0 && typeof sc[0]?.count !== 'undefined') {
            return { ...row, scanned_count: Number(sc[0].count || 0) };
          }
          if (sc && typeof sc === 'object' && typeof sc.count !== 'undefined') {
            return { ...row, scanned_count: Number(sc.count || 0) };
          }
          return { ...row, scanned_count: typeof sc === 'number' ? sc : Number(sc || 0) };
        });

        setOpenOrders(normalized);
      } catch (err) {
        console.warn('Falha ao buscar ordens abertas para linha do tempo:', err);
        if (active) setOpenOrders([]);
      }
    }

    fetchOpenOrders();

    return () => { active = false; };
  }, []);

  useEffect(() => {
    const codes = new Set();
    (orders || []).forEach(o => {
      const code = extractItemCodeFromOrderProduct(o?.product);
      if (code) codes.add(code);
    });
    (openOrders || []).forEach(o => {
      const code = extractItemCodeFromOrderProduct(o?.product);
      if (code) codes.add(code);
    });
    (apontamentos || []).forEach(a => {
      const code = extractItemCodeFromOrderProduct(a?.product);
      if (code) codes.add(code);
    });
    if (codes.size === 0) {
      setItemsMap({});
      return;
    }

    let active = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('items')
          .select('code, unit_value, part_weight_g, cycle_seconds, cavities')
          .in('code', Array.from(codes));
        if (error) throw error;
        if (!active) return;
        const map = {};
        (data || []).forEach(it => {
          const code = String(it.code || '').trim();
          if (!code) return;
          map[code] = it;
        });
        setItemsMap(map);
      } catch (err) {
        console.warn('Falha ao buscar itens para gestao:', err);
        if (active) setItemsMap({});
      }
    })();

    return () => { active = false; };
  }, [orders, openOrders, apontamentos]);

  const ordersMap = useMemo(() => {
    const map = {};
    (orders || []).forEach(o => { if (o && o.id != null) map[String(o.id)] = o; });
    return map;
  }, [orders]);

  const getItemMetaFromProduct = (productStr) => {
    const code = extractItemCodeFromOrderProduct(productStr);
    if (!code) return { unitValue: 0, weightKg: 0, cycleSeconds: 0, cavities: 0 };
    const raw = itemsMap && itemsMap[code] ? itemsMap[code] : null;
    const unitValue = Number(raw?.unit_value) || 0;
    const weightKg = (Number(raw?.part_weight_g) || 0) / 1000;
    const cycleSeconds = Number(raw?.cycle_seconds) || 0;
    const cavities = Number(raw?.cavities) || 0;
    return { unitValue, weightKg, cycleSeconds, cavities };
  };

  const valorizacaoPorTurno = useMemo(() => {
    const machineList = maquinasFiltradas;

    const machineSet = new Set(machineList.map(m => String(m)));
    const byShiftMachine = {
      '1': Object.fromEntries(machineList.map(m => [m, { producedPieces: 0, valor: 0, productPieces: {} }])),
      '2': Object.fromEntries(machineList.map(m => [m, { producedPieces: 0, valor: 0, productPieces: {} }])),
      '3': Object.fromEntries(machineList.map(m => [m, { producedPieces: 0, valor: 0, productPieces: {} }])),
    };

    const pushProduct = (bucket, product, qty) => {
      const key = String(product || '').trim();
      if (!key || qty <= 0) return;
      bucket.productPieces[key] = (bucket.productPieces[key] || 0) + qty;
    };

    (bipagens || []).forEach((b) => {
      const machine = String(b.machine_id || '');
      if (!machineSet.has(machine)) return;
      const shift = String(b.shift || getTurnoAtual(b.created_at));
      if (!byShiftMachine[shift] || !byShiftMachine[shift][machine]) return;

      const order = b.order_id != null ? ordersMap[String(b.order_id)] : null;
      const std = parsePiecesPerBox(order?.standard);
      if (std <= 0) return;
      const product = order?.product || '';
      const { unitValue } = getItemMetaFromProduct(product);

      const bucket = byShiftMachine[shift][machine];
      bucket.producedPieces += std;
      if (unitValue > 0) bucket.valor += std * unitValue;
      pushProduct(bucket, product, std);
    });

    (apontamentos || []).forEach((a) => {
      const machine = String(a.machine_id || '');
      if (!machineSet.has(machine)) return;
      const shift = String(a.shift || getTurnoAtual(a.created_at));
      if (!byShiftMachine[shift] || !byShiftMachine[shift][machine]) return;

      const qty = Number(a.good_qty) || 0;
      if (qty <= 0) return;
      const order = a.order_id != null ? ordersMap[String(a.order_id)] : null;
      const product = a.product || order?.product || '';
      const { unitValue } = getItemMetaFromProduct(product);

      const bucket = byShiftMachine[shift][machine];
      bucket.producedPieces += qty;
      if (unitValue > 0) bucket.valor += qty * unitValue;
      pushProduct(bucket, product, qty);
    });

    const rows = ['1', '2', '3'].map((shift) => {
      let producedPieces = 0;
      let valorAtual = 0;
      let metaPecas = 0;
      let metaValor = 0;

      machineList.forEach((machine) => {
        const bucket = byShiftMachine[shift]?.[machine];
        if (!bucket) return;
        producedPieces += bucket.producedPieces;
        valorAtual += bucket.valor;

        const predominantProduct = Object.keys(bucket.productPieces || {}).sort((a, b) => (bucket.productPieces[b] || 0) - (bucket.productPieces[a] || 0))[0] || '';
        if (!predominantProduct) return;

        const { cycleSeconds, cavities, unitValue } = getItemMetaFromProduct(predominantProduct);
        const piecesPerHour = cycleSeconds > 0 && cavities > 0 ? (3600 / cycleSeconds) * cavities : 0;
        const shiftHours = Number(duracaoTurnoHoras[shift] || 0);
        if (piecesPerHour <= 0 || shiftHours <= 0) return;

        const machineMetaPecas = Math.round(piecesPerHour * shiftHours);
        if (machineMetaPecas > 0) {
          metaPecas += machineMetaPecas;
          if (unitValue > 0) metaValor += machineMetaPecas * unitValue;
        }
      });

      return {
        shift,
        producedPieces,
        valorAtual,
        metaPecas,
        metaValor,
      };
    });

    return { machineList, rows };
  }, [maquinasFiltradas, bipagens, apontamentos, ordersMap, duracaoTurnoHoras, itemsMap]);

  const resumoFiltrado = useMemo(() => {
    const machineSet = new Set(maquinasFiltradas.map(m => String(m)));
    const summary = {
      goodPieces: 0,
      scrapPieces: 0,
      scrapByReason: {},
      scrapKgByReason: {},
      scrapTotalKg: 0,
      producedKg: 0,
      valorizacao: 0,
      stopsByReasonMs: {},
      stopsTotalMs: 0,
      oeePct: null,
    };

    (bipagens || []).forEach(b => {
      if (!machineSet.has(String(b.machine_id))) return;
      const order = b.order_id != null ? ordersMap[String(b.order_id)] : null;
      const std = parsePiecesPerBox(order?.standard);
      if (std <= 0) return;
      const product = order?.product || '';
      const { unitValue, weightKg } = getItemMetaFromProduct(product);
      summary.goodPieces += std;
      summary.producedKg += std * weightKg;
      summary.valorizacao += std * unitValue;
    });

    (apontamentos || []).forEach(a => {
      if (!machineSet.has(String(a.machine_id))) return;
      const qty = Number(a.good_qty) || 0;
      if (qty <= 0) return;
      const order = a.order_id != null ? ordersMap[String(a.order_id)] : null;
      const product = a.product || order?.product || '';
      const { unitValue, weightKg } = getItemMetaFromProduct(product);
      summary.goodPieces += qty;
      summary.producedKg += qty * weightKg;
      summary.valorizacao += qty * unitValue;
    });

    (refugos || []).forEach(r => {
      if (!machineSet.has(String(r.machine_id))) return;
      const qty = Number(r.qty) || 0;
      if (qty <= 0) return;
      const reason = (String(r.reason || '').trim()) || 'Sem motivo';
      const order = r.order_id != null ? ordersMap[String(r.order_id)] : null;
      const product = order?.product || '';
      const { weightKg } = getItemMetaFromProduct(product);
      summary.scrapPieces += qty;
      summary.scrapTotalKg += qty * weightKg;
      summary.scrapByReason[reason] = (summary.scrapByReason[reason] || 0) + qty;
      summary.scrapKgByReason[reason] = (summary.scrapKgByReason[reason] || 0) + (qty * weightKg);
    });

    const nowMs = Date.now();
    const filtroStartMs = filtroStart ? filtroStart.getTime() : null;
    const filtroEndMs = filtroEnd ? filtroEnd.getTime() : null;

    (paradas || []).forEach(p => {
      if (!machineSet.has(String(p.machine_id))) return;
      if (!p.started_at) return;
      const iniMs = new Date(p.started_at).getTime();
      const fimMs = p.resumed_at ? new Date(p.resumed_at).getTime() : Math.min(filtroEndMs || nowMs, nowMs);
      if (!Number.isFinite(iniMs) || !Number.isFinite(fimMs) || fimMs <= iniMs) return;
      if (filtroStartMs == null || filtroEndMs == null) return;
      const clipIni = Math.max(iniMs, filtroStartMs);
      const clipFim = Math.min(fimMs, filtroEndMs);
      if (clipFim <= clipIni) return;
      const reason = (String(p.reason || '').trim()) || 'Sem motivo';
      const dur = clipFim - clipIni;
      summary.stopsTotalMs += dur;
      summary.stopsByReasonMs[reason] = (summary.stopsByReasonMs[reason] || 0) + dur;
    });

    return summary;
  }, [maquinasFiltradas, bipagens, refugos, paradas, apontamentos, ordersMap, itemsMap, filtroStart, filtroEnd]);

  const timelineByMachine = useMemo(() => {
    const now = DateTime.now().setZone('America/Sao_Paulo');
    const grouped = Object.fromEntries(maquinasFiltradas.map(m => [m, []]));

    (openOrders || []).forEach(order => {
      const machine = String(order?.machine_id || '');
      if (!grouped[machine]) return;
      grouped[machine].push(order);
    });

    return maquinasFiltradas.map(machine => {
      const queue = [...(grouped[machine] || [])].sort((a, b) => (a.pos ?? 999) - (b.pos ?? 999));
      let cursor = now;
      let canAdvance = true;

      const rows = queue.map((order, index) => {
        const isCurrent = index === 0;
        const itemCode = extractItemCodeFromOrderProduct(order?.product);
        const itemMeta = itemCode ? itemsMap[itemCode] : null;
        const cycleSeconds = Number(itemMeta?.cycle_seconds) || 0;
        const cavities = Number(itemMeta?.cavities) || 0;
        const piecesPerHour = cycleSeconds > 0 && cavities > 0 ? (3600 / cycleSeconds) * cavities : 0;

        const totalPieces = parseFlexibleNumber(order?.qty);
        const totalBoxes = parseFlexibleNumber(order?.boxes);
        const scannedBoxes = Number(order?.scanned_count) || 0;
        const saldoBoxes = Math.max(0, totalBoxes - scannedBoxes);
        const piecesPerBox = totalBoxes > 0 && totalPieces > 0 ? (totalPieces / totalBoxes) : 0;

        const remainingPieces = isCurrent
          ? (saldoBoxes > 0 && piecesPerBox > 0 ? saldoBoxes * piecesPerBox : totalPieces)
          : totalPieces;

        const durationMinutes = piecesPerHour > 0 && remainingPieces > 0
          ? Math.ceil((remainingPieces / piecesPerHour) * 60)
          : null;

        const startAt = canAdvance ? cursor : null;
        const timeToStartMinutes = startAt ? Math.max(0, Math.round(startAt.diff(now, 'minutes').minutes)) : null;

        let endAt = null;
        if (canAdvance && durationMinutes != null) {
          endAt = startAt.plus({ minutes: durationMinutes });
          cursor = endAt;
        } else {
          canAdvance = false;
        }

        return {
          id: order.id,
          code: order.code,
          machine,
          isCurrent,
          startAt,
          endAt,
          timeToStartMinutes,
          durationMinutes,
        };
      });

      return { machine, rows };
    });
  }, [openOrders, itemsMap, maquinasFiltradas]);

  const renderScrapRows = (summary) => {
    const rows = Object.keys(summary.scrapByReason || {}).map(reason => {
      const pieces = summary.scrapByReason[reason] || 0;
      const kg = summary.scrapKgByReason[reason] || 0;
      const total = summary.scrapPieces || 0;
      const pct = total > 0 ? (pieces / total) * 100 : 0;
      return { reason, pieces, kg, pct };
    });
    rows.sort((a, b) => b.pieces - a.pieces);
    return rows;
  };

  const renderStopRows = (summary) => {
    const rows = Object.keys(summary.stopsByReasonMs || {}).map(reason => ({
      reason,
      ms: summary.stopsByReasonMs[reason] || 0,
    }));
    rows.sort((a, b) => b.ms - a.ms);
    return rows;
  };

  const renderSetor = (title, summary) => {
    const totalPieces = summary.goodPieces + summary.scrapPieces;
    const scrapPct = totalPieces > 0 ? (summary.scrapPieces / totalPieces) * 100 : 0;
    const scrapRows = renderScrapRows(summary);
    const stopRows = renderStopRows(summary);

    return (
      <div className="gestao-setor card">
        <div className="gestao-setor-title">{title}</div>
        <div className="gestao-kpis">
          <div className="gestao-kpi">
            <div className="gestao-kpi-title">OEE</div>
            <div className="gestao-kpi-value">—</div>
            <div className="gestao-kpi-sub">Estrutura pronta</div>
          </div>
          <div className="gestao-kpi">
            <div className="gestao-kpi-title">Refugo Total</div>
            <div className="gestao-kpi-value">{formatInt(summary.scrapPieces)} pecas</div>
            <div className="gestao-kpi-sub">{formatKg(summary.scrapTotalKg)} kg • {scrapPct.toFixed(2)}%</div>
          </div>
          <div className="gestao-kpi">
            <div className="gestao-kpi-title">Produção Boa</div>
            <div className="gestao-kpi-value">{formatInt(summary.goodPieces)} peças</div>
            <div className="gestao-kpi-sub">{formatKg(summary.producedKg)} kg</div>
          </div>
          <div className="gestao-kpi">
            <div className="gestao-kpi-title">Valorização</div>
            <div className="gestao-kpi-value">{formatBRL(summary.valorizacao)}</div>
            <div className="gestao-kpi-sub">Baseado em valor cadastrado</div>
          </div>
          <div className="gestao-kpi">
            <div className="gestao-kpi-title">Horas Paradas</div>
            <div className="gestao-kpi-value">{formatMsToHHmm(summary.stopsTotalMs)}</div>
            <div className="gestao-kpi-sub">Somatório do período</div>
          </div>
        </div>

        <div className="gestao-tables">
          <div className="gestao-table card">
            <div className="gestao-table-title">Refugo por Motivo</div>
            {scrapRows.length === 0 ? (
              <div className="gestao-empty">—</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Motivo</th>
                    <th>peças</th>
                    <th>kg</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {scrapRows.map(row => (
                    <tr key={row.reason}>
                      <td>{row.reason}</td>
                      <td>{formatInt(row.pieces)}</td>
                      <td>{formatKg(row.kg)}</td>
                      <td>{row.pct.toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="gestao-table card">
            <div className="gestao-table-title">Paradas por Motivo</div>
            {stopRows.length === 0 ? (
              <div className="gestao-empty">—</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Motivo</th>
                    <th>Duração</th>
                  </tr>
                </thead>
                <tbody>
                  {stopRows.map(row => (
                    <tr key={row.reason}>
                      <td>{row.reason}</td>
                      <td>{formatMsToHHmm(row.ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="gestao-card card">
      <div className="card-inner">
        <div className="gestao-title label">Gestão de Produção</div>

        <div className="gestao-filtros">
          <div className="select-wrap">
            <select
              className="period-select"
              aria-label="Selecionar periodo"
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
            <div className="custom-dates">
              <input
                className="date-input"
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
              />
            </div>
          )}

          <button
            className="btn"
            onClick={() => setViewMode(v => (v === 'resumo' ? 'timeline' : 'resumo'))}
          >
            {viewMode === 'resumo' ? 'Entrar em linha do tempo' : 'Voltar para gestão'}
          </button>
        </div>

        <div className="gestao-table card" style={{ marginBottom: 12 }}>
          <div className="gestao-table-title">Valorização por Turno</div>
          <div className="gestao-val-filters">
            <div className="select-wrap">
              <select
                className="period-select"
                value={valorViewType}
                onChange={(e) => setValorViewType(e.target.value)}
              >
                <option value="setor">Aglomerado por setor</option>
                <option value="maquina">Por máquina</option>
              </select>
            </div>

            {valorViewType === 'setor' ? (
              <div className="select-wrap">
                <select
                  className="period-select"
                  value={valorSetorFiltro}
                  onChange={(e) => setValorSetorFiltro(e.target.value)}
                >
                  <option value="pet">PET</option>
                  <option value="inj">Injeção</option>
                </select>
              </div>
            ) : (
              <div className="select-wrap">
                <select
                  className="period-select"
                  value={valorMachineFiltro}
                  onChange={(e) => setValorMachineFiltro(e.target.value)}
                >
                  {MAQUINAS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <table>
            <thead>
              <tr>
                <th>Turno</th>
                <th>Produção</th>
                <th>Meta (peças)</th>
                <th>Valorização</th>
                <th>Meta (R$)</th>
              </tr>
            </thead>
            <tbody>
              {valorizacaoPorTurno.rows.map((row) => (
                <tr key={row.shift}>
                  <td>Turno {row.shift}</td>
                  <td>{formatInt(row.producedPieces)} peças</td>
                  <td>{row.metaPecas > 0 ? `${formatInt(row.metaPecas)} peças` : '—'}</td>
                  <td>{formatBRL(row.valorAtual)}</td>
                  <td>{row.metaValor > 0 ? formatBRL(row.metaValor) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {viewMode === 'resumo' ? (
          <div className="gestao-sectors">
            {renderSetor(
              valorViewType === 'setor'
                ? (valorSetorFiltro === 'inj' ? 'Injeção' : 'PET')
                : `Máquina ${valorMachineFiltro}`,
              resumoFiltrado
            )}
          </div>
        ) : (
          <div className="gestao-timeline-wrap">
            {timelineByMachine.every(group => group.rows.length === 0) ? (
              <div className="gestao-empty">Sem ordens abertas para exibir na linha do tempo.</div>
            ) : (
              timelineByMachine
                .filter(group => group.rows.length > 0)
                .map(group => (
                  <div key={group.machine} className="gestao-timeline-machine card">
                    <div className="gestao-table-title">Máquina {group.machine}</div>
                    <div className="gestao-timeline-list">
                      {group.rows.map((row) => (
                        <div key={row.id} className="gestao-timeline-item">
                          <div className="gestao-timeline-dot" />
                          <div className="gestao-timeline-content">
                            <div className="gestao-timeline-head">
                              <strong>O.P {row.code || '—'}</strong>
                              <span className="gestao-kpi-sub">{row.isCurrent ? 'Em produção' : 'Na fila'}</span>
                            </div>
                            {row.startAt ? (
                              <div className="gestao-kpi-sub">
                                Entrada prevista: {row.startAt.toFormat('dd/LL/yyyy - HH:mm')}
                                {!row.isCurrent && row.timeToStartMinutes != null ? ` (em ${formatMinutesToHM(row.timeToStartMinutes)})` : ''}
                              </div>
                            ) : (
                              <div className="gestao-kpi-sub">Entrada prevista: sem cálculo disponível</div>
                            )}
                            {row.endAt ? (
                              <div className="gestao-kpi-sub">Fim estimado: {row.endAt.toFormat('dd/LL/yyyy - HH:mm')}</div>
                            ) : (
                              <div className="gestao-kpi-sub">Fim estimado: sem cálculo disponível</div>
                            )}
                            <div className="gestao-kpi-sub">
                              Duração estimada: {row.durationMinutes != null ? formatMinutesToHM(row.durationMinutes) : 'sem cálculo disponível'}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
