// ===============================================================
// ND Airbus PRO v7 — Optimisé (FPV + METAR + WX + Panel)
// ===============================================================

import { map, planeIndex } from "./map.js";

// ===============================================================
// État ND
// ===============================================================
let selectedHex = null;
let metarData = null;
let wxData = null;
let fpvMarker = null;

// ===============================================================
// FPV Airbus — icône PRO
// ===============================================================
const fpvIcon = L.divIcon({
  className: "fpv-icon",
  html: `
    <svg width="42" height="42" viewBox="0 0 42 42">
      <circle cx="21" cy="21" r="10" stroke="#00ffff" stroke-width="2" fill="none"/>
      <line x1="11" y1="21" x2="31" y2="21" stroke="#00ffff" stroke-width="2"/>
      <line x1="16" y1="26" x2="21" y2="32" stroke="#00ffff" stroke-width="2"/>
      <line x1="26" y1="26" x2="21" y2="32" stroke="#00ffff" stroke-width="2"/>
    </svg>
  `,
  iconSize: [42, 42],
  iconAnchor: [21, 21]
});

// ===============================================================
// API publique — utilisée par FIDS.js
// ===============================================================
export function setSelectedAircraft(hex) {
  selectedHex = hex;
}

export function centerOnAircraft(hex) {
  const plane = planeIndex[hex];
  if (!plane) return;

  const { lat, lon } = plane.options.data;
  map.setView([lat, lon], 11, { animate: true });
}

export function highlightAircraft(hex) {
  const plane = planeIndex[hex];
  if (!plane) return;

  plane.setStyle({ color: "#00ffff", weight: 4 });

  setTimeout(() => {
    plane.setStyle({ color: "#38bdf8", weight: 2 });
  }, 2500);
}

// ===============================================================
// FPV Airbus — logique optimisée
// ===============================================================
export function updateFPV(hex) {
  const plane = planeIndex[hex];
  if (!plane) return;

  const p = plane.options.data;
  if (!p) return;

  const hdg = p.heading || p.true_heading || p.mag_heading || p.track || 0;
  const trk = p.track || hdg;

  const drift = trk - hdg;
  const fpv = ((trk - drift + 360) % 360);

  const { lat, lon } = p;

  if (!fpvMarker) {
    fpvMarker = L.marker([lat, lon], {
      icon: fpvIcon,
      rotationAngle: fpv,
      rotationOrigin: "center center"
    }).addTo(map);
  } else {
    fpvMarker.setLatLng([lat, lon]);
    fpvMarker.setRotationAngle(fpv);
  }
}

// ===============================================================
// METEO (METAR + Open-Meteo via Worker)
// ===============================================================
async function fetchMeteo(apt) {
  try {
    const res = await fetch(
      `https://bruit-aero-proxy.pnyr682w7f.workers.dev/api/meteo?apt=${apt}`,
      { cache: "no-store" }
    );
    if (!res.ok) return;

    const data = await res.json();

    metarData = parseMetar(data.metar);
    wxData = data.meteo;

  } catch (e) {
    console.error("METEO KO:", e);
  }
}

// Rafraîchissement METEO
setInterval(() => {
  fetchMeteo("EBLG");
  fetchMeteo("EBCI");
}, 60000);

// ===============================================================
// Parse METAR — optimisé
// ===============================================================
function parseMetar(raw) {
  if (!raw) return null;

  const parts = raw.split(" ");

  let windDir = "---";
  let windSpd = "---";
  let qnh = "---";
  let trend = "";

  for (const p of parts) {
    if (/^\d{3}\d{2}KT$/.test(p)) {
      windDir = parseInt(p.slice(0, 3));
      windSpd = parseInt(p.slice(3, 5));
    }
    if (p.startsWith("Q")) qnh = p.slice(1);
    if (p.startsWith("BECMG")) trend = "BECMG";
    if (p.startsWith("TEMPO")) trend = "TEMPO";
    if (p.startsWith("NOSIG")) trend = "NOSIG";
  }

  return { windDir, windSpd, qnh, trend };
}

// ===============================================================
// Rose des vents METAR — optimisée
// ===============================================================
function updateWindRose() {
  if (!metarData) return;

  const deg = metarData.windDir || 0;
  const spd = metarData.windSpd || 0;

  const rose  = document.getElementById("nd-wind-rose");
  const arrow = document.getElementById("nd-wind-arrow");
  const label = document.getElementById("nd-wind-label");

  if (!rose || !arrow || !label) return;

  rose.style.transform  = `rotate(${deg}deg)`;
  arrow.style.transform = `rotate(${deg}deg) translate(0, -12px)`;
  label.textContent     = `${deg}° / ${spd} kt`;
}

