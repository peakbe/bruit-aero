// ===============================================================
// ND Airbus — Panneau HDG / TRK / GS / TAS / WIND + METAR + ICON + WIND VECTOR
// ===============================================================

import { planeIndex } from "./map.js";
import { updateFPV } from "./nd.js";

let selectedHex = null;
let metarData = null;
let meteoData = null;

// ---------------------------------------------------------------
// Sélection avion depuis ND / FIDS
// ---------------------------------------------------------------
export function setSelectedAircraft(hex) {
  selectedHex = hex;
}

// ---------------------------------------------------------------
// 1. Récupération METAR (QNH + tendance + nuages)
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
// 2. Récupération METEO (vent + température + icône)
// ---------------------------------------------------------------
async function fetchMeteo(airport = "EBLG") {
  try {
    const res = await fetch(
      `https://bruit-aero-proxy.pnyr682w7f.workers.dev/api/forecast?apt=${airport}`,
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
  fetchMetar("EBLG");
  fetchMetar("EBCI");
  fetchMeteo("EBLG");
  fetchMeteo("EBCI");
}, 60000);

// ---------------------------------------------------------------
// 3. Parse METAR → QNH + tendance + nuages
// ---------------------------------------------------------------
function parseMetar(raw) {
  if (!raw) return null;

  const parts = raw.split(" ");

  let qnh = "---";
  let trend = "";
  let clouds = "";

  parts.forEach(p => {
    if (p.startsWith("Q")) qnh = p.substring(1);
    if (p.startsWith("BECMG")) trend = "BECMG";
    if (p.startsWith("TEMPO")) trend = "TEMPO";
    if (p.startsWith("SCT") || p.startsWith("BKN") || p.startsWith("OVC"))
      clouds = p;
  });

  return { qnh, trend, clouds };
}

// ---------------------------------------------------------------
// 4. Icône météo cockpit Airbus
// ---------------------------------------------------------------
function getWeatherIcon(code) {
  if (!code) return "☀️";

  if (code < 3) return "☀️";        // Clear
  if (code < 45) return "⛅";        // Clouds
  if (code < 60) return "🌧️";       // Rain
  if (code < 70) return "🌦️";       // Showers
  if (code < 80) return "❄️";        // Snow
  if (code < 95) return "🌩️";       // Thunderstorm

  return "⛅";
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

  // HDG / TRK
  const hdg = p.heading || p.true_heading || p.mag_heading || p.track || 0;
  const trk = p.track || hdg;

  const hdgNorm = Math.round(((hdg % 360) + 360) % 360);
  const trkNorm = Math.round(((trk % 360) + 360) % 360);

  // GS / TAS
  const gsKt = Math.round(p.gs || (p.speed_ms ? p.speed_ms / 0.514444 : 0));
  const tasKt = Math.round(gsKt * 1.05);

  // METEO
  let windDir = "---";
  let windSpd = "---";
  let temp = "---";
  let icon = "⛅";
  let qnh = "---";
  let trend = "";
  let clouds = "";

  if (meteoData?.list?.[0]) {
    const w = meteoData.list[0];
    windSpd = Math.round(w.wind.speed / 0.514444);
    temp = w.main.temp;
    icon = getWeatherIcon(w.weather[0].icon);
  }

  if (metarData) {
    qnh = metarData.qnh;
    trend = metarData.trend;
    clouds = metarData.clouds;
  }

  // WINDCOMP
  let windComp = "---";
  if (windSpd !== "---" && windDir !== "---") {
    const diff = Math.abs(windDir - trkNorm);
    windComp = Math.round(windSpd * Math.cos(diff * Math.PI / 180));
  }

  // Injection cockpit Airbus
  document.getElementById("nd-hdg").innerText = hdgNorm;
  document.getElementById("nd-trk").innerText = trkNorm;
  document.getElementById("nd-gs").innerText = `${gsKt} kt`;
  document.getElementById("nd-tas").innerText = `${tasKt} kt`;

  document.getElementById("nd-wind").innerText = `${windDir}° / ${windSpd} kt`;
  document.getElementById("nd-temp").innerText = `${temp}°C`;
  document.getElementById("nd-windcomp").innerText = `${windComp} kt`;

  document.getElementById("nd-qnh").innerText = `${qnh} hPa`;
  document.getElementById("nd-trend").innerText = trend || "";
  document.getElementById("nd-clouds").innerText = clouds || "";

  document.getElementById("nd-icon").innerText = icon;
}

// ---------------------------------------------------------------
// 6. WIND VECTOR animé façon Airbus
// ---------------------------------------------------------------
function updateWindVector() {
  if (!meteoData?.list?.[0]) return;

  const w = meteoData.list[0];
  const windDeg = w.wind.deg || 0;

  const vec = document.getElementById("nd-wind-vector");
  if (!vec) return;

  vec.style.transform = `rotate(${windDeg}deg) translate(0, -10px)`;
  vec.style.transition = "transform 0.8s linear";
}

// ---------------------------------------------------------------
// Mise à jour automatique ND + FPV + WIND VECTOR
// ---------------------------------------------------------------
setInterval(() => {
  if (selectedHex) {
    updateNdPanel();
    updateFPV(selectedHex);
    updateWindVector();
  }
}, 1000);
