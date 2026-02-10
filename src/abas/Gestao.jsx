import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { supabase } from '../lib/supabaseClient';
import { MAQUINAS } from '../lib/constants';
import { formatMsToHHmm } from '../lib/paradasPorTurno';
import '../styles/Gestao.css';

const parsePiecesPerBox = (val) => {
  if (val == null) return 0;
  const s = String(val).trim();
  if (!s) return 0;
  const digitsOnly = s.replace(/[^0-9]/g, '');
  if (!digitsOnly) return 0;
  return parseInt(digitsOnly, 10);
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

export default function Gestao() {
  const [periodo, setPeriodo] = useState('hoje');
  const [selectedDate, setSelectedDate] = useState('');

  const [bipagens, setBipagens] = useState([]);
  const [refugos, setRefugos] = useState([]);
  const [paradas, setParadas] = useState([]);
  const [apontamentos, setApontamentos] = useState([]);
  const [orders, setOrders] = useState([]);
  const [itemsMap, setItemsMap] = useState({});

  const periodoRange = useMemo(() => getPeriodoRange(periodo, selectedDate), [periodo, selectedDate]);
  const filtroStart = periodoRange.start;
  const filtroEnd = periodoRange.end;

  const grupoPET = useMemo(() => MAQUINAS.filter(m => String(m).toUpperCase().startsWith('P')), []);
  const grupoINJ = useMemo(() => MAQUINAS.filter(m => String(m).toUpperCase().startsWith('I')), []);

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
          .select('code, unit_value, part_weight_g')
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
  }, [orders, apontamentos]);

  const ordersMap = useMemo(() => {
    const map = {};
    (orders || []).forEach(o => { if (o && o.id != null) map[String(o.id)] = o; });
    return map;
  }, [orders]);

  const getItemMetaFromProduct = (productStr) => {
    const code = extractItemCodeFromOrderProduct(productStr);
    if (!code) return { unitValue: 0, weightKg: 0 };
    const raw = itemsMap && itemsMap[code] ? itemsMap[code] : null;
    const unitValue = Number(raw?.unit_value) || 0;
    const weightKg = (Number(raw?.part_weight_g) || 0) / 1000;
    return { unitValue, weightKg };
  };

  const resumoSetores = useMemo(() => {
    const buildSummary = (maquinas) => {
      const machineSet = new Set(maquinas.map(m => String(m)));
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
    };

    return {
      pet: buildSummary(grupoPET),
      inj: buildSummary(grupoINJ),
    };
  }, [bipagens, refugos, paradas, apontamentos, ordersMap, itemsMap, grupoPET, grupoINJ, filtroStart, filtroEnd]);

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
        </div>

        <div className="gestao-sectors">
          {renderSetor('PET', resumoSetores.pet)}
          {renderSetor('Injecao', resumoSetores.inj)}
        </div>
      </div>
    </div>
  );
}
