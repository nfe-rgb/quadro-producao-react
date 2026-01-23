import { DateTime } from "luxon";

// Converte datetime ISO do supabase para JS Date no fuso de São Paulo
export function toBrazilTime(isoString) {
  // Luxon já entende offsets do ISO, incluindo 'Z'
  const dt = DateTime.fromISO(isoString).setZone("America/Sao_Paulo");
  return dt.toJSDate();
}