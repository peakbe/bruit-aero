// ===============================================================
// nd.js — ND Airbus PRO v8 (ND + Panel + FPV + METAR + WX Radar)
// ===============================================================

import { map, planeIndex } from "./map.js";
import { WORKER_BASE_URL } from "./config.js";

// ===============================================================
// État ND
// ===============================================================
let selectedHex = null;
let metarData = null;   // METAR décodé (vent / QNH / tendance)
let wxData = null;      // Météo Open-Meteo (vent, rafales, etc.)
let fpvMarker = null;

// ===============================================================
// FPV Airbus — Icône Cyan Style Cockpit
// ===============================================================
const fpvIcon = L.divIcon({
  className: "fpv-icon",
  html: `
    <svg width="42" height="42" viewBox="0 0 42 42">
      <circle cx="21" cy="21" r="9" stroke="#00ffff" stroke-width="2" fill="none"/>
      <line x1="10" y1="21" x2="32" y2="21" stroke="#00ffff" stroke-width="2"/>
      <line x1="15" y1="26" x2="21" y2="32" stroke="#00ffff" stroke-width="2"/>
      <line x1="27" y1="26" x2="21" y2="32" stroke="#00ffff" stroke-width="2"/>
    </svg>
  `,
  iconSize: [42, 42],
  iconAnchor: [21, 21]
});

// ===============================================================
// API Publique (FIDS & Radar Interaction)
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
// FPV Airbus (Flight Path Vector)
// ===============================================================
export function updateFPV(hex) {
  const plane = planeIndex[hex];
  if (!plane) return;

  const p = plane.options.data;
  if (!p) return;

  // Track sol réel (TRK) servant d'orientation au vecteur FPV
  const hdg = p.heading || p.true_heading || p.mag_heading || p.track || 0;
  const trk = p.track ?? hdg;
  const fpvHeading = ((trk % 360) + 360) % 360;

  const { lat, lon } = p;

  if (!fpvMarker) {
    fpvMarker = L.marker([lat, lon], {
      icon: fpvIcon,
      rotationAngle: fpvHeading,
      rotationOrigin: "center center"
    }).addTo(map);
  } else {
    fpvMarker.setLatLng([lat, lon]);
    if (typeof fpvMarker.setRotationAngle === "function") {
      fpvMarker.setRotationAngle(fpvHeading);
    }
  }
}

// ===============================================================
// METEO (METAR + Open-Meteo via Worker)
// ===============================================================
async function fetchMeteo(apt) {
  try {
    const res = await fetch(
      `${WORKER_BASE_URL}/api/meteo?apt=${apt}`,
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

setInterval(() => {
  fetchMeteo("EBLG");
  fetchMeteo("EBCI");
}, 60000);

// ===============================================================
// Décodage METAR
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
      windDir = parseInt(p.slice(0, 3), 10);
      windSpd = parseInt(p.slice(3, 5), 10);
    }
    if (p.startsWith("Q")) qnh = p.slice(1);
    if (p.startsWith("BECMG")) trend = "BECMG";
    if (p.startsWith("TEMPO")) trend = "TEMPO";
    if (p.startsWith("NOSIG")) trend = "NOSIG";
  }

  return { windDir, windSpd, qnh, trend };
}

// ===============================================================
// Rose des vents METAR
// ===============================================================
function updateWindRose() {
  if (!metarData) return;

  const deg = typeof metarData.windDir === "number" ? metarData.windDir : 0;
  const spd = typeof metarData.windSpd === "number" ? metarData.windSpd : 0;

  const rose  = document.getElementById("nd-wind-rose");
  const arrow = document.getElementById("nd-wind-arrow");
  const label = document.getElementById("nd-wind-label");

  if (!rose || !arrow || !label) return;

  const degStr = String(deg).padStart(3, "0");

  rose.style.transform  = `rotate(${deg}deg)`;
  arrow.style.transform = `rotate(${deg}deg) translate(0, -12px)`;
  label.textContent     = `${degStr}° / ${spd} kt`;
}

