// ===============================================================
// nd-utils.js — Fonctions ND Airbus PRO+++ (optimisées)
// ===============================================================

// ===============================================================
// 1) Sparkline vent ND — Optimisé
// ===============================================================
export function updateWindTrend(prefix, speedKmh, windTrend) {
  const apt = prefix.toUpperCase();
  const canvas = document.querySelector(`.card[data-airport="${apt}"] canvas.windtrend`);
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const arr = windTrend[apt];

  arr.push(speedKmh);
  if (arr.length > 30) arr.shift();

  const max = Math.max(...arr);
  const min = Math.min(...arr);
  const range = max - min || 1;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 2;
  ctx.beginPath();

  arr.forEach((v, i) => {
    const x = (i / (arr.length - 1)) * canvas.width;
    const y = canvas.height - ((v - min) / range) * canvas.height;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });

  ctx.stroke();
}

// ===============================================================
// 2) Statut sonomètres ND — Optimisé
// ===============================================================
import { map } from "./map.js";
import { renderSonometers, renderSonometersALLDynamic } from "./sono.js";

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

  window.currentAirport === "ALL"
    ? renderSonometersALLDynamic()
    : renderSonometers(window.currentAirport, window.activeRunway);

  el.textContent = `${sonoLayer.getLayers().length}`;
  el.style.color = "#38bdf8";
}

// ===============================================================
// 3) ND Airbus — Composantes vent PRO+++ (optimisé)
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
    ndSetWindComponents(null);
    lastNdState.airport = "ALL";
    return;
  }

  const isEBLG = airport === "EBLG";
  const metar = isEBLG ? metarEBLG : metarEBCI;

  const windDir = metar.windDeg ?? 0;
  const windSpeed = (isEBLG ? windEBLG : windEBCI) * 1.94384;

  const runway = windDir > 180
    ? (isEBLG ? "22" : "24")
    : (isEBLG ? "04" : "06");

  if (
    lastNdState.airport === airport &&
    lastNdState.windDir === windDir &&
    lastNdState.windSpeed === windSpeed &&
    lastNdState.runway === runway
  ) return;

  lastNdState = { airport, windDir, windSpeed, runway };

  const rwyHeading = RUNWAY_HEADINGS[airport][runway];

  // Formule Airbus optimisée
  const angle = ((windDir - rwyHeading + 540) % 360) - 180;
  const rad = angle * Math.PI / 180;

  const headwind = Math.round(windSpeed * Math.cos(rad));
  const crosswind = Math.round(windSpeed * Math.sin(rad));

  ndSetWindArrow(windDir);
  ndSetWindText(`${windDir}° / ${Math.round(windSpeed)} kt`);
  ndSetRunway(runway);
  ndSetWindComponents({ headwind, crosswind, angle });
}

// ===============================================================
// 4) ND Airbus — Références DOM optimisées
// ===============================================================
const ndRefs = {
  windArrow: null,
  windText: null,
  runwayText: null,
  headwindText: null,
  crosswindText: null,
  angleText: null
};

function initNdRefs() {
  ndRefs.windArrow     ||= document.getElementById("nd-wind-arrow");
  ndRefs.windText      ||= document.getElementById("nd-wind-text");
  ndRefs.runwayText    ||= document.getElementById("nd-runway-text");
  ndRefs.headwindText  ||= document.getElementById("nd-headwind");
  ndRefs.crosswindText ||= document.getElementById("nd-crosswind");
  ndRefs.angleText     ||= document.getElementById("nd-angle");
}

// ===============================================================
// 5) Setters ND — Optimisés
// ===============================================================
export function ndSetWindArrow(dirDeg) {
  initNdRefs();
  if (!ndRefs.windArrow) return;

  ndRefs.windArrow.style.transform = `rotate(${dirDeg ?? 0}deg)`;
  ndRefs.windArrow.style.opacity = dirDeg == null ? "0.2" : "1";
}

export function ndSetWindText(text) {
  initNdRefs();
  if (ndRefs.windText) ndRefs.windText.textContent = text || "—";
}

export function ndSetRunway(runway) {
  initNdRefs();
  if (ndRefs.runwayText) ndRefs.runwayText.textContent = runway ? `RWY ${runway}` : "RWY —";
}

export function ndSetWindComponents(c) {
  initNdRefs();
  if (!c) {
    ndRefs.headwindText.textContent = "—";
    ndRefs.crosswindText.textContent = "—";
    ndRefs.angleText.textContent = "—";
    return;
  }

  ndRefs.headwindText.textContent  = `${c.headwind} kt`;
  ndRefs.crosswindText.textContent = `${c.crosswind} kt`;
  ndRefs.angleText.textContent     = `${c.angle}°`;
}

// ===============================================================
// 6) Extraction direction vent METAR
// ===============================================================
export function extractWindDir(rawMetar) {
  if (!rawMetar) return 0;
  const match = rawMetar.match(/(\d{3})\d{2}KT/);
  return match ? parseInt(match[1], 10) : 0;
}
