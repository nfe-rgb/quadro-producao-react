import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { MAQUINAS } from '../lib/constants';
import { fmtDateTime, getTurnoAtual } from '../lib/utils';
import '../styles/registro.css';

// Turnos padrão (apenas para labels)
const TURNOS = [
  { key: '1', label: 'Turno 1' },
  { key: '2', label: 'Turno 2' },
  { key: '3', label: 'Turno 3' },
];

export default function Apontamento() {
  const [bipagens, setBipagens] = useState([]);
  const [refugos, setRefugos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [turnoFiltro, setTurnoFiltro] = useState('todos');
  const [periodo, setPeriodo] = useState('hoje');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  // Removido filtro por máquina
  const [caixasAbertas, setCaixasAbertas] = useState({}); // { [turno+maquina]: boolean }
  const [bipadasAnim, setBipadasAnim] = useState({}); // { [turno+maquina]: boolean }
  const [refugoAnim, setRefugoAnim] = useState({}); // { [turno+maquina]: boolean }

  // Função para obter range de datas do filtro
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
    async function fetchData() {
      setLoading(true);
      if (!filtroStart || !filtroEnd) {
        setBipagens([]);
        setRefugos([]);
        setLoading(false);
        return;
      }
      // Busca todas as máquinas
      let bipQuery = supabase
        .from('production_scans')
        .select('*')
        .gte('created_at', filtroStart.toISOString())
        .lte('created_at', filtroEnd.toISOString());
      let refQuery = supabase
        .from('scrap_logs')
        .select('*')
        .gte('created_at', filtroStart.toISOString())
        .lte('created_at', filtroEnd.toISOString());
      const { data: bip } = await bipQuery;
      const { data: ref } = await refQuery;
      setBipagens(bip || []);
      setRefugos(ref || []);
      setLoading(false);
    }
    fetchData();
  }, [filtroStart, filtroEnd]);

  // Agrupa por turno e máquina
  const agrupadoPorTurno = useMemo(() => {
    const porTurno = {};
    TURNOS.forEach(t => {
      porTurno[t.key] = {};
      ['P1','P2','P3'].forEach(maq => {
        porTurno[t.key][maq] = {
          bipadas: 0,
          refugo: 0,
          caixas: [], // [{num, hora}]
          refugos: []
        };
      });
    });
    (bipagens || []).forEach(b => {
      const turno = b.shift || String(getTurnoAtual(b.created_at));
      const maq = b.machine_id;
      if (!porTurno[turno] || !porTurno[turno][maq]) return;
      porTurno[turno][maq].bipadas += 1;
      porTurno[turno][maq].caixas.push({ num: b.scanned_box, hora: b.created_at });
    });
    (refugos || []).forEach(r => {
      const turno = r.shift || String(getTurnoAtual(r.created_at));
      const maq = r.machine_id;
      if (!porTurno[turno] || !porTurno[turno][maq]) return;
      porTurno[turno][maq].refugo += Number(r.qty) || 0;
      porTurno[turno][maq].refugos.push(r);
    });
    return porTurno;
  }, [bipagens, refugos]);

  return (
    <div className="card registro-wrap">
      <div className="card">
        <div className="label" style={{ marginBottom: 8 }}>
          Apontamentos por Turno
        </div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
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
          <div className="row muted" style={{ padding: 32, textAlign: 'center' }}>Carregando...</div>
        ) : (
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {['P1','P2','P3'].map(maq => (
                <div key={maq} className="card" style={{ marginBottom: 0, padding: 0, background: '#f9f9f9', boxShadow: '0 1px 4px #0001' }}>
                  <div style={{ fontWeight: 700, fontSize: 25, textAlign: 'center', padding: '12px 20px 8px 20px', borderBottom: '1px solid #eee', background: '#f5f5f5' }}>{maq}</div>
                  <div style={{ display: 'flex', flexDirection: 'row', gap: 24, padding: '24px 20px', justifyContent: 'center', alignItems: 'stretch' }}>
                    {TURNOS.filter(t => turnoFiltro === 'todos' || turnoFiltro === t.key).map(t => {
                      const dados = agrupadoPorTurno[t.key][maq];
                      const caixasSorted = [...dados.caixas].sort((a, b) => a.num - b.num);
                      const key = maq + '-' + t.key;
                      const isOpen = caixasAbertas[key] || false;
                      const isBipadasAnim = bipadasAnim[key] || false;
                      const isRefugoAnim = refugoAnim[key] || false;
                      const handleClickBipadas = () => {
                        setCaixasAbertas(prev => ({ ...prev, [key]: !isOpen }));
                        setBipadasAnim(prev => ({ ...prev, [key]: true }));
                        setTimeout(() => setBipadasAnim(prev => ({ ...prev, [key]: false })), 250);
                      };
                      const handleClickRefugo = () => {
                        setCaixasAbertas(prev => ({ ...prev, [key]: !isOpen }));
                        setRefugoAnim(prev => ({ ...prev, [key]: true }));
                        setTimeout(() => setRefugoAnim(prev => ({ ...prev, [key]: false })), 250);
                      };
                      return (
                        <div key={t.key} className="card turno-card" style={{ minWidth: 220, flex: 1, background: '#fff', border: '1px solid #eee', boxShadow: 'none', margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start' }}>
                          <div className="label" style={{ fontWeight: 600, marginBottom: 8, fontSize: 25 }}>{t.label}</div>
                          <div
                            className={`destaque-bipadas${isBipadasAnim ? ' anim-clicado' : ''}`}
                            style={{ fontWeight: 800, fontSize: 20, color: '#0a7', marginBottom: 2, cursor: 'pointer', transition: 'transform 0.2s' }}
                            tabIndex={0}
                            onClick={handleClickBipadas}
                            onKeyDown={e => { if (e.key === 'Enter') handleClickBipadas(); }}
                            title="Clique para ver registros por hora"
                          >
                            Caixas bipadas: {dados.bipadas}
                          </div>
                          <div
                            className={`destaque-refugo${isRefugoAnim ? ' anim-clicado' : ''}`}
                            style={{ fontWeight: 800, fontSize: 20, color: '#e67e22', marginBottom: 8, cursor: 'pointer', transition: 'transform 0.2s' }}
                            tabIndex={0}
                            onClick={handleClickRefugo}
                            onKeyDown={e => { if (e.key === 'Enter') handleClickRefugo(); }}
                            title="Clique para ver registros por hora"
                          >
                            Refugo: {dados.refugo}
                          </div>
                          {isOpen && (
                            <div style={{ width: '100%', marginBottom: 8 }}>
                              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>Registros por hora:</div>
                              <div style={{ fontSize: 13, color: '#555' }}>
                                <b>Caixas:</b> {caixasSorted.length === 0 ? '—' : (
                                  <ul style={{ margin: '8px 0 0 0', paddingLeft: 18 }}>
                                    {caixasSorted.map((c, i) => (
                                      <li key={i}>
                                        Caixa {c.num}: {fmtDateTime(c.hora)}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                              {dados.refugos.length > 0 && (
                                <div style={{ marginTop: 8 }}>
                                  <b>Refugos:</b>
                                  <ul style={{ margin: 0, paddingLeft: 18 }}>
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
