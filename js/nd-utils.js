// ===============================================================
// nd-utils.js — ND Airbus PRO+++ (version WINDCOMP unique)
// ===============================================================

// Sparkline vent ND
export function updateWindTrend(prefix, speedKmh, windTrend) {
  const canvas = document.querySelector(
    `.card[data-airport="${prefix.toUpperCase()}"] canvas.windtrend`
  );
  if (!canvas) return;

  const ctx = canvas.getContext("2d");

  windTrend[prefix.toUpperCase()].push(speedKmh);
  if (windTrend[prefix.toUpperCase()].length > 30)
    windTrend[prefix.toUpperCase()].shift();

  const values = windTrend[prefix.toUpperCase()];
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
// ND — statut sonomètres
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
// ND Airbus — Composantes vent PRO+++
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
  ) {
    return;
  }

  lastNdState = { airport, windDir, windSpeed, runway };

  const rwyHeading = RUNWAY_HEADINGS[airport][runway];
  const angle = windDir - rwyHeading;
  const rad = angle * Math.PI / 180;

  const headwind = Math.round(windSpeed * Math.cos(rad));
  const crosswind = Math.round(windSpeed * Math.sin(rad));

  ndSetWindArrow(windDir);
  ndSetWindText(`${windDir}° / ${Math.round(windSpeed)} kt`);
  ndSetRunway(runway);

  const headLabel  = headwind >= 0 ? "H" : "T";
  const crossLabel = crosswind >= 0 ? "R" : "L";

  ndSetWindCompText(`${headLabel} ${Math.abs(headwind)} kt / ${crossLabel} ${Math.abs(crosswind)} kt / ${angle}°`);
}

// ===============================================================
// ND Airbus — helpers DOM PRO+++
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

// ---------------------------------------------------------------
// Flèche vent
// ---------------------------------------------------------------
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

// ---------------------------------------------------------------
// Texte vent
// ---------------------------------------------------------------
export function ndSetWindText(text) {
  initNdRefs();
  if (!ndRefs.windText) return;
  ndRefs.windText.textContent = text || "—";
}

// ---------------------------------------------------------------
// Piste active
// ---------------------------------------------------------------
export function ndSetRunway(runway) {
  initNdRefs();
  if (!ndRefs.runwayText) return;
  ndRefs.runwayText.textContent = runway ? `RWY ${runway}` : "RWY —";
}

// ---------------------------------------------------------------
// WINDCOMP unique (headwind + crosswind + angle)
// ---------------------------------------------------------------
export function ndSetWindCompText(text) {
  initNdRefs();
  if (!ndRefs.windCompText) return;
  ndRefs.windCompText.textContent = text || "—";
}

// Extraction direction vent METAR
function extractWindDir(rawMetar) {
  if (!rawMetar) return 0;
  const match = rawMetar.match(/(\d{3})\d{2}KT/);
  return match ? parseInt(match[1], 10) : 0;
}