// ===============================================================
// WX Radar Simulation
// ===============================================================
function updateWxRadar() {
  if (!wxData) return;

  const wind = wxData.wind?.speed || 0;
  const radar = document.getElementById("nd-wx-radar");
  if (!radar) return;

  radar.style.background =
    wind > 50 ? "rgba(239,68,68,0.45)" :
    wind > 35 ? "rgba(249,115,22,0.4)" :
    wind > 20 ? "rgba(234,179,8,0.35)" :
                "rgba(34,197,94,0.2)";
}

// ===============================================================
// ND Panel — HDG / TRK / GS / TAS / WIND / QNH / WINDCOMP
// ===============================================================
function updateNdPanel() {
  if (!selectedHex) return;

  const plane = planeIndex[selectedHex];
  if (!plane) return;

  const p = plane.options.data;
  if (!p) return;

  // Cap et Trajectoire
  const hdg = p.heading || p.true_heading || p.mag_heading || p.track || 0;
  const trk = p.track ?? hdg;

  const hdgNorm = String(Math.round(((hdg % 360) + 360) % 360)).padStart(3, "0");
  const trkNorm = String(Math.round(((trk % 360) + 360) % 360)).padStart(3, "0");

  // GS / TAS en Nœuds
  const gsKt = Math.round(
    p.gs || (p.speed_ms ? p.speed_ms * 1.94384 : 0)
  );
  const tasKt = Math.round(gsKt * 1.05);

  // Météo vent
  let windDir = "---";
  let windSpd = "---";

  if (wxData?.wind) {
    windDir = Math.round(wxData.wind.deg || 0);
    windSpd = Math.round((wxData.wind.speed || 0) / 1.852); // km/h -> kts
  } else if (metarData) {
    windDir = metarData.windDir;
    windSpd = metarData.windSpd;
  }

  // WINDCOMP Airbus
  let windCompText = "---";

  if (typeof windDir === "number" && typeof windSpd === "number") {
    const angle = ((windDir - Number(trkNorm) + 540) % 360) - 180;
    const rad = angle * Math.PI / 180;

    const head = Math.round(windSpd * Math.cos(rad));
    const cross = Math.round(windSpd * Math.sin(rad));

    const headLabel  = head >= 0 ? "H" : "T";
    const crossLabel = cross >= 0 ? "R" : "L";

    windCompText = `${headLabel} ${Math.abs(head)} / ${crossLabel} ${Math.abs(cross)} kt`;
  }

  // Écriture UI
  const elHdg      = document.getElementById("nd-hdg");
  const elTrk      = document.getElementById("nd-trk");
  const elGs       = document.getElementById("nd-gs");
  const elTas      = document.getElementById("nd-tas");
  const elWind     = document.getElementById("nd-wind");
  const elWindComp = document.getElementById("nd-windcomp");
  const elQnh      = document.getElementById("nd-qnh");
  const elTrend    = document.getElementById("nd-trend");

  if (elHdg)      elHdg.innerText      = hdgNorm;
  if (elTrk)      elTrk.innerText      = trkNorm;
  if (elGs)       elGs.innerText       = `${gsKt} kt`;
  if (elTas)      elTas.innerText      = `${tasKt} kt`;
  if (elWind)     elWind.innerText     = `${String(windDir).padStart(3, "0")}° / ${windSpd} kt`;
  if (elWindComp) elWindComp.innerText = windCompText;

  if (metarData) {
    if (elQnh)   elQnh.innerText   = `${metarData.qnh} hPa`;
    if (elTrend) elTrend.innerText = metarData.trend || "";
  }
}

// ===============================================================
// Synchronisation Boussole UI
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

  let runwayHeading = 0;
  if (prefix === "ebci") runwayHeading = windDeg > 180 ? 240 : 60;
  if (prefix === "eblg") runwayHeading = windDeg > 180 ? 220 : 40;

  loc.style.transform = `rotate(${runwayHeading}deg)`;
  gp.style.transform  = `rotate(${runwayHeading}deg)`;

  const degStr = String(Math.round(windDeg)).padStart(3, "0");
  label.textContent = `${degStr}° / ${Math.round(windSpeedKmh)} km/h`;
}

// ===============================================================
// Boucle de rafraîchissement ND (1 Hz)
// ===============================================================
setInterval(() => {
  if (!selectedHex) return;
  updateNdPanel();
  updateFPV(selectedHex);
  updateWindRose();
  updateWxRadar();
}, 1000);
