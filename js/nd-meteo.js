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
    if (!res.ok) return { raw: null };

    const raw = await res.text();
    return { raw };
  } catch {
    return { raw: null };
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
  const sono = getAirportWind(apt);

  const metarWind = meteo?.meteo?.wind || null;

  const metarDeg = metarWind?.deg ?? null;
  const metarSpdKmh = metarWind?.speed ?? null;
  // Conversion km/h vers Nœuds (kt) : km/h / 1.852
  const metarSpdKt = metarSpdKmh ? metarSpdKmh / 1.852 : null;

  const sonoDeg = sono?.deg ?? null;
  const sonoSpdKt = sono?.speed ? sono.speed / 1.852 : null;

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

  const meteo = await fetchMeteo(apt);
  const taf   = await fetchTaf(apt);

  const fusedWind = fuseWind(apt, meteo);

  // Envoi du vent fusionné en nœuds (kts) vers le composant boussole
  drawCompass(
    `compass-${apt.toLowerCase()}`,
    fusedWind.deg,
    fusedWind.spdKt
  );

  const metarEl = document.getElementById(`metar-${apt.toLowerCase()}`);
  if (metarEl) {
    metarEl.textContent = meteo?.metar || "METAR indisponible";
  }

  const tafEl = document.getElementById(`taf-${apt.toLowerCase()}`);
  if (tafEl) {
    tafEl.textContent = taf?.raw
      ? decodeTaf(taf.raw)
      : "TAF non publié";
  }
}
