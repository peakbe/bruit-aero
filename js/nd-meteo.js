import { WORKER_BASE_URL } from "./config.js";
import { getAirportWind } from "./sono.js";
import { drawCompass } from "./nd-compass.js";

async function fetchMeteo(apt) {
  const res = await fetch(`${WORKER_BASE_URL}/api/meteo?apt=${apt}`);
  return res.ok ? res.json() : null;
}

async function fetchTaf(apt) {
  const res = await fetch(`${WORKER_BASE_URL}/api/taf?apt=${apt}`);
  return res.ok ? res.json() : null;
}

function decodeTaf(raw) {
  if (!raw) return "TAF indisponible";
  // version courte : tendance principale
  const tempo = raw.match(/TEMPO .*?(\d{4})/);
  const prob = raw.match(/PROB(\d{2})/);
  return [
    prob ? `Probabilité ${prob[1]}%` : null,
    tempo ? `Tendance TEMPO vers ${tempo[1]} m de visi` : null
  ].filter(Boolean).join(" — ") || "Tendance stable";
}

export async function renderNDForAirport(apt) {
  const meteo = await fetchMeteo(apt);
  const taf = await fetchTaf(apt);

  const windSono = getAirportWind(apt);          // vent réel sonomètres
  const windMetar = meteo?.meteo?.wind || null;  // vent METAR (backup)

  const wind = windSono.speed > 0 ? windSono : windMetar || { speed: 0, deg: 0 };

  // Rose des vents ND
  drawCompass(`compass-${apt.toLowerCase()}`, wind.deg, wind.speed);

  // METAR brut
  const metarEl = document.getElementById(`metar-${apt.toLowerCase()}`);
  if (metarEl && meteo?.metar) metarEl.textContent = meteo.metar;

  // TAF décodé
  const tafEl = document.getElementById(`taf-${apt.toLowerCase()}`);
  if (tafEl && taf?.taf) tafEl.textContent = decodeTaf(taf.taf);
}
