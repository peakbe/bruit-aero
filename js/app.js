// ===============================================================
// IMPORTS MODULES
// ===============================================================
import { map, initRadarMap, drawApproachDepartureCones } from "./map.js";
import { updateFIDS } from "./fids.js";
import { renderSonometers, renderSonometersALLDynamic, sonoLayer, getAirportWind } from "./sono.js";
import {
  updateWindTrend,
  updateNdWindComponents,
  updateNdSonometersStatus
} from "./nd-utils.js";
import { updateCompassUI } from "./nd.js";
import {
  WORKER_BASE_URL,
  AIRPORT_COORDS,
  RUNWAY_HEADINGS,
  RADAR_REFRESH_MS,
  METAR_REFRESH_MS,
  WEATHER_REFRESH_MS
} from "./config.js";

// ===============================================================
// ÉTAT GLOBAL CENTRALISÉ
// ===============================================================
const state = {
  currentAirport: "EBLG",
  sonometersEnabled: true,
  activeRunway: null,
  windTrend: { EBLG: [], EBCI: [] },
  metar: {
    EBLG: { windDeg: 0, speedMs: 0 },
    EBCI: { windDeg: 0, speedMs: 0 }
  }
};

// Export pour synchronisation avec les modules ND / UI
window.appState = state;
window.currentAirport = state.currentAirport;
window.activeRunway = state.activeRunway;

// ===============================================================
// INITIALISATION
// ===============================================================
document.addEventListener("DOMContentLoaded", async () => {
  initRadarMap();

  // Démarrage des rafraîchissements FIDS
  updateFIDS();
  setInterval(updateFIDS, RADAR_REFRESH_MS);

  // Charger les données initiales
  await fetchWeatherData();
  updateRunwaySonometers();
  syncNdWindUI();

  // Planification des tâches récurrentes
  setInterval(fetchWeatherData, WEATHER_REFRESH_MS);
  setInterval(fetchMetarData, METAR_REFRESH_MS);

  setupSonometersToggle();
  setupRecenterButton();
});

window.addEventListener("load", () => {
  setTimeout(() => map?.invalidateSize(), 150);
});

// ===============================================================
// FONCTIONS UTILITAIRES DE SYNCHRONISATION
// ===============================================================
function syncNdWindUI() {
  const apt = state.currentAirport;

  // Vent SONO (km/h)
  const windSono = getAirportWind(apt);   // { speed: km/h, deg }

  // Vent METAR (kt)
  const windMetar = state.metar[apt];     // { windDir, windSpd }

  // Fusion simple : SONO si dispo, sinon METAR
  let dir = 0;
  let spdKt = 0;

  if (windSono && windSono.speed > 0) {
    dir = windSono.deg;
    spdKt = windSono.speed / 1.852;   // km/h → kt
  } else if (windMetar) {
    dir = windMetar.windDir;
    spdKt = windMetar.windSpd;        // déjà en kt
  }

  // Appel ND Airbus PRO+++
  updateNdWindComponents(
    apt,
    { windDeg: dir, windSpdKt: spdKt },   // metarEBLG (mock)
    { windDeg: dir, windSpdKt: spdKt },   // metarEBCI (mock)
    spdKt,                                // windEBLG
    spdKt,                                // windEBCI
    RUNWAY_HEADINGS
  );
}


// ===============================================================
// METAR (FALLBACK)
// ===============================================================
async function fetchMetarData() {
  const airports = ["EBCI", "EBLG"];
  
  await Promise.all(airports.map(async (apt) => {
    const el = document.getElementById(`${apt.toLowerCase()}-metar`);
    if (!el) return;

    try {
      const res = await fetch(`https://metar.vatsim.net/${apt}`);
      el.innerText = res.ok ? (await res.text()).trim() : "METAR indisponible";
    } catch {
      el.innerText = "METAR indisponible";
    }
  }));
}

// ===============================================================
// MÉTÉO FUSIONNÉE (WORKER CLOUDFLARE)
// ===============================================================
async function fetchWeatherData() {
  const airports = ["EBCI", "EBLG"];

  await Promise.all(airports.map(async (apt) => {
    try {
      const res = await fetch(`${WORKER_BASE_URL}/api/meteo?apt=${apt}`);
      if (!res.ok) return;

      const data = await res.json();

      updateMetarUI(apt, data.metar);

      if (!data.meteo) return;

      const temp = Math.round(data.meteo.main?.temp ?? 0);
      const windSpeedKmh = data.meteo.wind?.speed ?? 0;
      const windDeg = data.meteo.wind?.deg ?? 0;

      const prefix = apt.toLowerCase();

      document.getElementById(`${prefix}-temp`).textContent = `${temp}°C`;
      document.getElementById(`${prefix}-wind`).textContent = `Vent: ${windSpeedKmh} km/h (${windDeg}°)`;

      state.metar[apt] = {
        windDeg,
        speedMs: windSpeedKmh / 3.6
      };

      updateWindTrend(prefix, windSpeedKmh, state.windTrend);
      updateCompassUI(prefix, windDeg, windSpeedKmh);

      autoSelectRunway(apt, windDeg, windSpeedKmh / 3.6);

      if (AIRPORT_COORDS[apt]) {
        drawApproachDepartureCones(apt, AIRPORT_COORDS[apt].lat, AIRPORT_COORDS[apt].lon, windDeg);
      }
    } catch (e) {
      console.error(`Erreur météo ${apt} :`, e);
    }
  }));

  syncNdWindUI();
  updateRunwaySonometers();
}

