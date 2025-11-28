import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { MAQUINAS } from '../lib/constants';
import { fmtDateTime, getTurnoAtual } from '../lib/utils';
import '../styles/Apontamento.css';
// import '../styles/registro.css'; // mantenha se necessário

const TURNOS = [
  { key: '1', label: 'Turno 1' },
  { key: '2', label: 'Turno 2' },
  { key: '3', label: 'Turno 3' },
];

export default function Apontamento() {
  const [bipagens, setBipagens] = useState([]);
  const [refugos, setRefugos] = useState([]);
  const [orders, setOrders] = useState([]); // O.S relevantes
  const [loading, setLoading] = useState(true);
  const [turnoFiltro, setTurnoFiltro] = useState('todos');
  const [periodo, setPeriodo] = useState('hoje');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [caixasAbertas, setCaixasAbertas] = useState({});
  const [bipadasAnim, setBipadasAnim] = useState({});
  const [refugoAnim, setRefugoAnim] = useState({});

  function getPeriodoRange(p) {
    const now = new Date();
    let start = null, end = null;
    if (p === 'hoje') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (p === 'ontem') {
      const ontem = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0);
      start = new Date(ontem.getFullYear(), ontem.getMonth(), ontem.getDate(), 0, 0, 0, 0);
      end = new Date(ontem.getFullYear(), ontem.getMonth(), ontem.getDate(), 23, 59, 59, 999);
    } else if (p === 'semana') {
      const day = now.getDay() === 0 ? 7 : now.getDay();
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (day - 1), 0, 0, 0, 0);
      start = monday;
      end = now;
    } else if (p === 'mes') {
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      end = now;
    } else if (p === 'mespassado') {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    } else if (p === 'custom') {
      start = customStart ? new Date(customStart) : null;
      end = customEnd ? new Date(customEnd) : null;
    }
    return { start, end };
  }

  const periodoRange = useMemo(() => getPeriodoRange(periodo), [periodo, customStart, customEnd]);
  const filtroStart = periodoRange.start;
  const filtroEnd = periodoRange.end;

  useEffect(() => {
    let mounted = true;

    async function fetchData() {
      setLoading(true);

      if (!filtroStart || !filtroEnd) {
        if (!mounted) return;
        setBipagens([]);
        setRefugos([]);
        setOrders([]);
        setLoading(false);
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

        // fetch bipagens e refugos primeiro
        const [{ data: bip }, { data: ref }] = await Promise.all([bipQuery, refQuery]);

        if (!mounted) return;
        const bipagensData = bip || [];
        const refugosData = ref || [];

        setBipagens(bipagensData);
        setRefugos(refugosData);

        // extrair order_id únicos de ambas as tabelas
        const orderIdsSet = new Set();
        bipagensData.forEach(b => { if (b.order_id != null) orderIdsSet.add(String(b.order_id)); });
        refugosData.forEach(r => { if (r.order_id != null) orderIdsSet.add(String(r.order_id)); });

        const orderIds = Array.from(orderIdsSet);
        let ordersData = [];
        if (orderIds.length > 0) {
          // consultar apenas orders relevantes
          const { data: ords, error } = await supabase
            .from('orders')
            .select('id,code,standard,created_at,boxes') // traga campos úteis
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
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchData();
    return () => { mounted = false; };
  }, [filtroStart, filtroEnd]);

  // mapa por id para lookup rápido
  const ordersMap = useMemo(() => {
    const map = {};
    (orders || []).forEach(o => { if (o && o.id != null) map[String(o.id)] = o; });
    return map;
  }, [orders]);

  // Agrupa por turno e máquina e calcula refugo %
  const agrupadoPorTurno = useMemo(() => {
    const porTurno = {};
    TURNOS.forEach(t => {
      porTurno[t.key] = {};
      ['P1','P2','P3'].forEach(maq => {
        porTurno[t.key][maq] = {
          bipadas: 0,
          refugo: 0,
          caixas: [], // { num, hora, order_id, order }
          refugos: [],
          producaoPecas: 0,
          refugoPct: 0,
          padraoPorCaixa: 1
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
        order: matchedOrder || null
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

    // calcular produção e percentual usando padrão da O.S quando disponível
    Object.keys(porTurno).forEach(turnoKey => {
      Object.keys(porTurno[turnoKey]).forEach(maq => {
        const dados = porTurno[turnoKey][maq];

        // primeiro, tenta pegar padrão a partir de alguma O.S associada às caixas (usa a primeira com standard)
        let padraoFromOrder = null;
        for (const c of (dados.caixas || [])) {
          if (c.order && (c.order.standard !== undefined && c.order.standard !== null)) {
            padraoFromOrder = c.order.standard;
            break;
          }
        }

        // fallback: procurar em ordersMap por heurística (p.ex. se existe uma order com boxes que combine)
        // (normalmente não necessário porque buscamos por order_id, mas mantemos a lógica)
        if (padraoFromOrder == null && Object.keys(ordersMap).length > 0) {
          const maybe = Object.values(ordersMap).find(o => o && (o.standard !== undefined && o.standard !== null));
          if (maybe) padraoFromOrder = maybe.standard;
        }

        // fallback: MAQUINAS constantes
        const maqDef = MAQUINAS && MAQUINAS[maq];
        const padraoFromConst = (maqDef && (maqDef.padrao_por_caixa ?? maqDef.padrao ?? maqDef.piecesPerBox ?? maqDef.pieces_per_box)) ?? null;

        const padrao = Number(padraoFromOrder ?? padraoFromConst ?? 1) || 1;
        dados.padraoPorCaixa = padrao;

        const caixasCount = (dados.caixas || []).length;
        const producaoPecas = caixasCount * dados.padraoPorCaixa;
        dados.producaoPecas = producaoPecas;

        const refugoPecas = Number(dados.refugo) || 0;
        let pct = 0;
        if (producaoPecas > 0) pct = (refugoPecas / producaoPecas) * 100;
        pct = Math.max(0, Math.min(100, pct));
        dados.refugoPct = Number.isFinite(pct) ? Number(pct.toFixed(2)) : 0;
      });
    });

    return porTurno;
  }, [bipagens, refugos, ordersMap]);

  // RENDER
  return (
    <div className="apontamento-card card registro-wrap">
      <div className="card-inner">
        <div className="apontamento-title label">Apontamentos por Turno</div>

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
              <input className="date-input" type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} />
              <input className="date-input" type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
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
        </div>

        {loading ? (
          <div className="loading-row">Carregando...</div>
        ) : (
          <div className="apontamento-content">
            <div className="maquinas-column">
              {['P1','P2','P3'].map(maq => (
                <div key={maq} className="maquina-card card">
                  <div className="maquina-header">{maq}</div>

                  <div className="turnos-row">
                    {TURNOS.filter(t => turnoFiltro === 'todos' || turnoFiltro === t.key).map(t => {
                      const dados = agrupadoPorTurno[t.key][maq];
                      const caixasSorted = [...(dados.caixas || [])].sort((a,b) => (Number(a.num)||0) - (Number(b.num)||0));
                      const key = `${maq}-${t.key}`;
                      const isOpen = caixasAbertas[key] || false;
                      const isBipadasAnim = bipadasAnim[key] || false;
                      const isRefugoAnim = refugoAnim[key] || false;

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

                      return (
                        <div key={t.key} className="turno-card">
                          <div className="turno-label">{t.label}</div>

                          <div
                            className={`destaque destaque-bipadas ${isBipadasAnim ? 'anim-clicado' : ''}`}
                            tabIndex={0}
                            onClick={handleClickBipadas}
                            onKeyDown={e => { if (e.key === 'Enter') handleClickBipadas(); }}
                            title="Clique para ver registros por hora"
                            role="button"
                          >
                            Caixas bipadas: <span className="destaque-value">{dados.bipadas}</span>
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
                                  <b>Produção estimada (peças):</b> {dados.producaoPecas} (padrão {dados.padraoPorCaixa}/caixa)
                                </div>
                              </div>

                              {dados.refugos && dados.refugos.length > 0 && (
                                <div className="registros-section">
                                  <div className="sub-title"><b>Refugos:</b></div>
                                  <ul className="refugos-list">
                                    {dados.refugos.map((r, i) => (
                                      <li key={i}>
                                        {fmtDateTime(r.created_at)} — {r.qty} peças ({r.reason})
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
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
        )}
      </div>
    </div>
  );
}
