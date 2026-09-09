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

// ===============================================================
// ND Airbus — Composantes vent PRO+++
// ===============================================================
// Cache ND pour éviter recalculs inutiles
let lastNdState = {
  airport: null,
  windDir: null,
  windSpeed: null,
  runway: null
};

export function updateNdWindComponentsOptimized(
  airport,
  metarEBLG,
  metarEBCI,
  windEBLG,
  windEBCI,
  RUNWAY_HEADINGS
) {

  // 🟦 Mode ALL → ND OFF
  if (airport === "ALL") {
    if (lastNdState.airport !== "ALL") {
      ndSetWindArrow(null);
      ndSetWindText("—");
      ndSetRunway(null);
      ndSetWindComponents(null);
      lastNdState.airport = "ALL";
    }
    return;
  }

  const isEBLG = airport === "EBLG";
  const metar = isEBLG ? metarEBLG : metarEBCI;
  const windSpeed = isEBLG ? windEBLG : windEBCI;

  if (!metar || !windSpeed) return;

  const windDir = metar.wind?.deg ?? 0;

  const runway = windDir > 180
    ? (isEBLG ? "22" : "24")
    : (isEBLG ? "04" : "06");

  // 🟦 Si rien n’a changé → on ne fait rien
  if (
    lastNdState.airport === airport &&
    lastNdState.windDir === windDir &&
    lastNdState.windSpeed === windSpeed &&
    lastNdState.runway === runway
  ) {
    return; // 🟩 ND déjà à jour
  }

  // 🟦 Mise à jour cache
  lastNdState = { airport, windDir, windSpeed, runway };

  // 🟦 Calcul composantes vent
  const rwyHeading = RUNWAY_HEADINGS[airport][runway];
  const angle = windDir - rwyHeading;
  const rad = angle * Math.PI / 180;

  const headwind = Math.round(windSpeed * Math.cos(rad));
  const crosswind = Math.round(windSpeed * Math.sin(rad));

  // 🟦 Mise à jour ND Airbus
  ndSetWindArrow(windDir);
  ndSetWindText(`${windDir}° / ${windSpeed} kt`);
  ndSetRunway(runway);
  ndSetWindComponents({ headwind, crosswind, angle });
}


