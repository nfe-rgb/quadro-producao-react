// Função utilitária para somar horas de paradas por turno e máquina
// Utilitário para checar se um valor está em um intervalo [ini, fim) considerando virada de dia
function inRange(minIni, minFim, minutos) {
  if (minIni <= minFim) return minutos >= minIni && minutos < minFim;
  // intervalo cruza meia-noite
  return minutos >= minIni || minutos < minFim;
}

// Retorna array de intervalos [{ini, fim, turnoKey}] para um dia específico
function getTurnoIntervalsDia(date) {
  const dia = date.getDay();
  // minutos desde 00:00
  const base = d => d.getHours() * 60 + d.getMinutes();
  // Domingo
  if (dia === 0) {
    return [
      { ini: 23 * 60, fim: 24 * 60, turnoKey: '3' },
      { ini: 0, fim: 5 * 60, turnoKey: '3' },
      // resto é hora extra
    ];
  }
  // Segunda a Sexta
  if (dia >= 1 && dia <= 5) {
    return [
      { ini: 5 * 60, fim: 13 * 60 + 30, turnoKey: '1' },
      { ini: 13 * 60 + 30, fim: 22 * 60, turnoKey: '2' },
      { ini: 22 * 60, fim: 24 * 60, turnoKey: '3' },
      { ini: 0, fim: 5 * 60, turnoKey: '3' },
    ];
  }
  // Sábado
  if (dia === 6) {
    return [
      { ini: 5 * 60, fim: 9 * 60, turnoKey: '1' },
      { ini: 9 * 60, fim: 13 * 60, turnoKey: '2' },
      // resto é hora extra
    ];
  }
  return [];
}

// Divide um intervalo [ini, fim) (em ms) em fatias por turno, retornando [{turnoKey, ini, fim}]
function splitIntervalPorTurno(iniMs, fimMs) {
  const res = [];
  let cursor = iniMs;
  while (cursor < fimMs) {
    const d = new Date(cursor);
    const dia = d.getDay();
    const minutos = d.getHours() * 60 + d.getMinutes();
    const turnosDia = getTurnoIntervalsDia(d);
    // Acha o turno atual
    let fatia = null;
    for (const t of turnosDia) {
      if (inRange(t.ini, t.fim, minutos)) {
        // Calcula fim da fatia
        let fatiaFimMin = t.fim;
        if (t.fim <= t.ini) fatiaFimMin += 24 * 60; // cruza meia-noite
        let fatiaFim = new Date(d);
        fatiaFim.setHours(0, 0, 0, 0);
        fatiaFim = fatiaFim.getTime() + ((t.fim % (24 * 60)) * 60 * 1000);
        if (fatiaFim <= cursor) fatiaFim += 24 * 60 * 60 * 1000;
        fatia = {
          turnoKey: t.turnoKey,
          ini: cursor,
          fim: Math.min(fimMs, fatiaFim)
        };
        break;
      }
    }
    if (!fatia) {
      // Hora extra, pula para próximo minuto
      cursor += 60 * 1000;
      continue;
    }
    res.push(fatia);
    cursor = fatia.fim;
  }
  return res;
}

export function calcularHorasParadasPorTurno(paradas, turnos, filtroStart, filtroEnd) {
  // paradas: array de registros de parada (machine_stops)
  // turnos: array de objetos { key, label }
  // Retorna: { [turnoKey]: { [maq]: ms } }
  const porTurno = {};
  turnos.forEach(t => {
    porTurno[t.key] = {};
    ['P1','P2','P3'].forEach(maq => {
      porTurno[t.key][maq] = 0;
    });
  });
  if (!Array.isArray(paradas)) return porTurno;
  paradas.forEach(p => {
    const maq = p.machine_id;
    if (!['P1','P2','P3'].includes(maq)) return;
    const ini = new Date(p.started_at).getTime();
    const fim = p.resumed_at ? new Date(p.resumed_at).getTime() : (filtroEnd ? filtroEnd.getTime() : Date.now());
    if (!ini || !fim || fim <= ini) return;
    // Clipping ao filtro
    const iniClip = Math.max(ini, filtroStart ? filtroStart.getTime() : ini);
    const fimClip = Math.min(fim, filtroEnd ? filtroEnd.getTime() : fim);
    if (fimClip <= iniClip) return;
    // Fatia por turnos reais
    const fatias = splitIntervalPorTurno(iniClip, fimClip);
    for (const f of fatias) {
      if (porTurno[f.turnoKey] && porTurno[f.turnoKey][maq] !== undefined) {
        porTurno[f.turnoKey][maq] += (f.fim - f.ini);
      }
    }
  });
  return porTurno;
}

// Formata ms para HH:mm
export function formatMsToHHmm(ms) {
  const totalMin = Math.floor((ms || 0) / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
