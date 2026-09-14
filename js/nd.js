// ===============================================================
// ND Airbus — Panneau HDG / TRK / GS / TAS / WIND + METEO PRO v3
// ===============================================================

import { planeIndex } from "./map.js";
import { updateFPV } from "./nd.js";

let selectedHex = null;
let meteoData = null;   // météo stockée ici

// ---------------------------------------------------------------
// Sélection avion depuis ND / FIDS
// ---------------------------------------------------------------
export function setSelectedAircraft(hex) {
  selectedHex = hex;
}

// ---------------------------------------------------------------
// Récupération METEO depuis Worker
// ---------------------------------------------------------------
async function fetchMeteo(airport = "EBLG") {
  try {
    const res = await fetch(
      `https://bruit-aero-proxy.pnyr682w7f.workers.dev/api/meteo?apt=${airport}`,
      { cache: "no-store" }
    );
    if (!res.ok) return;

    meteoData = await res.json();
  } catch (e) {
    console.error("METEO KO:", e);
  }
}

// Mise à jour météo toutes les 60 s
setInterval(() => {
  fetchMeteo("EBLG");
  fetchMeteo("EBCI");
}, 60000);

// ---------------------------------------------------------------
// Mise à jour panneau ND Airbus
// ---------------------------------------------------------------
function updateNdPanel() {
  if (!selectedHex) return;

  const plane = planeIndex[selectedHex];
  if (!plane) return;

  const p = plane.options.data;
  if (!p) return;

  // -----------------------------
  // HDG / TRK — fallback Airbus
  // -----------------------------
  const hdg =
    p.heading ||
    p.true_heading ||
    p.mag_heading ||
    p.track ||
    0;

  const trk = p.track || hdg;

  const hdgNorm = Math.round(((hdg % 360) + 360) % 360);
  const trkNorm = Math.round(((trk % 360) + 360) % 360);

  // -----------------------------
  // GS / TAS
  // -----------------------------
  const gsKt = Math.round(
    p.gs ||
    (p.speed_ms ? p.speed_ms / 0.514444 : 0)
  );

  const tasKt = Math.round(gsKt * 1.05);

  // -----------------------------
  // METEO ND Airbus
  // -----------------------------
  let windDir = "---";
  let windSpd = "---";
  let temp = "---";

  if (meteoData && meteoData.meteo) {
    windDir = meteoData.meteo.wind.deg ?? "---";
    windSpd = Math.round((meteoData.meteo.wind.speed ?? 0) / 1.852); // km/h → kt
    temp = Math.round(meteoData.meteo.main.temp ?? "---");
  }

  // WINDCOMP (composante vent)
  let windComp = "---";
  if (windDir !== "---" && trkNorm !== "---" && windSpd !== "---") {
    const diff = Math.abs(windDir - trkNorm);
    windComp = Math.round(windSpd * Math.cos(diff * Math.PI / 180));
  }

  // -----------------------------
  // Injection cockpit Airbus
  // -----------------------------
  document.getElementById("nd-hdg").innerText = hdgNorm;
  document.getElementById("nd-trk").innerText = trkNorm;
  document.getElementById("nd-gs").innerText = `${gsKt} kt`;
  document.getElementById("nd-tas").innerText = `${tasKt} kt`;

  document.getElementById("nd-wind").innerText = `${windDir}° / ${windSpd} kt`;
  document.getElementById("nd-temp").innerText = `${temp}°C`;
  document.getElementById("nd-windcomp").innerText = `${windComp} kt`;
}

// ---------------------------------------------------------------
// Mise à jour automatique ND + FPV
// ---------------------------------------------------------------
setInterval(() => {
  if (selectedHex) {
    updateNdPanel();
    updateFPV(selectedHex);
  }
}, 1000);
