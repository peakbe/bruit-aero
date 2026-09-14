// ===============================================================
// ND Airbus — METAR Rose + WX Radar + Wind Vector (PRO v5)
// ===============================================================

import { planeIndex } from "./map.js";
import { updateFPV } from "./nd.js";

let selectedHex = null;
let metarData = null;
let wxData = null;

// ---------------------------------------------------------------
// Sélection avion depuis ND / FIDS
// ---------------------------------------------------------------
export function setSelectedAircraft(hex) {
  selectedHex = hex;
}

// ---------------------------------------------------------------
// 1. Récupération METAR (vent + QNH + tendance)
// ---------------------------------------------------------------
async function fetchMetar(station = "EBLG") {
  try {
    const res = await fetch(
      `https://bruit-aero-proxy.pnyr682w7f.workers.dev/api/metar?station=${station}`,
      { cache: "no-store" }
    );
    if (!res.ok) return;

    const raw = await res.json();
    metarData = parseMetar(raw.raw);
  } catch (e) {
    console.error("METAR KO:", e);
  }
}

// ---------------------------------------------------------------
// 2. Récupération WX Radar (Open-Meteo)
// ---------------------------------------------------------------
async function fetchWx(apt = "EBLG") {
  try {
    const res = await fetch(
      `https://bruit-aero-proxy.pnyr682w7f.workers.dev/api/forecast?apt=${apt}`,
      { cache: "no-store" }
    );
    if (!res.ok) return;

    wxData = await res.json();
  } catch (e) {
    console.error("WX KO:", e);
  }
}

// Mise à jour météo toutes les 60 s
setInterval(() => {
  fetchMetar("EBLG");
  fetchMetar("EBCI");
  fetchWx("EBLG");
  fetchWx("EBCI");
}, 60000);

// ---------------------------------------------------------------
// Parse METAR → vent + QNH + tendance
// ---------------------------------------------------------------
function parseMetar(raw) {
  if (!raw) return null;

  const parts = raw.split(" ");

  let windDir = "---";
  let windSpd = "---";
  let qnh = "---";
  let trend = "";

  parts.forEach(p => {
    if (/^\d{3}\d{2}KT$/.test(p)) {
      windDir = parseInt(p.substring(0, 3));
      windSpd = parseInt(p.substring(3, 5));
    }
    if (p.startsWith("Q")) qnh = p.substring(1);
    if (p.startsWith("BECMG")) trend = "BECMG";
    if (p.startsWith("TEMPO")) trend = "TEMPO";
  });

  return { windDir, windSpd, qnh, trend };
}

// ---------------------------------------------------------------
// 3. Rose des vents METAR (Airbus)
// ---------------------------------------------------------------
function updateWindRose() {
  if (!metarData) return;

  const deg = metarData.windDir || 0;
  const spd = metarData.windSpd || 0;

  const rose = document.getElementById("nd-wind-rose");
  const arrow = document.getElementById("nd-wind-arrow");
  const label = document.getElementById("nd-wind-label");

  if (!rose || !arrow || !label) return;

  // Rotation rose
  rose.style.transform = `rotate(${deg}deg)`;

  // Flèche vent
  arrow.style.transform = `rotate(${deg}deg) translate(0, -12px)`;
  arrow.style.transition = "transform 0.8s linear";

  // Label cockpit
  label.textContent = `${deg}° / ${spd} kt`;
}

// ---------------------------------------------------------------
// 4. WX Radar — intensité précipitations
// ---------------------------------------------------------------
function updateWxRadar() {
  if (!wxData?.list?.[0]) return;

  const precip = wxData.list[0].pop * 100; // %
  const radar = document.getElementById("nd-wx-radar");

  if (!radar) return;

  // Couleurs Airbus WX
  let color = "rgba(0,255,0,0.3)";   // vert léger

  if (precip > 30) color = "rgba(255,255,0,0.35)";  // jaune
  if (precip > 60) color = "rgba(255,128,0,0.4)";   // orange
  if (precip > 80) color = "rgba(255,0,0,0.45)";     // rouge

  radar.style.background = color;
}

// ---------------------------------------------------------------
// 5. Mise à jour panneau ND Airbus
// ---------------------------------------------------------------
function updateNdPanel() {
  if (!selectedHex) return;

  const plane = planeIndex[selectedHex];
  if (!plane) return;

  const p = plane.options.data;
  if (!p) return;

  const hdg = p.heading || p.true_heading || p.mag_heading || p.track || 0;
  const trk = p.track || hdg;

  const hdgNorm = Math.round(((hdg % 360) + 360) % 360);
  const trkNorm = Math.round(((trk % 360) + 360) % 360);

  const gsKt = Math.round(p.gs || (p.speed_ms ? p.speed_ms / 0.514444 : 0));
  const tasKt = Math.round(gsKt * 1.05);

  document.getElementById("nd-hdg").innerText = hdgNorm;
  document.getElementById("nd-trk").innerText = trkNorm;
  document.getElementById("nd-gs").innerText = `${gsKt} kt`;
  document.getElementById("nd-tas").innerText = `${tasKt} kt`;

  if (metarData) {
    document.getElementById("nd-qnh").innerText = `${metarData.qnh} hPa`;
    document.getElementById("nd-trend").innerText = metarData.trend || "";
  }
}

// ---------------------------------------------------------------
// 6. Mise à jour automatique ND + FPV + Rose + WX Radar
// ---------------------------------------------------------------
setInterval(() => {
  if (selectedHex) {
    updateNdPanel();
    updateFPV(selectedHex);
    updateWindRose();
    updateWxRadar();
  }
}, 1000);
