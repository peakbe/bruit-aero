// ===============================================================
// IMPORTS MODULES
// ===============================================================
import { map, initRadarMap } from "./map.js";
import { updateFIDS } from "./fids.js";
import { renderSonometers, sonoLayer } from "./sono.js";

// ===============================================================
// GLOBAL STATE
// ===============================================================
let currentAirport = "EBLG";
let sonometersEnabled = true;   // ← toggle ON/OFF sonomètres

const WORKER_BASE_URL = "https://bruit-aero-proxy.pnyr682w7f.workers.dev";

const AIRPORTS = {
  EBLG: { lat: 50.6374, lon: 5.4432 },
  EBCI: { lat: 50.4592, lon: 4.4538 }
};

const AIRPORT_COORDS = {
  EBCI: [50.4592, 4.4538],
  EBLG: [50.6374, 5.4432],
  ALL:  [50.55, 4.95]
};

// ===============================================================
// INITIALISATION
// ===============================================================
document.addEventListener("DOMContentLoaded", () => {

    initRadarMap();
    updateFIDS();
    setInterval(updateFIDS, 30000);

    fetchMetarData();
    fetchWeatherData().then(() => updateRunwaySonometers());

    setInterval(fetchMetarData, 300000);
    setInterval(async () => {
        await fetchWeatherData();
        updateRunwaySonometers();
    }, 300000);

    setupSonometersToggle();   // ← activation du toggle
    setupRecenterButton(); // recentrer carte
});

// ===============================================================
// UTILS
// ===============================================================
function msToKmh(ms) {
  return Math.round(ms * 3.6);
}

// ===============================================================
// METAR VATSIM
// ===============================================================
async function fetchMetarData() {
  const airports = ["EBCI", "EBLG"];

  for (const icao of airports) {
    const el = document.getElementById(`${icao.toLowerCase()}-metar`);
    if (!el) continue;

    try {
      const res = await fetch(`https://metar.vatsim.net/${icao}`);
      el.innerText = res.ok ? (await res.text()).trim() : "Erreur METAR";
    } catch {
      el.innerText = "METAR indisponible";
    }
  }
}

// ===============================================================
// SONOMÈTRES — version PRO+++
// ===============================================================
function updateRunwaySonometers() {

    if (!sonometersEnabled) {
        sonoLayer.clearLayers();
        updateNdSonometersStatus();
        updateNdWindComponents(currentAirport);
        return;
    }

    // EBLG
    const windEBLG = window.metarEBLG?.windDeg ?? 220;
    const rwyEBLG = windEBLG > 180 ? "22" : "04";

    // EBCI
    const windEBCI = window.metarEBCI?.windDeg ?? 240;
    const rwyEBCI = windEBCI > 180 ? "24" : "06";

    renderSonometers("EBLG", rwyEBLG, { reset: true });
    renderSonometers("EBCI", rwyEBCI);

    updateNdSonometersStatus();
    updateNdWindComponents(currentAirport);   // ← nouveau panneau ND
}


