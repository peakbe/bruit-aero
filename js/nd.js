// ===============================================================
// ND Airbus — METAR Rose + WX Radar + Wind Vector (PRO v5)
// ===============================================================

import { planeIndex } from "./map.js";

// ===============================================================
// FPV Airbus — icône + logique PRO v3
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

let fpvMarker = null;

// ---------------------------------------------------------------
// EXPORT : updateFPV (Airbus FPV)
// ---------------------------------------------------------------
export function updateFPV(hex) {
  const plane = planeIndex[hex];
  if (!plane) return;

  const p = plane.options.data;
  if (!p) return;

  const hdg =
    p.heading ||
    p.true_heading ||
    p.mag_heading ||
    p.track ||
    0;

  const trk = p.track || hdg;

  const drift = trk - hdg;
  let fpv = trk - drift;

  fpv = ((fpv % 360) + 360) % 360;

  const lat = p.lat;
  const lon = p.lon;

  if (fpvMarker) {
    fpvMarker.setLatLng([lat, lon]);
    fpvMarker.setRotationAngle(fpv);
    return;
  }

  fpvMarker = L.marker([lat, lon], {
    icon: fpvIcon,
    rotationAngle: fpv,
    rotationOrigin: "center center"
  }).addTo(map);
}

// ===============================================================
// METAR + WX Radar + Rose METAR
// ===============================================================

let selectedHex = null;
let metarData = null;
let wxData = null;

export function setSelectedAircraft(hex) {
  selectedHex = hex;
}

// ---------------------------------------------------------------
// METAR
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
// WX Radar
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

setInterval(() => {
  fetchMetar("EBLG");
  fetchMetar("EBCI");
  fetchWx("EBLG");
  fetchWx("EBCI");
}, 60000);

// ---------------------------------------------------------------
// Parse METAR
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
// Rose METAR
// ---------------------------------------------------------------
function updateWindRose() {
  if (!metarData) return;

  const deg = metarData.windDir || 0;
  const spd = metarData.windSpd || 0;

  const rose = document.getElementById("nd-wind-rose");
  const arrow = document.getElementById("nd-wind-arrow");
  const label = document.getElementById("nd-wind-label");

  if (!rose || !arrow || !label) return;

  rose.style.transform = `rotate(${deg}deg)`;
  arrow.style.transform = `rotate(${deg}deg) translate(0, -12px)`;
  arrow.style.transition = "transform 0.8s linear";

  label.textContent = `${deg}° / ${spd} kt`;
}

// ---------------------------------------------------------------
// WX Radar
// ---------------------------------------------------------------
function updateWxRadar() {
  if (!wxData?.list?.[0]) return;

  const precip = wxData.list[0].pop * 100;
  const radar = document.getElementById("nd-wx-radar");

  if (!radar) return;

  let color = "rgba(0,255,0,0.3)";
  if (precip > 30) color = "rgba(255,255,0,0.35)";
  if (precip > 60) color = "rgba(255,128,0,0.4)";
  if (precip > 80) color = "rgba(255,0,0,0.45)";

  radar.style.background = color;
}

// ---------------------------------------------------------------
// ND Panel
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
// Mise à jour automatique ND + FPV + Rose + WX Radar
// ---------------------------------------------------------------
setInterval(() => {
  if (selectedHex) {
    updateNdPanel();
    updateFPV(selectedHex);
    updateWindRose();
    updateWxRadar();
  }
}, 1000);
