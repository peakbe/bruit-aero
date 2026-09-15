// ===============================================================
// ND Airbus PRO v6 — ND + Panel + FPV + METAR + WX Radar
// ===============================================================

import { map, planeIndex } from "./map.js";

let selectedHex = null;
let metarData = null;
let wxData = null;
let fpvMarker = null;

// ===============================================================
// 0. FPV Airbus — icône PRO
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
// 1. API publique — utilisée par FIDS.js
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

  plane.setStyle({
    color: "#00ffff",
    weight: 4
  });

  setTimeout(() => {
    plane.setStyle({
      color: "#38bdf8",
      weight: 2
    });
  }, 2500);
}

// ===============================================================
// 2. FPV Airbus — logique PRO
// ===============================================================
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
// 3. METEO (METAR + Open-Meteo) — via Worker PRO v4
// ===============================================================
async function fetchMeteo(apt = "EBLG") {
  try {
    const res = await fetch(
      `https://bruit-aero-proxy.pnyr682w7f.workers.dev/api/meteo?apt=${apt}`,
      { cache: "no-store" }
    );
    if (!res.ok) return;

    const data = await res.json();

    // METAR brut
    metarData = parseMetar(data.metar);

    // Open-Meteo
    wxData = data.meteo;

  } catch (e) {
    console.error("METEO KO:", e);
  }
}

// Mise à jour METEO toutes les 60 s
setInterval(() => {
  fetchMeteo("EBLG");
  fetchMeteo("EBCI");
}, 60000);

// ===============================================================
// 4. Parse METAR → vent + QNH + tendance
// ===============================================================
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

// ===============================================================
// 5. Rose des vents METAR
// ===============================================================
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

// ===============================================================
// 6. WX Radar — intensité précipitations Airbus (simulation)
// ===============================================================
function updateWxRadar() {
  if (!wxData) return;

  const wind = wxData.wind?.speed || 0;
  const radar = document.getElementById("nd-wx-radar");
  if (!radar) return;

  // Simulation Airbus WX (faute de POP dans Open-Meteo)
  let color = "rgba(0,255,0,0.25)";   // vert léger
  if (wind > 20) color = "rgba(255,255,0,0.35)";  // jaune
  if (wind > 35) color = "rgba(255,128,0,0.4)";   // orange
  if (wind > 50) color = "rgba(255,0,0,0.45)";     // rouge

  radar.style.background = color;
}

// ===============================================================
// 7. Panneau ND Airbus (HDG / TRK / GS / TAS / QNH)
// ===============================================================
function updateNdPanel() {
  if (!selectedHex) return;

  const plane = planeIndex[selectedHex];
  if (!plane) return;

  const p = plane.options.data;
  if (!p) return;

  // HDG / TRK
  const hdg =
    p.heading ||
    p.true_heading ||
    p.mag_heading ||
    p.track ||
    0;

  const trk = p.track || hdg;

  const hdgNorm = Math.round(((hdg % 360) + 360) % 360);
  const trkNorm = Math.round(((trk % 360) + 360) % 360);

  // GS / TAS
  const gsKt = Math.round(
    p.gs ||
    (p.speed_ms ? p.speed_ms / 0.514444 : 0)
  );

  const tasKt = Math.round(gsKt * 1.05);   // petit biais TAS façon Airbus

  // WIND (depuis wxData si dispo)
  let windDir = "---";
  let windSpd = "---";

  if (wxData?.wind) {
    windDir = Math.round(wxData.wind.deg || 0);
    windSpd = Math.round(wxData.wind.speed || 0);
  } else if (metarData) {
    windDir = metarData.windDir;
    windSpd = metarData.windSpd;
  }

  // WIND components (head / cross)
  let headComp = "---";
  let crossComp = "---";

  if (typeof windDir === "number" && typeof windSpd === "number") {
    const diff = ((windDir - trkNorm + 540) % 360) - 180;
    const rad = diff * Math.PI / 180;

    const head = Math.round(windSpd * Math.cos(rad));
    const cross = Math.round(windSpd * Math.sin(rad));

    headComp = `${head >= 0 ? "H" : "T"} ${Math.abs(head)} kt`;
    crossComp = `${cross >= 0 ? "R" : "L"} ${Math.abs(cross)} kt`;
  }

  // SONO status (simple texte, ND-utils gère déjà le reste)
  const sonoEl = document.getElementById("nd-sono");
  if (sonoEl) {
    sonoEl.innerText = window.activeRunway
      ? `RWY ${window.activeRunway}`
      : "---";
  }

  // Écriture UI
  document.getElementById("nd-hdg").innerText = hdgNorm;
  document.getElementById("nd-trk").innerText = trkNorm;
  document.getElementById("nd-gs").innerText = `${gsKt} kt`;
  document.getElementById("nd-tas").innerText = `${tasKt} kt`;
  document.getElementById("nd-wind").innerText = `${windDir}° / ${windSpd} kt`;
  document.getElementById("nd-windcomp").innerText = `${headComp} / ${crossComp}`;

  if (metarData) {
    const qnhEl = document.getElementById("nd-qnh");
    const trendEl = document.getElementById("nd-trend");

    if (qnhEl) qnhEl.innerText = `${metarData.qnh} hPa`;
    if (trendEl) trendEl.innerText = metarData.trend || "";
  }
}

// ===============================================================
// 8. Boussole vent / LOC / GP (optionnel)
// ===============================================================
export function updateCompassUI(prefix, windDeg, windSpeedKmh) {
  const needle = document.getElementById(`${prefix}-compass-needle`);
  const label  = document.getElementById(`${prefix}-compass-label`);
  const loc    = document.getElementById(`${prefix}-compass-loc`);
  const gp     = document.getElementById(`${prefix}-compass-gp`);
  const windVec = document.getElementById(`${prefix}-compass-wind`);

  if (!needle || !label || !loc || !gp || !windVec) return;

  needle.style.transform = `rotate(${windDeg}deg)`;
  windVec.style.transform = `rotate(${windDeg}deg) translate(-50%, -50%)`;

  let runwayHeading = 0;
  if (prefix === "ebci") runwayHeading = windDeg > 180 ? 240 : 60;
  if (prefix === "eblg") runwayHeading = windDeg > 180 ? 220 : 40;

  loc.style.transform = `rotate(${runwayHeading}deg)`;
  gp.style.transform  = `rotate(${runwayHeading}deg)`;

  label.textContent = `${windDeg}° / ${windSpeedKmh} km/h`;
}

// ===============================================================
// 9. Boucle de mise à jour ND + FPV + METAR + WX
// ===============================================================
setInterval(() => {
  if (selectedHex) {
    updateNdPanel();
    updateFPV(selectedHex);
    updateWindRose();
    updateWxRadar();
  }
}, 1000);