function updateNdSonometersStatus() {
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

// Fonction PRO+++ de calcul des composantes vent
function updateNdWindComponents(airport) {
    const el = document.getElementById("nd-windcomp");
    if (!el) return;

    const windDeg = airport === "EBLG"
        ? window.metarEBLG?.windDeg
        : window.metarEBCI?.windDeg;

    if (!windDeg) {
        el.textContent = "---";
        el.style.color = "#fbbf24"; // amber
        return;
    }

    const runway = airport === "EBLG"
        ? (windDeg > 180 ? 22 : 4)
        : (windDeg > 180 ? 24 : 6);

    const runwayHeading = runway * 10; // 22 → 220°, 04 → 40°, etc.

    const diff = windDeg - runwayHeading;
    const angle = ((diff + 540) % 360) - 180;

    const windSpeedMs = airport === "EBLG"
        ? window.lastWindSpeedEBLG ?? 0
        : window.lastWindSpeedEBCI ?? 0;

    const windSpeedKt = Math.round(windSpeedMs * 1.94384);

    const headwind = Math.round(windSpeedKt * Math.cos(angle * Math.PI / 180));
    const crosswind = Math.round(windSpeedKt * Math.sin(angle * Math.PI / 180));

    const cwDir = crosswind > 0 ? "→" : "←";

    el.textContent = `${headwind} kt / ${Math.abs(crosswind)} kt ${cwDir}`;
    el.style.color = "#38bdf8"; // cyan Airbus
}

// ===============================================================
// AUTO-SELECTION PISTE
// ===============================================================
function autoSelectRunway(airport, windDeg, windSpeed) {
  const RWYS = airport === "EBLG"
    ? [{ num: "22", heading: 220 }, { num: "04", heading: 40 }]
    : [{ num: "24", heading: 240 }, { num: "06", heading: 60 }];

  let best = RWYS[0];
  let bestHeadwind = -999;

  RWYS.forEach(rwy => {
    const diff = Math.abs(windDeg - rwy.heading);
    const angle = diff > 180 ? 360 - diff : diff;
    const headwind = windSpeed * Math.cos(angle * Math.PI / 180);
    if (headwind > bestHeadwind) {
      bestHeadwind = headwind;
      best = rwy;
    }
  });

  const el = document.getElementById(
    airport === "EBLG" ? "eblg-runway" : "ebci-runway"
  );
  if (el) el.textContent = `Piste ${best.num}`;
}

// ===============================================================
// METEO + CÔNES ILS
// ===============================================================
const RUNWAY_HEADINGS = { EBLG: 220, EBCI: 60 };
let conePolygons = {};

async function fetchWeatherData() {
  for (const [code, apt] of Object.entries(AIRPORTS)) {
    try {
      const res = await fetch(`${WORKER_BASE_URL}/api/weather?lat=${apt.lat}&lon=${apt.lon}`);
      if (!res.ok) continue;

      const weather = await res.json();
      const temp = Math.round(weather.main?.temp ?? 0);
      const windSpeedMs = weather.wind?.speed ?? 0;
      const windSpeedKmh = msToKmh(windSpeedMs);
      const windSpeedKt = Math.round(windSpeedMs * 1.94384);
      const windDeg = weather.wind?.deg ?? 0;

      // Stockage global pour sonomètres
      if (code === "EBLG") window.metarEBLG = { windDeg };
      if (code === "EBCI") window.metarEBCI = { windDeg };

      // Stockage du vent
      if (code === "EBLG") window.lastWindSpeedEBLG = windSpeedMs;
      if (code === "EBCI") window.lastWindSpeedEBCI = windSpeedMs;

      autoSelectRunway(code, windDeg, windSpeedMs);

      const prefix = code.toLowerCase();
      document.getElementById(`${prefix}-temp`).textContent = `${temp}°C`;
      document.getElementById(`${prefix}-wind`).textContent =
        `Vent: ${windSpeedKmh} km/h (${windDeg}°)`;

      updateCompassUI(prefix, windDeg, windSpeedKmh, windSpeedKt);
      drawApproachDepartureCones(code, apt.lat, apt.lon, windDeg);

      fetchSingleMetar(code);
      fetchWeatherForecast(code, apt.lat, apt.lon);

    } catch (e) {
      console.error(`Erreur météo ${code} :`, e);
    }
  }
}

// ===============================================================
// TOGGLE SONOMÈTRES — cockpit Airbus PRO+++
// ===============================================================
function setupSonometersToggle() {
    const bar = document.querySelector(".control-bar-inline");

    const btn = document.createElement("button");
    btn.className = "airport-icon-btn";
    btn.style.marginLeft = "10px";
    btn.innerHTML = "🎧 Sonomètres";

    btn.onclick = () => {
        sonometersEnabled = !sonometersEnabled;

        if (sonometersEnabled) {
            btn.classList.add("active");
            updateRunwaySonometers();   // ← recharge les sonomètres
            updateNdSonometersStatus(); // ← mise à jour ND SONO
            updateNdWindComponents(currentAirport);

        } else {
            btn.classList.remove("active");
            sonoLayer.clearLayers();    // ← supprime les sonomètres
            updateNdSonometersStatus(); // ← ND SONO = OFF
            updateNdWindComponents(currentAirport);

        }
    };

    bar.appendChild(btn);
}

function setupRecenterButton() {
    const btn = document.getElementById("btn-recenter");
    if (!btn) return;

    btn.onclick = () => {
        let target = AIRPORT_COORDS[currentAirport] || AIRPORT_COORDS.ALL;
        let zoom = currentAirport === "ALL" ? 8 : 11;

        map.setView(target, zoom, { animate: true });
    };
}

// ===============================================================
// EXPORTS
// ===============================================================
export {
  fetchWeatherData,
  fetchMetarData,
  autoSelectRunway
};
