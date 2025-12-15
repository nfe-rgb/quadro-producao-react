// Função utilitária para somar horas de paradas por turno e máquina
// Utilitário para checar se um valor está em um intervalo [ini, fim) considerando virada de dia
function inRange(minIni, minFim, minutos) {
  if (minIni <= minFim) return minutos >= minIni && minutos < minFim;
  // intervalo cruza meia-noite
  return minutos >= minIni || minutos < minFim;
}

// Retorna array de intervalos [{ini, fim, turnoKey}] para um dia específico, horários EXATOS para horas paradas
function getTurnoIntervalsDia(date) {
  const dia = date.getDay();
  // Horários exatos (sem tolerância) para cálculo de horas paradas:
  // Turno 1: 05:00 às 13:30
  // Turno 2: 13:30 às 22:00
  // Turno 3: 22:00 às 05:00
  if (dia === 0) { // Domingo
    return [
      { ini: 23 * 60, fim: 24 * 60, turnoKey: '3' }, // 23:00 até 00:00
      // resto é hora extra (não considerar 00:00–05:00 no domingo)
    ];
  }
  if (dia >= 1 && dia <= 5) { // Segunda a Sexta
    return [
      { ini: 5 * 60, fim: 13 * 60 + 30, turnoKey: '1' },   // 05:00 até 13:30
      { ini: 13 * 60 + 30, fim: 22 * 60, turnoKey: '2' },  // 13:30 até 22:00
      { ini: 22 * 60, fim: 24 * 60, turnoKey: '3' },       // 22:00 até 00:00
      { ini: 0, fim: 5 * 60, turnoKey: '3' },              // 00:00 até 05:00
    ];
  }
  if (dia === 6) { // Sábado
    return [
      { ini: 0, fim: 5 * 60, turnoKey: '3' },        // 00:00 até 05:00
      { ini: 5 * 60, fim: 9 * 60, turnoKey: '1' },   // 05:00 até 09:00
      { ini: 9 * 60, fim: 13 * 60, turnoKey: '2' },  // 09:00 até 13:00
      // resto é hora extra (não considerar 23:00–00:00 no sábado)
    ];
  }
  return [];
}

// Divide um intervalo [ini, fim) (em ms) em fatias por turno, retornando [{turnoKey, ini, fim}]
function splitIntervalPorTurno(iniMs, fimMs) {
  const res = [];
  let cursor = iniMs;
  while (cursor < fimMs) {
    // Normaliza cursor para horário do Brasil
    const dBr = toBrazilTime(new Date(cursor).toISOString());
    const dia = dBr.getDay();
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

import { toBrazilTime } from './timezone';
import { MAQUINAS } from './constants';

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
  paradas.forEach(p => {
    const maq = p.machine_id;
    if (!MAQUINAS.includes(maq)) return;
    const ini = p.started_at ? toBrazilTime(p.started_at).getTime() : null;
    const fimAberta = Math.min(
      filtroEnd ? filtroEnd.getTime() : Date.now(),
      Date.now()
    );
    const fim = p.resumed_at
      ? toBrazilTime(p.resumed_at).getTime()
      : fimAberta;
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
