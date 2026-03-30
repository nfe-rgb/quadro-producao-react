// Função utilitária para somar horas de paradas por turno e máquina
import { getShiftWindowsForDay } from './shifts';
import { toBrazilTime } from './timezone';
import { MAQUINAS } from './constants';
import { mergeIntervals } from './productionIntervals';

// Utilitário para checar se um valor está em um intervalo [ini, fim) considerando virada de dia
function inRange(minIni, minFim, minutos) {
  if (minIni <= minFim) return minutos >= minIni && minutos < minFim;
  // intervalo cruza meia-noite
  return minutos >= minIni || minutos < minFim;
}

// Retorna array de intervalos [{ini, fim, turnoKey}] para um dia específico, horários EXATOS para horas paradas
function getTurnoIntervalsDia(date) {
  return getShiftWindowsForDay(date).map((window) => ({
    ini: window.start.hour * 60 + window.start.minute,
    fim: window.end.hour * 60 + window.end.minute,
    turnoKey: window.shiftKey,
  }));
}

// Divide um intervalo [ini, fim) (em ms) em fatias por turno, retornando [{turnoKey, ini, fim}]
function splitIntervalPorTurno(iniMs, fimMs) {
  const res = [];
  let cursor = iniMs;
  while (cursor < fimMs) {
    // Normaliza cursor para horário do Brasil
    const dBr = toBrazilTime(new Date(cursor).toISOString());
    const minutos = dBr.getHours() * 60 + dBr.getMinutes();
    const turnosDia = getTurnoIntervalsDia(dBr);
    // Acha o turno atual
    let fatia = null;
    for (const t of turnosDia) {
      if (inRange(t.ini, t.fim, minutos)) {
        // Calcula fim da fatia em minutos relativos no fuso BR
        let fatiaFimMin = t.fim;
        if (t.fim <= t.ini) fatiaFimMin += 24 * 60; // cruza meia-noite
        const deltaMin = fatiaFimMin - minutos;
        let fatiaFim = cursor + (deltaMin * 60 * 1000);
        // Aplica limite do intervalo e corrige off-by-one no fim do dia (~23:59:59.999)
        let limite = Math.min(fimMs, fatiaFim);
        if (limite === fimMs && (fatiaFim - fimMs) <= 1000) {
          limite = fatiaFim;
        }
        fatia = {
          turnoKey: t.turnoKey,
          ini: cursor,
          fim: limite
        };
        break;
      }
    }
    if (!fatia) {
      // Fora de turno: não atribuir a nenhum turno (não contará em totais por turno)
      const nextMin = Math.min(fimMs, cursor + 60 * 1000);
      fatia = { turnoKey: null, ini: cursor, fim: nextMin };
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
    (MAQUINAS || []).forEach(maq => { porTurno[t.key][maq] = 0; });
  });
  if (!Array.isArray(paradas)) return porTurno;
  const intervalosPorTurno = {};
  turnos.forEach((turno) => {
    intervalosPorTurno[turno.key] = {};
    (MAQUINAS || []).forEach((maq) => {
      intervalosPorTurno[turno.key][maq] = [];
    });
  });

  paradas.forEach(p => {
    const maq = p.machine_id;
    if (!MAQUINAS.includes(maq)) return;
    const ini = p.started_at ? toBrazilTime(p.started_at).getTime() : null;
    const fimAberta = Math.min(
      filtroEnd ? filtroEnd.getTime() : Date.now(),
      Date.now()
    );
    const fim = p.ended_at
      ? toBrazilTime(p.ended_at).getTime()
      : p.resumed_at
        ? toBrazilTime(p.resumed_at).getTime()
        : fimAberta;
    if (!ini || !fim || fim <= ini) return;
    const iniClip = Math.max(ini, filtroStart ? filtroStart.getTime() : ini);
    const fimClip = Math.min(fim, filtroEnd ? filtroEnd.getTime() : fim);
    if (fimClip <= iniClip) return;

    const fatias = splitIntervalPorTurno(iniClip, fimClip);
    for (const f of fatias) {
      if (f.turnoKey && intervalosPorTurno[f.turnoKey]?.[maq]) {
        intervalosPorTurno[f.turnoKey][maq].push([f.ini, f.fim]);
      }
    }
  });

  turnos.forEach((turno) => {
    (MAQUINAS || []).forEach((maq) => {
      porTurno[turno.key][maq] = mergeIntervals(intervalosPorTurno[turno.key][maq]).reduce(
        (total, [ini, fim]) => total + Math.max(0, fim - ini),
        0
      );
    });
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