function updateMetarUI(apt, metarRaw) {
  const el = document.getElementById(`${apt.toLowerCase()}-metar`);
  if (!el) return;

  el.textContent = metarRaw;

  // Détection tendance METAR
  let trend = "";
  if (metarRaw.includes("BECMG")) trend = "BECMG";
  if (metarRaw.includes("TEMPO")) trend = "TEMPO";
  if (metarRaw.includes("NOSIG")) trend = "NOSIG";

  const trendEl = document.getElementById(`${apt.toLowerCase()}-metar-trend`);
  if (trendEl) trendEl.textContent = trend;
}

// ===============================================================
// AUTO-SÉLECTION DE PISTE
// ===============================================================
function autoSelectRunway(airport, windDeg, windSpeedMs) {
  const RWYS = airport === "EBLG"
    ? [{ num: "22", heading: 220 }, { num: "04", heading: 40 }]
    : [{ num: "24", heading: 240 }, { num: "06", heading: 60 }];

  let best = RWYS[0];
  let bestHeadwind = -999;

  RWYS.forEach(rwy => {
    const angle = Math.abs(((windDeg - rwy.heading + 540) % 360) - 180);
const headwind = windSpeedMs * Math.cos(angle * Math.PI / 180);

    if (headwind > bestHeadwind) {
      bestHeadwind = headwind;
      best = rwy;
    }
  });

  const el = document.getElementById(`${airport.toLowerCase()}-runway`);
  if (el) el.textContent = `Piste ${best.num}`;
}

// ===============================================================
// SONOMÈTRES
// ===============================================================
function updateRunwaySonometers() {
  if (!state.sonometersEnabled) {
    if (map.hasLayer(sonoLayer)) map.removeLayer(sonoLayer);
    updateNdSonometersStatus(false, sonoLayer);
    return;
  }

  if (!map.hasLayer(sonoLayer)) map.addLayer(sonoLayer);

  const rwyEBLG = state.metar.EBLG.windDeg > 180 ? "22" : "04";
  const rwyEBCI = state.metar.EBCI.windDeg > 180 ? "24" : "06";

  state.activeRunway = state.currentAirport === "EBLG" ? rwyEBLG : rwyEBCI;
  window.activeRunway = state.activeRunway;

  renderSonometers("EBLG", rwyEBLG);
renderSonometers("EBCI", rwyEBCI);

  updateNdSonometersStatus(true, sonoLayer);
}

// ===============================================================
// FILTRE AÉROPORT
// ===============================================================
window.filterAirportView = function (airport) {
  state.currentAirport = airport;
  window.currentAirport = airport;

  if (airport === "ALL") {
    renderSonometersALLDynamic();
    const target = AIRPORT_COORDS.ALL;
    map.setView([target.lat, target.lon], 8, { animate: true });
  } else {
    syncNdWindUI();
    if (state.sonometersEnabled) updateRunwaySonometers();

    const target = AIRPORT_COORDS[airport];
    if (target) map.setView([target.lat, target.lon], 11, { animate: true });
  }

  updateNdSonometersStatus(state.sonometersEnabled, sonoLayer);
updateControlBarButtons(airport);
syncNdWindUI();

};

// ===============================================================
// TOGGLE SONOMÈTRES
// ===============================================================
function setupSonometersToggle() {
  const bar = document.querySelector(".control-bar-inline");
  if (!bar) return;

  const btn = document.createElement("button");
  btn.className = "airport-icon-btn active";
  btn.style.marginLeft = "10px";
  btn.innerHTML = "🎧 Sonomètres";

  btn.onclick = () => {
    state.sonometersEnabled = !state.sonometersEnabled;
    btn.classList.toggle("active", state.sonometersEnabled);

    if (state.sonometersEnabled) {
      if (!map.hasLayer(sonoLayer)) map.addLayer(sonoLayer);
      state.currentAirport === "ALL" ? renderSonometersALLDynamic() : updateRunwaySonometers();
    } else {
      if (map.hasLayer(sonoLayer)) map.removeLayer(sonoLayer);
    }

    updateNdSonometersStatus(state.sonometersEnabled, sonoLayer);
    syncNdWindUI();
  };

  bar.appendChild(btn);
}

// ===============================================================
// RECENTER
// ===============================================================
function setupRecenterButton() {
  const btn = document.getElementById("btn-recenter");
  if (!btn) return;

  btn.onclick = () => {
    const target = AIRPORT_COORDS[state.currentAirport] || AIRPORT_COORDS.ALL;
    const zoom = state.currentAirport === "ALL" ? 8 : 11;
    map.setView([target.lat, target.lon], zoom, { animate: true });
  };
}

// ===============================================================
// EXPORTS
// ===============================================================
export {
  fetchWeatherData,
  fetchMetarData,
  autoSelectRunway,
  state
};
