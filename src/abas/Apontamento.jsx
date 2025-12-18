import { useEffect, useState, useMemo, useCallback } from 'react';
import { DateTime } from 'luxon';
import { supabase } from '../lib/supabaseClient';
import { MAQUINAS, REFUGO_MOTIVOS, TURNOS } from '../lib/constants';
import { fmtDateTime, getTurnoAtual } from '../lib/utils';
import useAuthAdmin from '../hooks/useAuthAdmin';
import { toBrazilTime } from '../lib/timezone';
import { calcularHorasParadasPorTurno, formatMsToHHmm } from '../lib/paradasPorTurno';
import '../styles/Apontamento.css';
import Modal from '../components/Modal';

export default function Apontamento({ isAdmin: _unusedIsAdminProp = false }) {
  const adminObj = typeof useAuthAdmin === 'function' ? useAuthAdmin() : { isAdmin: false, authUser: null };
  const isAdmin = Boolean(adminObj && adminObj.isAdmin); // só libera para admin verdadeiro
  const authEmail = String(adminObj?.authUser?.email || '').toLowerCase();
  const canSeeValorization = authEmail === 'nfe@savantiplasticos.com.br';
  const [bipagens, setBipagens] = useState([]);
  const [refugos, setRefugos] = useState([]);
  const [apontamentos, setApontamentos] = useState([]); // Produção manual das injetoras
  const [toast, setToast] = useState({ visible: false, type: 'ok', msg: '' });
  const [orders, setOrders] = useState([]); // O.S relevantes
  const [ordersAll, setOrdersAll] = useState([]); // Todas as O.S registradas
  const [paradas, setParadas] = useState([]); // Paradas de máquina
  const [itemsMap, setItemsMap] = useState({}); // Cache de itens (valor unitário)
  const [shiftResponsibles, setShiftResponsibles] = useState([]); // Responsáveis por turno
  const [turnoFiltro, setTurnoFiltro] = useState('todos');
  const [filtroMaquina, setFiltroMaquina] = useState('todas');
  const [periodo, setPeriodo] = useState('hoje');
  const [selectedDate, setSelectedDate] = useState('');
  const [caixasAbertas, setCaixasAbertas] = useState({});
  const [bipadasAnim, setBipadasAnim] = useState({});
  const [refugoAnim, setRefugoAnim] = useState({});
  const [paradasAnim, setParadasAnim] = useState({});
  const [manualOpen, setManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState({
    date: DateTime.now().setZone('America/Sao_Paulo').toISODate(),
    machine: '',
    turno: '',
    osCode: '',
    goodQty: '',
    scrapEntries: [{ qty: '', reason: '' }],
  });

  // Helpers locais para fatiar paradas por turno (clipping por turno)
  function getTurnoIntervalsDiaLocal(date) {
    const dia = date.getDay();
    if (dia === 0) {
      return [
        { ini: 23 * 60, fim: 24 * 60, turnoKey: '3' },
      ];
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

  function inRangeMinutes(minIni, minFim, minutos) {
    if (minIni <= minFim) return minutos >= minIni && minutos < minFim;
    return minutos >= minIni || minutos < minFim;
  }

  function splitIntervalPorTurnoLocal(iniMs, fimMs) {
    const res = [];
    let cursor = iniMs;
    while (cursor < fimMs) {
      const dBr = toBrazilTime(new Date(cursor).toISOString());
      const minutos = dBr.getHours() * 60 + dBr.getMinutes();
      const turnosDia = getTurnoIntervalsDiaLocal(dBr);
      let fatia = null;
      for (const t of turnosDia) {
        if (inRangeMinutes(t.ini, t.fim, minutos)) {
          let fatiaFimMin = t.fim;
          if (t.fim <= t.ini) fatiaFimMin += 24 * 60;
          const deltaMin = fatiaFimMin - minutos;
          const fatiaFim = cursor + (deltaMin * 60 * 1000);
          // Corrige off-by-one quando o fim cai em 23:59:59.999 e o limite real é 00:00
          let limite = Math.min(fimMs, fatiaFim);
          if (limite === fimMs && (fatiaFim - fimMs) <= 1000) {
            limite = fatiaFim;
          }
          fatia = { turnoKey: t.turnoKey, ini: cursor, fim: limite };
          break;
        }
      }
      if (!fatia) {
        const nextMin = Math.min(fimMs, cursor + 60 * 1000);
        fatia = { turnoKey: null, ini: cursor, fim: nextMin };
      }
      res.push(fatia);
      cursor = fatia.fim;
    }
    return res;
  }

  // ---------- TOAST helper ----------
  function showToast(msg, type = 'ok', ms = 2400) {
    setToast({ visible: true, type, msg });
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(t => ({ ...t, visible: false })), ms);
  }

  // Formatação e chave de item extraída do campo Produto ("CODE - Descrição")
  function formatBRL(val) {
    const n = Number(val) || 0;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function extractItemCodeFromOrderProduct(product) {
    if (!product) return null;
    const t = String(product);
    return t.split('-')[0]?.trim() || null;
  }

  // A duração do turno por período é calculada após `filtroStart/filtroEnd`.

  // Componente simples de donut percentual
  function DonutPct({ pct = 0 }) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    const size = 24;
    const stroke = 4;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const offset = c * (1 - p / 100);
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`Eficiência ${p}%`}>
          <circle cx={size/2} cy={size/2} r={r} stroke="#e0e0e0" strokeWidth={stroke} fill="none" />
          <circle
            cx={size/2}
            cy={size/2}
            r={r}
            stroke="#2b8a3e"
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={c}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${size/2} ${size/2})`}
          />
        </svg>
        <span style={{ fontSize: 12, color: '#333' }}>{p.toFixed(0)}%</span>
      </div>
    );
  }

  // Donut grande com percentual no centro
  function BigDonutPct({ pct = 0 }) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    const size = 64;
    const stroke = 8;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const offset = c * (1 - p / 100);
    const color = p >= 90 ? '#2b8a3e' : p >= 75 ? '#f59f00' : '#d9480f';
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`Eficiência ${p}%`}>
          <circle cx={size/2} cy={size/2} r={r} stroke="#e0e0e0" strokeWidth={stroke} fill="none" />
          <circle
            cx={size/2}
            cy={size/2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={c}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${size/2} ${size/2})`}
          />
          <text x={size/2} y={size/2 + 4} textAnchor="middle" fontSize="16" fontWeight="700" fill={color}>{p.toFixed(0)}%</text>
        </svg>
      </div>
    );
  }

  function getPeriodoRange(p) {
    // Todas as janelas são baseadas no fuso America/Sao_Paulo,
    // e convertidas para UTC para consulta no Supabase.
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
      // início da semana (segunda) no fuso BR
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
        // selectedDate vem como 'YYYY-MM-DD'
        const dZ = DateTime.fromISO(selectedDate, { zone: 'America/Sao_Paulo' });
        startZ = dZ.startOf('day');
        endZ = dZ.endOf('day');
      }
    }
    const start = startZ ? startZ.toUTC().toJSDate() : null;
    const end = endZ ? endZ.toUTC().toJSDate() : null;
    return { start, end };
  }

  const periodoRange = useMemo(() => getPeriodoRange(periodo), [periodo, selectedDate]);
  const filtroStart = periodoRange.start;
  const filtroEnd = periodoRange.end;

  // Calcula a duração total do turno dentro do período filtrado (em ms)
  const duracaoTurnoPorPeriodo = useMemo(() => {
    if (!filtroStart || !filtroEnd) return {};
    const res = { '1': 0, '2': 0, '3': 0 };

    // iterar dia a dia em America/Sao_Paulo
    let cursor = DateTime.fromJSDate(filtroStart).setZone('America/Sao_Paulo').startOf('day');
    const endZ = DateTime.fromJSDate(filtroEnd).setZone('America/Sao_Paulo').endOf('day');
    while (cursor <= endZ) {
      const dJs = cursor.toJSDate();
      const fatias = getTurnoIntervalsDiaLocal(dJs);
      fatias.forEach(f => {
        let iniMin = f.ini;
        let fimMin = f.fim;
        // normaliza quando cruza meia-noite (fim <= ini)
        if (fimMin <= iniMin) fimMin += 24 * 60;
        const durMin = Math.max(0, fimMin - iniMin);
        res[f.turnoKey] = (res[f.turnoKey] || 0) + durMin * 60 * 1000;
      });
      cursor = cursor.plus({ days: 1 });
    }
    return res;
  }, [filtroStart, filtroEnd]);

  // Reconsulta completa do período atual
  const refetchData = useCallback(async () => {
    if (!filtroStart || !filtroEnd) {
      setBipagens([]); setRefugos([]); setParadas([]); setApontamentos([]); setOrders([]); setShiftResponsibles([]);
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

      const shiftRespQuery = supabase
        .from('shift_responsibles')
        .select('*')
        .gte('created_at', filtroStart.toISOString())
        .lte('created_at', filtroEnd.toISOString());

      const [bipRes, refRes, parRes, apRes, respRes] = await Promise.all([bipQuery, refQuery, paradaQuery, apontQuery, shiftRespQuery]);
      const { data: bip } = bipRes || {}; const { data: ref } = refRes || {}; const { data: par } = parRes || {}; const { data: aps } = apRes || {}; const { data: resp } = respRes || {};

      setBipagens(bip || []);
      setRefugos(ref || []);
      setParadas(par || []);
      setApontamentos(aps || []);
      setShiftResponsibles(resp || []);

      // buscar orders relevantes
      const orderIdsSet = new Set();
      (bip || []).forEach(b => { if (b.order_id != null) orderIdsSet.add(String(b.order_id)); });
      (ref || []).forEach(r => { if (r.order_id != null) orderIdsSet.add(String(r.order_id)); });
      (aps || []).forEach(a => { if (a.order_id != null) orderIdsSet.add(String(a.order_id)); });
      const orderIds = Array.from(orderIdsSet);
      if (orderIds.length > 0) {
        const { data: ords } = await supabase
          .from('orders')
          .select('id,code,product,standard,created_at,boxes')
          .in('id', orderIds);
        setOrders(ords || []);
      } else {
        setOrders([]);
      }
    } catch (e) {
      console.warn('Refetch falhou:', e);
    }
  }, [filtroStart, filtroEnd]);

  useEffect(() => {
    let mounted = true;

    async function fetchData() {

      if (!filtroStart || !filtroEnd) {
        if (!mounted) return;
        setBipagens([]);
        setRefugos([]);
        setOrders([]);
        setParadas([]);
        setShiftResponsibles([]);
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

        // produção manual das injetoras
        const apontQuery = supabase
          .from('injection_production_entries')
          .select('*')
          .gte('created_at', filtroStart.toISOString())
          .lte('created_at', filtroEnd.toISOString());

        const shiftRespQuery = supabase
          .from('shift_responsibles')
          .select('*')
          .gte('created_at', filtroStart.toISOString())
          .lte('created_at', filtroEnd.toISOString());

        // fetch bipagens, refugos e paradas
        const [{ data: bip }, { data: ref }, { data: par }, { data: aps }, { data: resp }] = await Promise.all([bipQuery, refQuery, paradaQuery, apontQuery, shiftRespQuery]);

        if (!mounted) return;
        const bipagensData = bip || [];
        const refugosData = ref || [];
        const paradasData = par || [];
        const apontData = aps || [];
        const respData = resp || [];

        setBipagens(bipagensData);
        setRefugos(refugosData);
        setParadas(paradasData);
        setApontamentos(apontData);
        setShiftResponsibles(respData);

        // extrair order_id únicos de ambas as tabelas
        const orderIdsSet = new Set();
        bipagensData.forEach(b => { if (b.order_id != null) orderIdsSet.add(String(b.order_id)); });
        refugosData.forEach(r => { if (r.order_id != null) orderIdsSet.add(String(r.order_id)); });
        apontData.forEach(a => { if (a.order_id != null) orderIdsSet.add(String(a.order_id)); });

        const orderIds = Array.from(orderIdsSet);
        let ordersData = [];
        if (orderIds.length > 0) {
          // consultar apenas orders relevantes
          const { data: ords, error } = await supabase
            .from('orders')
            .select('id,code,product,standard,created_at,boxes') // traga campos úteis
            .in('id', orderIds);
          if (error) {
            console.warn('Erro ao buscar orders por ids:', error);
            ordersData = [];
          } else {
            ordersData = ords || [];
          }
        } else {
          ordersData = [];
        }

        if (!mounted) return;
        setOrders(ordersData);
      } catch (err) {
        console.error('Erro ao buscar dados:', err);
        if (mounted) {
          setBipagens([]);
          setRefugos([]);
          setOrders([]);
          setParadas([]);
          setShiftResponsibles([]);
        }
      } finally {
      }
    }

    fetchData();
    // Busca todas as O.S registradas (independente de bipagens/refugos no período)
    async function fetchAllOrders() {
      try {
        const { data, error } = await supabase
          .from('orders')
          .select('id, code, product, standard, created_at, boxes')
          .order('created_at', { ascending: false });
        if (error) {
          console.warn('Erro ao buscar todas as orders:', error);
          if (mounted) setOrdersAll([]);
        } else if (mounted) {
          setOrdersAll(data || []);
        }
      } catch (err) {
        console.error('Exception ao buscar todas as orders:', err);
        if (mounted) setOrdersAll([]);
      }
    }
    fetchAllOrders();
    return () => { mounted = false; };
  }, [filtroStart, filtroEnd]);

  // Busca valores unitários dos itens usados nos pedidos/apontamentos do período
  useEffect(() => {
    const codes = new Set();
    (orders || []).forEach(o => {
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
          .select('code, unit_value')
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
        console.warn('Falha ao buscar itens para valorização:', err);
        if (active) setItemsMap({});
      }
    })();

    return () => { active = false; };
  }, [orders, apontamentos]);
  // Calcular horas paradas por turno/máquina
  const horasParadasPorTurno = useMemo(() => calcularHorasParadasPorTurno(paradas, TURNOS, filtroStart, filtroEnd), [paradas, filtroStart, filtroEnd]);
  // Listas de máquinas por setor, como em Registro.jsx
  const grupoPET = useMemo(() => MAQUINAS.filter(m => String(m).toUpperCase().startsWith('P')), []);
  const grupoINJ = useMemo(() => MAQUINAS.filter(m => String(m).toUpperCase().startsWith('I')), []);
  let maquinasConsideradas = useMemo(() => {
    if (filtroMaquina === 'todas') return MAQUINAS;
    if (filtroMaquina === 'pet') return grupoPET;
    if (filtroMaquina === 'injecao') return grupoINJ;
    return MAQUINAS.filter(m => String(m) === String(filtroMaquina));
  }, [filtroMaquina]);
  maquinasConsideradas = maquinasConsideradas.filter(m => MAQUINAS.includes(m));

  // mapa por id para lookup rápido
  const ordersMap = useMemo(() => {
    const map = {};
    (orders || []).forEach(o => { if (o && o.id != null) map[String(o.id)] = o; });
    return map;
  }, [orders]);

  // Último responsável informado por turno/máquina dentro do período filtrado
  const responsavelPorTurno = useMemo(() => {
    const map = {};
    (shiftResponsibles || []).forEach(r => {
      const key = `${r.shift}-${r.machine_id}`;
      const nome = r.operator || r.responsavel || r.responsible || '';
      const ts = r.created_at ? new Date(r.created_at).getTime() : 0;
      if (!nome) return;
      if (!map[key] || ts > map[key].ts) {
        map[key] = { nome, ts };
      }
    });
    return map;
  }, [shiftResponsibles]);

  // Agrupa por turno e máquina e calcula refugo %
  const agrupadoPorTurno = useMemo(() => {
    const porTurno = {};
    TURNOS.forEach(t => {
      porTurno[t.key] = {};
      MAQUINAS.forEach(maq => {
        porTurno[t.key][maq] = {
          bipadas: 0,
          refugo: 0,
          caixas: [], // { num, hora, order_id, order }
          refugos: [],
          producaoPecas: 0,
          producaoManual: 0,
          refugoPct: 0,
          padraoPorCaixa: 1,
          manualEntries: [],
          valorTotal: 0,
        };
      });
    });

    // popular bipagens
    (bipagens || []).forEach(b => {
      const turno = b.shift || String(getTurnoAtual(b.created_at));
      const maq = b.machine_id;
      if (!porTurno[turno] || !porTurno[turno][maq]) return;
      porTurno[turno][maq].bipadas += 1;

      const orderId = b.order_id != null ? String(b.order_id) : null;
      const matchedOrder = orderId ? ordersMap[orderId] : null;

      porTurno[turno][maq].caixas.push({
        num: b.scanned_box,
        hora: b.created_at,
        order_id: orderId,
        order: matchedOrder || null,
        product: matchedOrder?.product || '',
      });
    });

    // popular refugos
    (refugos || []).forEach(r => {
      const turno = r.shift || String(getTurnoAtual(r.created_at));
      const maq = r.machine_id;
      if (!porTurno[turno] || !porTurno[turno][maq]) return;
      porTurno[turno][maq].refugo += Number(r.qty) || 0;
      porTurno[turno][maq].refugos.push(r);
    });

    // somar produção manual das injetoras
    (apontamentos || []).forEach(a => {
      const turno = a.shift || String(getTurnoAtual(a.created_at));
      const maq = a.machine_id;
      if (!porTurno[turno] || !porTurno[turno][maq]) return;
      const orderId = a.order_id != null ? String(a.order_id) : null;
      const order = orderId ? ordersMap[orderId] : null;
      const goodQty = Number(a.good_qty) || 0;
      porTurno[turno][maq].producaoManual += goodQty;
      porTurno[turno][maq].manualEntries.push({
        good_qty: goodQty,
        product: a.product || order?.product || '',
        order,
      });
    });

    // calcular produção e percentual usando padrão da O.S quando disponível
    const getUnitValueFromProduct = (productStr) => {
      const code = extractItemCodeFromOrderProduct(productStr);
      if (!code) return 0;
      const raw = itemsMap && itemsMap[code] ? itemsMap[code].unit_value : null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : 0;
    };
    const getUnitValueFromOrder = (order) => getUnitValueFromProduct(order?.product || '');

    Object.keys(porTurno).forEach(turnoKey => {
      Object.keys(porTurno[turnoKey]).forEach(maq => {
        const dados = porTurno[turnoKey][maq];

        // Reinicia acumulador monetário a cada cálculo
        dados.valorTotal = 0;

        // Determinar produção considerando o padrão de cada caixa individualmente.
        // Quando não houver padrão na O.S da caixa, usa o padrão da máquina como fallback.
        const maqDef = MAQUINAS && MAQUINAS[maq];
        const padraoFromConstRaw = (maqDef && (maqDef.padrao_por_caixa ?? maqDef.padrao ?? maqDef.piecesPerBox ?? maqDef.pieces_per_box)) ?? 0;
        const parsePiecesPerBox = (val) => {
          if (val == null) return 0;
          const s = String(val).trim();
          if (!s) return 0;
          const digitsOnly = s.replace(/[^0-9]/g, '');
          if (!digitsOnly) return 0;
          return parseInt(digitsOnly, 10);
        };
        const padraoFromConst = parsePiecesPerBox(padraoFromConstRaw);

        let somaPecas = 0;
        const standardsSet = new Set();
        for (const c of (dados.caixas || [])) {
          const stdRaw = (c.order && c.order.standard != null) ? c.order.standard : padraoFromConst;
          const std = parsePiecesPerBox(stdRaw) || 0;
          somaPecas += std;
          if (std > 0) standardsSet.add(std);
          const unitVal = getUnitValueFromOrder(c.order) || getUnitValueFromProduct(c.product);
          if (std > 0 && unitVal > 0) {
            dados.valorTotal += std * unitVal;
          }
        }

        // soma produção escaneada (caixas) + produção manual (injetoras)
        dados.producaoPecas = somaPecas + (Number(dados.producaoManual) || 0);
        // Se todos os padrões forem iguais, mantém para exibição. Caso contrário, sinaliza como variados.
        dados.padraoPorCaixa = standardsSet.size === 1 ? Number([...standardsSet][0]) : null;

        // Valorização das produções manuais (quando houver item cadastrado)
        (dados.manualEntries || []).forEach(me => {
          const unitVal = getUnitValueFromProduct(me.product || (me.order ? me.order.product : ''));
          const qty = Number(me.good_qty) || 0;
          if (unitVal > 0 && qty > 0) {
            dados.valorTotal += qty * unitVal;
          }
        });

        const refugoPecas = Number(dados.refugo) || 0;
        let pct = 0;
        if (dados.producaoPecas > 0) {
          pct = (refugoPecas / (dados.producaoPecas + refugoPecas)) * 100;
        }
        dados.refugoPct = Number.isFinite(pct) ? Number(pct.toFixed(2)) : 0;
      });
    });

    return porTurno;
  }, [bipagens, refugos, ordersMap, apontamentos, itemsMap]);

  // RENDER
  return (
    <div className="apontamento-card card registro-wrap">
      <div className="card-inner">
        <div className={`apontamento-toast ${toast.type === 'ok' ? 'ok' : 'err'} ${toast.visible ? 'show' : ''}`} role="status" aria-live="polite">{toast.msg}</div>
        <div className="apontamento-title label" style={{ display: 'flex', alignItems: 'center' }}>
          Apontamentos por Turno
          {isAdmin && (
            <div style={{ marginLeft: 'auto' }}>
              <button className="btn" onClick={() => setManualOpen(true)}>Apontar Produção</button>
            </div>
          )}
        </div>

        <div className="apontamento-controls">
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
            <div className="custom-dates">
              <input
                className="date-input"
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
              />
            </div>
          )}

          <div className="select-wrap">
            <select
              className="period-select"
              value={turnoFiltro}
              onChange={e => setTurnoFiltro(e.target.value)}
            >
              <option value="todos">Todos os turnos</option>
              {TURNOS.map(t => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </div>

          <div className="select-wrap">
            <select
              className="period-select"
              aria-label="Filtrar por máquina ou grupo"
              value={filtroMaquina}
              onChange={e => setFiltroMaquina(e.target.value)}
            >
              <option value="todas">Todas as máquinas</option>
              <option value="pet">PET</option>
              <option value="injecao">Injeção</option>
              {MAQUINAS.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div> 
          <div className="apontamento-content">
            <div className="maquinas-column">
              {maquinasConsideradas.map(maq => (
                <div key={maq} className="maquina-card card">
                  <div className="maquina-header">{maq}</div>

                  <div className="turnos-row">
                    {TURNOS.filter(t => turnoFiltro === 'todos' || turnoFiltro === t.key).map(t => {
                      const dados = agrupadoPorTurno[t.key][maq];
                      const caixasSorted = [...(dados.caixas || [])].sort((a, b) => {
                        const ta = DateTime.fromISO(String(a.hora));
                        const tb = DateTime.fromISO(String(b.hora));
                        return ta.toMillis() - tb.toMillis();
                      });
                      const key = `${maq}-${t.key}`;
                      const isOpen = caixasAbertas[key] || false;
                      const isBipadasAnim = bipadasAnim[key] || false;
                      const isRefugoAnim = refugoAnim[key] || false;
                      const isParadasAnim = paradasAnim[key] || false; 

                      const handleClickBipadas = () => {
                        setCaixasAbertas(prev => ({ ...prev, [key]: !prev[key] }));
                        setBipadasAnim(prev => ({ ...prev, [key]: true }));
                        setTimeout(() => setBipadasAnim(prev => ({ ...prev, [key]: false })), 250);
                      };
                      const handleClickRefugo = () => {
                        setCaixasAbertas(prev => ({ ...prev, [key]: !prev[key] }));
                        setRefugoAnim(prev => ({ ...prev, [key]: true }));
                        setTimeout(() => setRefugoAnim(prev => ({ ...prev, [key]: false })), 250);
                      };
                      const handleClickParadas = () => {
                        setCaixasAbertas(prev => ({ ...prev, [key]: !prev[key] }));
                        setParadasAnim(prev => ({ ...prev, [key]: true }));
                        setTimeout(() => setParadasAnim(prev => ({ ...prev, [key]: false })), 250);
                      }

                      // eficiência: (tempo de turno disponível - horas paradas) / tempo de turno disponível
                      const totalTurnoMs = duracaoTurnoPorPeriodo[t.key] || (8.5 * 60 * 60 * 1000);
                      const paradasMs = horasParadasPorTurno[t.key]?.[maq] || 0;
                      const eficienciaPct = totalTurnoMs > 0 ? Math.max(0, Math.min(100, ((totalTurnoMs - paradasMs) / totalTurnoMs) * 100)) : 0;

                      const respKey = `${t.key}-${maq}`;
                      const respInfo = responsavelPorTurno[respKey];

                      return (
                        <div key={t.key} className="turno-card">
                          <div className="turno-label">
                            <div className="turno-donut">
                            {/*<BigDonutPct pct={eficienciaPct} />*/}
                            </div>
                            <div className="turno-texts">
                              <div className="turno-resp-line">
                                {respInfo?.nome ? (
                                  <>Turno {t.key} - {respInfo.nome}</>
                                ) : (
                                  t.label
                                )}
                              </div>
                            </div>
                          </div>

                          <div
                            className={`destaque destaque-bipadas ${isBipadasAnim ? 'anim-clicado' : ''}`}
                            tabIndex={0}
                            onClick={handleClickBipadas}
                            onKeyDown={e => { if (e.key === 'Enter') handleClickBipadas(); }}
                            title="Clique para ver registros por hora"
                            role="button"
                          >
                            {/^I[1-6]$/.test(maq) ? (
                              <>Peças Boas: <span className="destaque-value">{dados.producaoPecas}</span></>
                            ) : (
                              <>Caixas bipadas: <span className="destaque-value">{dados.bipadas}</span></>
                            )}
                          </div>


                          <div
                            className={`destaque destaque-refugo ${isRefugoAnim ? 'anim-clicado' : ''}`}
                            tabIndex={0}
                            onClick={handleClickRefugo}
                            onKeyDown={e => { if (e.key === 'Enter') handleClickRefugo(); }}
                            title="Clique para ver registros por hora"
                            role="button"
                          >
                            Refugo: <span className="destaque-value">{dados.refugo}</span>
                            <span className="destaque-pct"> ({dados.refugoPct}%)</span>
                          </div>

                          {/* Horas Paradas */}
                          <div
                            className={`destaque destaque-paradas ${isParadasAnim ? 'anim-clicado' : ''}`}
                            tabIndex={0}
                            onClick={handleClickParadas}
                            onKeyDown={e => { if (e.key === 'Enter') handleClickParadas(); }}
                            title="Clique para ver registros por hora"
                            role="button"
                          >
                            Horas Paradas: <span className="destaque-value">{formatMsToHHmm(horasParadasPorTurno[t.key]?.[maq] || 0)}</span>
                          </div>

                          {canSeeValorization && (
                            <div style={{ marginTop: 6, fontSize: 13, color: '#333' }}>
                              Valorização: <strong>{formatBRL(dados.valorTotal || 0)}</strong>
                            </div>
                          )}

                          {isOpen && (
                            <div className="registros">
                              <div className="registros-title">Registros por hora:</div>

                              <div className="registros-section">
                                <div className="sub-title"><b>Caixas:</b></div>
                                {caixasSorted.length === 0 ? (
                                  <div className="empty">—</div>
                                ) : (
                                  <ul className="caixas-list">
                                    {caixasSorted.map((c, i) => (
                                      <li key={i}>
                                        Caixa {c.num}: {fmtDateTime(c.hora)}
                                        {c.order ? ` — O.S: ${c.order.code || c.order.id} (Padrão: ${c.order.standard})` : ''}
                                      </li>
                                    ))}
                                  </ul>
                                )}

                                <div style={{ marginTop: 8, fontSize: 13, color: '#444' }}>
                                  <b>Produção Realizada (peças):</b> {dados.producaoPecas} {dados.padraoPorCaixa != null ? `(padrão ${dados.padraoPorCaixa}/caixa)` : `(padrões variados)`}
                                </div>
                              </div>

                              {dados.refugos && dados.refugos.length > 0 && (
                                <div className="registros-section">
                                  <div className="sub-title"><b>Refugos:</b></div>
                                  <ul className="refugos-list">
                                    {[...dados.refugos].sort((a, b) => {
                                      const ta = DateTime.fromISO(String(a.created_at));
                                      const tb = DateTime.fromISO(String(b.created_at));
                                      return ta.toMillis() - tb.toMillis();
                                    }).map((r, i) => (
                                      <li key={i}>
                                        {fmtDateTime(r.created_at)} — {r.qty} peças ({r.reason})
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {/* Paradas detalhadas no turno (clipe por turno e período) */}
                              <div className="registros-section">
                                <div style={{ marginTop: 4, fontSize: 13, color: '#444' }}>
                                  <b>Paradas:</b> {formatMsToHHmm(horasParadasPorTurno[t.key]?.[maq] || 0)}
                                </div>
                                {(() => {
                                  const segs = [];
                                  const nowMs = Date.now();
                                  (paradas || [])
                                    .filter(p => String(p.machine_id) === String(maq))
                                    .forEach(p => {
                                      const ini = p.started_at ? toBrazilTime(p.started_at).getTime() : null;
                                      const fimBase = p.resumed_at ? toBrazilTime(p.resumed_at).getTime() : Math.min(filtroEnd ? filtroEnd.getTime() : nowMs, nowMs);
                                      if (!ini || !fimBase || fimBase <= ini) return;
                                      const iniClip = Math.max(ini, filtroStart ? filtroStart.getTime() : ini);
                                      const fimClip = Math.min(fimBase, filtroEnd ? filtroEnd.getTime() : fimBase);
                                      if (fimClip <= iniClip) return;
                                      const fatias = splitIntervalPorTurnoLocal(iniClip, fimClip);
                                      for (const f of fatias) {
                                        if (f.turnoKey && String(f.turnoKey) === String(t.key)) {
                                          segs.push({
                                            ini: f.ini,
                                            fim: f.fim,
                                            reason: p.reason || '-',
                                            id: p.id,
                                            origIni: p.started_at || null,
                                            origFim: p.resumed_at || null,
                                            original: p,
                                          });
                                        }
                                      }
                                    });
                                  if (segs.length === 0) return <div className="empty">—</div>;
                                  segs.sort((a,b)=>a.ini-b.ini);
                                  return (
                                    <ul className="caixas-list">
                                      {segs.map((s, i) => {
                                        const iniISO = new Date(s.ini).toISOString();
                                        const fimISO = new Date(s.fim).toISOString();
                                        const ms = Math.max(0, s.fim - s.ini);
                                        return (
                                          <li
                                            key={i}
                                            title={(() => {
                                              const oIni = s.origIni ? fmtDateTime(s.origIni) : '-';
                                              const oFim = s.origFim ? fmtDateTime(s.origFim) : '— (em aberto)';
                                              return `Parada original: ${oIni} — ${oFim}`;
                                            })()}
                                            onClick={() => {
                                              try {
                                                if (s.id && navigator?.clipboard?.writeText) {
                                                  navigator.clipboard.writeText(String(s.id));
                                                }
                                              } catch {}
                                              try {
                                                // Log detalhado no console para localizar no Supabase
                                                // Inclui o registro completo retornado do backend
                                                // eslint-disable-next-line no-console
                                                console.log('Parada original', s.original);
                                              } catch {}
                                            }}
                                            style={{ cursor: 'pointer' }}
                                          >
                                            {fmtDateTime(iniISO)} — {fmtDateTime(fimISO)} • {s.reason} • {formatMsToHHmm(ms)}
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  );
                                })()}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        {/* Modal de Apontamento Manual */}
        <Modal open={manualOpen} onClose={() => setManualOpen(false)} title="Apontar Produção Manual">
          <div className="grid2" style={{ gap: 12 }}>
            <label className="label">
              Data
              <input
                type="date"
                className="input"
                value={manualForm.date}
                onChange={(e) => setManualForm((f) => ({ ...f, date: e.target.value }))}
              />
            </label>

            <label className="label">
              Máquina
              <select
                className="select"
                value={manualForm.machine}
                onChange={(e) => setManualForm((f) => ({ ...f, machine: e.target.value }))}
              >
                <option value="">Selecione...</option>
                {MAQUINAS.filter((m) => /^I[1-6]$/.test(m)).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>

            <label className="label">
              Turno
              <select
                className="select"
                value={manualForm.turno}
                onChange={(e) => setManualForm((f) => ({ ...f, turno: e.target.value }))}
              >
                <option value="">Selecione...</option>
                {TURNOS.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </label>

            <label className="label" style={{ gridColumn: '1 / -1' }}>
              O.S
              <select
                className="select"
                value={manualForm.osCode}
                onChange={(e) => setManualForm((f) => ({ ...f, osCode: e.target.value }))}
              >
                <option value="">Selecione...</option>
                {Array.from(new Set((ordersAll || []).map((o) => o?.code))).filter(Boolean).map((code) => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
            </label>

            <label className="label">
              Peças Boas
              <input
                type="number"
                min="0"
                className="input"
                value={manualForm.goodQty}
                onChange={(e) => setManualForm((f) => ({ ...f, goodQty: e.target.value }))}
              />
            </label>

            <div className="label" style={{ gridColumn: '1 / -1' }}>
              Refugo
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginTop: 6 }}>
                {manualForm.scrapEntries.map((entry, idx) => (
                  <>
                    <input
                      key={`qty-${idx}`}
                      type="number"
                      min="0"
                      className="input"
                      placeholder="Refugo Peças"
                      value={entry.qty}
                      onChange={(e) => {
                        const val = e.target.value;
                        setManualForm((f) => {
                          const next = [...f.scrapEntries];
                          next[idx] = { ...next[idx], qty: val };
                          return { ...f, scrapEntries: next };
                        });
                      }}
                    />
                    <select
                      key={`reason-${idx}`}
                      className="select"
                      value={entry.reason}
                      onChange={(e) => {
                        const val = e.target.value;
                        setManualForm((f) => {
                          const next = [...f.scrapEntries];
                          next[idx] = { ...next[idx], reason: val };
                          return { ...f, scrapEntries: next };
                        });
                      }}
                    >
                      <option value="">Motivo Refugo</option>
                      {REFUGO_MOTIVOS.map(m=> <option key={m} value={m}>{m}</option>)}
                    </select>
                    <button
                      key={`add-${idx}`}
                      type="button"
                      className="btn"
                      onClick={() =>
                        setManualForm((f) => ({
                          ...f,
                          scrapEntries: [...f.scrapEntries, { qty: '', reason: '' }],
                        }))
                      }
                      title="Adicionar outro apontamento de refugo"
                    >
                      +
                    </button>
                  </>
                ))}
              </div>
            </div>
          </div>

          <div className="flex" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button className="btn" onClick={() => setManualOpen(false)}>Cancelar</button>
            <button
              className="btn"
              onClick={async () => {
                const payload = {
                  date: manualForm.date,
                  machine: manualForm.machine,
                  turno: manualForm.turno,
                  osCode: manualForm.osCode,
                  goodQty: Number(manualForm.goodQty || 0),
                  scrapEntries: (manualForm.scrapEntries || [])
                    .map((e) => ({ qty: Number(e.qty || 0), reason: (e.reason || '').trim() }))
                    .filter((e) => e.qty > 0 && e.reason.length > 0),
                };
                try {
                  if (!payload.date || !payload.machine || !payload.turno || !payload.osCode) {
                    showToast('Preencha Data, Máquina, Turno e O.S.', 'err');
                    return;
                  }
                  if (payload.goodQty < 0) {
                    showToast('Peças Boas deve ser >= 0.', 'err');
                    return;
                  }

                  // Resolve O.S -> order_id + product
                  let ordSel = null;
                  {
                    const q = supabase
                      .from('orders')
                      .select('id, code, product, machine_id, created_at')
                      .eq('code', payload.osCode)
                      .order('created_at', { ascending: false })
                      .limit(1);
                    const { data: ordData, error: ordErr } = await q;
                    if (ordErr || !ordData || !ordData[0]) {
                      showToast('O.S não encontrada.', 'err');
                      return;
                    }
                    ordSel = ordData[0];
                  }

                  // Converter a data escolhida (sem hora) para meio-dia BR e gravar UTC
                  const diaZ = DateTime.fromISO(String(payload.date), { zone: 'America/Sao_Paulo' }).set({ hour: 12, minute: 0, second: 0, millisecond: 0 });
                  const createdAtUtcIso = diaZ.toUTC().toISO();

                  // 1) Inserir produção manual
                  const prodIns = {
                    entry_date: diaZ.toISODate(),
                    created_at: createdAtUtcIso,
                    machine_id: payload.machine,
                    shift: String(payload.turno),
                    order_id: ordSel.id,
                    order_code: ordSel.code,
                    product: ordSel.product || '',
                    good_qty: Number(payload.goodQty || 0),
                  };
                  const { error: eProd } = await supabase.from('injection_production_entries').insert([prodIns]);
                  if (eProd) {
                    console.warn('Erro ao inserir produção manual:', eProd);
                    showToast('Falha ao registrar produção manual.', 'err');
                    return;
                  }

                  // 2) Inserir refugos (scrap_logs), se houver
                  if (payload.scrapEntries.length > 0) {
                    const scrapRows = payload.scrapEntries.map((s) => ({
                      created_at: createdAtUtcIso,
                      machine_id: payload.machine,
                      shift: String(payload.turno),
                      operator: 'apontamento-manual',
                      order_id: ordSel.id,
                      op_code: String(ordSel.code),
                      qty: Number(s.qty),
                      reason: s.reason,
                    }));
                    const { error: eScrap } = await supabase.from('scrap_logs').insert(scrapRows);
                    if (eScrap) {
                      console.warn('Erro ao inserir scrap_logs:', eScrap);
                      showToast('Falha ao registrar refugo.', 'err');
                      return;
                    }

                    // Observação: refugo deve ser registrado apenas em scrap_logs (sem espelhar em low_efficiency_logs)
                  }

                  // Reset UI
                  setManualOpen(false);
                  setManualForm({
                    date: DateTime.now().setZone('America/Sao_Paulo').toISODate(),
                    machine: '',
                    turno: '',
                    osCode: '',
                    goodQty: '',
                    scrapEntries: [{ qty: '', reason: '' }],
                  });
                  // reconsulta para refletir números sem F5
                  await refetchData();
                  showToast('Apontamento registrado.', 'ok');
                } catch (err) {
                  console.warn('Falha ao registrar apontamento manual', err);
                  showToast('Falha ao registrar apontamento.', 'err');
                }
              }}
            >
              Registrar
            </button>
          </div>
        </Modal>
      </div>
    </div>
  );
}
