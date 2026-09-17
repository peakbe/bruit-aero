// ===============================================================
// nd-utils.js — ND Airbus PRO+++ (version WINDCOMP unique)
// ===============================================================

import { map } from "./map.js";
import { renderSonometers, renderSonometersALLDynamic } from "./sono.js";

// Sparkline de tendance du vent sur le ND
export function updateWindTrend(prefix, speedKmh, windTrend) {
  const canvas = document.querySelector(
    `.card[data-airport="${prefix.toUpperCase()}"] canvas.windtrend`
  );
  if (!canvas) return;

  const ctx = canvas.getContext("2d");

  const key = prefix.toUpperCase();
  if (!windTrend[key]) windTrend[key] = [];

  windTrend[key].push(speedKmh);
  if (windTrend[key].length > 30) {
    windTrend[key].shift();
  }

  const values = windTrend[key];
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 2;
  ctx.beginPath();

  values.forEach((v, i) => {
    const x = (i / (values.length - 1)) * canvas.width;
    const y = canvas.height - ((v - min) / range) * canvas.height;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });

  ctx.stroke();
}

// ===============================================================
// ND — Statut des sonomètres
// ===============================================================
export function updateNdSonometersStatus(enabled, sonoLayer) {
  const el = document.getElementById("nd-sono");
  if (!el) return;

  if (!enabled) {
    el.textContent = "OFF";
    el.style.color = "#fbbf24";
    if (map.hasLayer(sonoLayer)) map.removeLayer(sonoLayer);
    return;
  }

  if (!map.hasLayer(sonoLayer)) map.addLayer(sonoLayer);

  if (window.currentAirport === "ALL") {
    renderSonometersALLDynamic();
  } else {
    renderSonometers(window.currentAirport, window.activeRunway);
  }

  const count = sonoLayer.getLayers().length;
  el.textContent = `${count}`;
  el.style.color = "#38bdf8";
}

// ===============================================================
// ND Airbus — Composantes du vent PRO+++ (Headwind / Crosswind)
// ===============================================================

let lastNdState = {
  airport: null,
  windDir: null,
  windSpeed: null,
  runway: null
};

export function updateNdWindComponents(
  airport,
  metarEBLG,
  metarEBCI,
  windEBLG,
  windEBCI,
  RUNWAY_HEADINGS
) {

  if (airport === "ALL") {
    ndSetWindArrow(null);
    ndSetWindText("—");
    ndSetRunway(null);
    ndSetWindCompText("—");
    lastNdState.airport = "ALL";
    return;
  }

  const isEBLG = airport === "EBLG";
  const metar = isEBLG ? metarEBLG : metarEBCI;

  const windDir = metar?.windDeg ?? extractWindDir(metar?.rawMetar) ?? 0;
  
  // Vitesse brute (km/h) convertie en Nœuds (kt) -> / 1.852
  const rawKmh = isEBLG ? windEBLG : windEBCI;
  const windSpeed = Math.round((rawKmh || 0) / 1.852);

  const runway = windDir > 180
    ? (isEBLG ? "22" : "24")
    : (isEBLG ? "04" : "06");

  if (
    lastNdState.airport === airport &&
    lastNdState.windDir === windDir &&
    lastNdState.windSpeed === windSpeed &&
    lastNdState.runway === runway
  ) {
    return;
  }

  lastNdState = { airport, windDir, windSpeed, runway };

  const rwyHeading = RUNWAY_HEADINGS[airport][runway];
  
  // Angle relatif Vent / Piste normalisé entre -180° et +180°
  let angle = ((windDir - rwyHeading + 540) % 360) - 180;
  const rad = angle * Math.PI / 180;

  const headwind = Math.round(windSpeed * Math.cos(rad));
  const crosswind = Math.round(windSpeed * Math.sin(rad));

  ndSetWindArrow(windDir);
  ndSetWindText(`${String(windDir).padStart(3, "0")}° / ${windSpeed} kt`);
  ndSetRunway(runway);

  // Designations Airbus (H = Headwind, T = Tailwind / R = Right, L = Left)
  const headLabel  = headwind >= 0 ? "H" : "T";
  const crossLabel = crosswind >= 0 ? "R" : "L";

  ndSetWindCompText(
    `${headLabel} ${Math.abs(headwind)} kt / ${crossLabel} ${Math.abs(crosswind)} kt / ${Math.abs(angle)}°`
  );
}

// ===============================================================
// ND Airbus — Helpers DOM
// ===============================================================

const ndRefs = {
  windArrow: null,
  windText: null,
  runwayText: null,
  windCompText: null
};

function initNdRefs() {
  if (!ndRefs.windArrow)    ndRefs.windArrow    = document.getElementById("nd-wind-arrow");
  if (!ndRefs.windText)     ndRefs.windText     = document.getElementById("nd-wind-text");
  if (!ndRefs.runwayText)   ndRefs.runwayText   = document.getElementById("nd-runway-text");
  if (!ndRefs.windCompText) ndRefs.windCompText = document.getElementById("nd-windcomp");
}

export function ndSetWindArrow(dirDeg) {
  initNdRefs();
  if (!ndRefs.windArrow) return;

  if (dirDeg == null) {
    ndRefs.windArrow.style.transform = "rotate(0deg)";
    ndRefs.windArrow.style.opacity = "0.2";
    return;
  }

  ndRefs.windArrow.style.transform = `rotate(${dirDeg}deg)`;
  ndRefs.windArrow.style.opacity = "1";
}

export function ndSetWindText(text) {
  initNdRefs();
  if (!ndRefs.windText) return;
  ndRefs.windText.textContent = text || "—";
}

export function ndSetRunway(runway) {
  initNdRefs();
  if (!ndRefs.runwayText) return;
  ndRefs.runwayText.textContent = runway ? `RWY ${runway}` : "RWY —";
}

export function ndSetWindCompText(text) {
  initNdRefs();
  if (!ndRefs.windCompText) return;
  ndRefs.windCompText.textContent = text || "—";
}

function extractWindDir(rawMetar) {
  if (!rawMetar) return 0;
  const match = rawMetar.match(/(\d{3})\d{2}KT/);
  return match ? parseInt(match[1], 10) : 0;
}
