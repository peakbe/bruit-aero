// ===============================================================
// nd-meteo.js — Fusion METAR + TAF + SONO pour ND Airbus PRO+++
// ===============================================================

import { WORKER_BASE_URL } from "./config.js";
import { getAirportWind } from "./sono.js";
import { drawCompass } from "./nd-compass.js";

// ===============================================================
// 1. Fetch METAR / TAF via Worker
// ===============================================================
async function fetchMeteo(apt) {
  try {
    const res = await fetch(`${WORKER_BASE_URL}/api/meteo?apt=${apt}`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function fetchTaf(apt) {
  try {
    const res = await fetch(`${WORKER_BASE_URL}/api/taf?apt=${apt}`);
    if (!res.ok) return null;

    // Le Worker renvoie du TEXTE, pas du JSON
    const raw = await res.text();
    return { raw };
  } catch {
    return null;
  }
}

// ===============================================================
// 2. Décodage TAF — version courte PRO+++
// ===============================================================
function decodeTaf(raw) {
  if (!raw) return "TAF indisponible";

  const tempo = raw.match(/TEMPO\s+.*?(\d{4})/);
  const prob  = raw.match(/PROB(\d{2})/);

  return [
    prob  ? `Probabilité ${prob[1]}%` : null,
    tempo ? `TEMPO → visibilité ${tempo[1]} m` : null
  ].filter(Boolean).join(" — ") || "Tendance stable";
}

// ===============================================================
// 3. Fusion vent SONO + METAR PRO+++
// ===============================================================
function fuseWind(apt, meteo) {
  const sono = getAirportWind(apt); // { speed (km/h), deg }

  // METAR → vent officiel
  const metarWind = meteo?.meteo?.wind || null;

  const metarDeg = metarWind?.deg ?? null;
  const metarSpdKmh = metarWind?.speed ?? null;

  const metarSpdKt = metarSpdKmh ? metarSpdKmh / 1.94384 : null;

  // SONO → vent local bruit
  const sonoDeg = sono?.deg ?? null;
  const sonoSpdKt = sono?.speed ? sono.speed / 1.94384 : null;

  // Fusion pondérée : 70% METAR, 30% SONO
  const fusedDeg = Math.round(
    (metarDeg ?? sonoDeg ?? 0) * 0.7 +
    (sonoDeg ?? metarDeg ?? 0) * 0.3
  );

  const fusedSpdKt = Math.round(
    (metarSpdKt ?? sonoSpdKt ?? 0) * 0.7 +
    (sonoSpdKt ?? metarSpdKt ?? 0) * 0.3
  );

  return {
    deg: fusedDeg,
    spdKt: fusedSpdKt
  };
}

// ===============================================================
// 4. Rendu ND Airbus pour un aéroport
// ===============================================================
export async function renderNDForAirport(apt) {

  // METAR + météo Open-Meteo
  const meteo = await fetchMeteo(apt);

  // TAF brut
  const taf = await fetchTaf(apt);

  // Vent fusionné SONO + METAR
  const fusedWind = fuseWind(apt, meteo);

  // ============================================================
  // 4.1 Rose des vents ND Airbus
  // ============================================================
  drawCompass(
    `compass-${apt.toLowerCase()}`,
    fusedWind.deg,
    fusedWind.spdKt
  );

  // ============================================================
  // 4.2 METAR brut
  // ============================================================
  const metarEl = document.getElementById(`metar-${apt.toLowerCase()}`);
  if (metarEl) {
    metarEl.textContent = meteo?.metar || "METAR indisponible";
  }

  // ============================================================
  // 4.3 TAF décodé
  // ============================================================
  const tafEl = document.getElementById(`taf-${apt.toLowerCase()}`);
  if (tafEl) {
    tafEl.textContent = taf?.raw ? decodeTaf(taf.raw) : "TAF indisponible";
  }
}
