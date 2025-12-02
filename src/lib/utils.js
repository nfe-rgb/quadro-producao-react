import { DateTime } from "luxon";

// Retorna 1, 2, 3 ou 'Hora Extra'
// Aceita: nothing (usa agora), ISO string, JS Date, ou Luxon DateTime
export function getTurnoAtual(dateInput = null) {
  // normalize para um Luxon DateTime no fuso de São Paulo
  let dt;
  if (!dateInput) {
    dt = DateTime.now().setZone("America/Sao_Paulo");
  } else if (typeof dateInput === "string") {
    // aceita ISO com ou sem offset
    dt = DateTime.fromISO(dateInput, { setZone: true }).setZone("America/Sao_Paulo");
  } else if (dateInput instanceof Date) {
    dt = DateTime.fromJSDate(dateInput).setZone("America/Sao_Paulo");
  } else if (dateInput && typeof dateInput === "object" && dateInput.isLuxonDateTime) {
    dt = dateInput.setZone("America/Sao_Paulo");
  } else {
    // fallback seguro
    dt = DateTime.now().setZone("America/Sao_Paulo");
  }

  // Luxon.weekday: 1 = Monday ... 7 = Sunday
  // queremos dia estilo JS getDay(): 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const dia = dt.weekday % 7; // (7 % 7 = 0 -> Domingo)
  const minutos = dt.hour * 60 + dt.minute;

  const inRange = (startMin, endMin, m) => {
    if (startMin <= endMin) return m >= startMin && m < endMin;
    return m >= startMin || m < endMin;
  };

  // Domingo
  if (dia === 0) {
    if (inRange(23 * 60 + 15, 24 * 60, minutos)) return 3;
    if (minutos < 5 * 60 + 15) return 3;
    return "Hora Extra";
  }

  // Segunda a Sexta
  if (dia >= 1 && dia <= 5) {
    if (inRange(5 * 60 + 15, 13 * 60 + 45, minutos)) return 1;
    if (inRange(13 * 60 + 45, 22 * 60 + 15, minutos)) return 2;
    if (inRange(22 * 60 + 15, 5 * 60 + 15, minutos)) return 3;
  }

  // Sábado
  if (dia === 6) {
    if (inRange(5 * 60 + 15, 9 * 60 + 15, minutos)) return 1;
    if (inRange(9 * 60 + 15, 13 * 60 + 15, minutos)) return 2;
    return "Hora Extra";
  }

  return "Hora Extra";
}

// src/lib/utils.js
export function statusClass(s){
  if(s==='AGUARDANDO') return 'card gray'
  if(s==='PRODUZINDO') return 'card green'
  if(s==='BAIXA_EFICIENCIA') return 'card yellow'
  if(s==='PARADA') return 'card red'
  return 'card'
}

export function fmtDateTime(ts) {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    const dia = d.toLocaleDateString('pt-BR')
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    return `${dia} ${hora}`
  } catch { return ts }
}

// Converte data/hora local digitada -> ISO UTC
export function localDateTimeToISO(dateStr, timeStr) {
  const [Y,M,D] = dateStr.split('-').map(Number)
  const [h,m] = timeStr.split(':').map(Number)
  const local = new Date(Y, M-1, D, h, m, 0)
  return local.toISOString()
}

// Util: a ordem JÁ iniciou produção?
export function jaIniciou(ordem) { return Boolean(ordem?.started_at) }

export function fmtDuracao(startIso, endIso){
  if(!startIso || !endIso) return '-'
  const sec = Math.max(0, Math.floor((new Date(endIso) - new Date(startIso))/1000))
  const h = String(Math.floor(sec/3600)).padStart(2,'0')
  const m = String(Math.floor((sec%3600)/60)).padStart(2,'0')
  const s = String(sec%60).padStart(2,'0')
  return `${h}:${m}:${s}`
}
