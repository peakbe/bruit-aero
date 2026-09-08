// ===============================================================
// nd-utils.js — Fonctions ND Airbus PRO+++
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

  ctx.strokeStyle = "#38bdf8"; // cyan Airbus
  ctx.lineWidth = 2;
  ctx.beginPath();

  values.forEach((v, i) => {
    const x = (i / (values.length - 1)) * canvas.width;
    const y = canvas.height - ((v - min) / range) * canvas.height;

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();
}

// ND — statut sonomètres
export function updateNdSonometersStatus(sonometersEnabled, sonoLayer) {
  const el = document.getElementById("nd-sono");
  if (!el) return;

  if (!sonometersEnabled) {
    el.textContent = "OFF";
    el.style.color = "#fbbf24"; // amber Airbus
    return;
  }

  const count = sonoLayer.getLayers().length;
  el.textContent = `${count}`;
  el.style.color = "#38bdf8"; // cyan Airbus
}

// ND — composantes vent
export function updateNdWindComponents(airport, metarEBLG, metarEBCI, lastWindSpeedEBLG, lastWindSpeedEBCI, RUNWAY_HEADINGS) {
  const el = document.getElementById("nd-windcomp");
  if (!el) return;

  const windDeg = airport === "EBLG"
    ? metarEBLG?.windDeg
    : metarEBCI?.windDeg;

  if (!windDeg) {
    el.textContent = "---";
    el.style.color = "#fbbf24";
    return;
  }

  const runway = airport === "EBLG"
    ? (windDeg > 180 ? "22" : "04")
    : (windDeg > 180 ? "24" : "06");

  const runwayHeading = RUNWAY_HEADINGS[airport][runway];

  const diff = windDeg - runwayHeading;
  const angle = ((diff + 540) % 360) - 180;

  const windSpeedMs = airport === "EBLG"
    ? lastWindSpeedEBLG ?? 0
    : lastWindSpeedEBCI ?? 0;

  const windSpeedKt = Math.round(windSpeedMs * 1.94384);

  const headwind = Math.round(windSpeedKt * Math.cos(angle * Math.PI / 180));
  const crosswind = Math.round(windSpeedKt * Math.sin(angle * Math.PI / 180));

  const cwDir = crosswind > 0 ? "→" : "←";

  el.textContent = `${headwind} kt / ${Math.abs(crosswind)} kt ${cwDir}`;
  el.style.color = "#38bdf8";
}