// ===============================================================
// WX Radar — simulation Airbus optimisée
// ===============================================================
function updateWxRadar() {
  if (!wxData) return;

  const wind = wxData.wind?.speed || 0;
  const radar = document.getElementById("nd-wx-radar");
  if (!radar) return;

  radar.style.background =
    wind > 50 ? "rgba(255,0,0,0.45)" :
    wind > 35 ? "rgba(255,128,0,0.4)" :
    wind > 20 ? "rgba(255,255,0,0.35)" :
                "rgba(0,255,0,0.25)";
}

// ===============================================================
// ND Panel — Optimisé (HDG / TRK / GS / TAS / WIND / QNH)
// ===============================================================
function updateNdPanel() {
  if (!selectedHex) return;

  const plane = planeIndex[selectedHex];
  if (!plane) return;

  const p = plane.options.data;
  if (!p) return;

  const hdg = p.heading || p.true_heading || p.mag_heading || p.track || 0;
  const trk = p.track || hdg;

  const hdgNorm = Math.round((hdg + 360) % 360);
  const trkNorm = Math.round((trk + 360) % 360);

  const gsKt = Math.round(p.gs || (p.speed_ms ? p.speed_ms / 0.514444 : 0));
  const tasKt = Math.round(gsKt * 1.05);

  let windDir = "---";
  let windSpd = "---";

  if (wxData?.wind) {
    windDir = Math.round(wxData.wind.deg || 0);
    windSpd = Math.round(wxData.wind.speed || 0);
  } else if (metarData) {
    windDir = metarData.windDir;
    windSpd = metarData.windSpd;
  }

  let headComp = "---";
  let crossComp = "---";

  if (typeof windDir === "number" && typeof windSpd === "number") {
    const diff = ((windDir - trkNorm + 540) % 360) - 180;
    const rad = diff * Math.PI / 180;

    const head = Math.round(windSpd * Math.cos(rad));
    const cross = Math.round(windSpd * Math.sin(rad));

    headComp  = `${head >= 0 ? "H" : "T"} ${Math.abs(head)} kt`;
    crossComp = `${cross >= 0 ? "R" : "L"} ${Math.abs(cross)} kt`;
  }

  document.getElementById("nd-hdg").innerText = hdgNorm;
  document.getElementById("nd-trk").innerText = trkNorm;
  document.getElementById("nd-gs").innerText  = `${gsKt} kt`;
  document.getElementById("nd-tas").innerText = `${tasKt} kt`;
  document.getElementById("nd-wind").innerText = `${windDir}° / ${windSpd} kt`;
  document.getElementById("nd-windcomp").innerText = `${headComp} / ${crossComp}`;

  if (metarData) {
    document.getElementById("nd-qnh").innerText   = `${metarData.qnh} hPa`;
    document.getElementById("nd-trend").innerText = metarData.trend || "";
  }
}

// ===============================================================
// Boussole vent / LOC / GP — Optimisée
// ===============================================================
export function updateCompassUI(prefix, windDeg, windSpeedKmh) {
  const needle  = document.getElementById(`${prefix}-compass-needle`);
  const label   = document.getElementById(`${prefix}-compass-label`);
  const loc     = document.getElementById(`${prefix}-compass-loc`);
  const gp      = document.getElementById(`${prefix}-compass-gp`);
  const windVec = document.getElementById(`${prefix}-compass-wind`);

  if (!needle || !label || !loc || !gp || !windVec) return;

  needle.style.transform  = `rotate(${windDeg}deg)`;
  windVec.style.transform = `rotate(${windDeg}deg) translate(-50%, -50%)`;

  const runwayHeading =
    prefix === "ebci" ? (windDeg > 180 ? 240 : 60) :
    prefix === "eblg" ? (windDeg > 180 ? 220 : 40) : 0;

  loc.style.transform = `rotate(${runwayHeading}deg)`;
  gp.style.transform  = `rotate(${runwayHeading}deg)`;

  label.textContent = `${windDeg}° / ${windSpeedKmh} km/h`;
}

// ===============================================================
// Boucle ND — Optimisée
// ===============================================================
setInterval(() => {
  if (!selectedHex) return;
  updateNdPanel();
  updateFPV(selectedHex);
  updateWindRose();
  updateWxRadar();
}, 1000);
