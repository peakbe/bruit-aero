// ===============================================================
// IMPORTS MODULES
// ===============================================================
import { map, initRadarMap, drawApproachDepartureCones } from "./map.js";
import { updateFIDS } from "./fids.js";
import { renderSonometers, renderSonometersALLDynamic, sonoLayer, getAirportWind } from "./sono.js";
import { fetchRealFlights, renderFlightTable } from "./flights.js";
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
  },
  flights: {
    EBLG: { arrivals: [], departures: [] },
    EBCI: { arrivals: [], departures: [] }
  }
};

// Export pour synchronisation avec les modules ND / UI
window.appState = state;
window.currentAirport = state.currentAirport;
window.activeRunway = state.activeRunway;

// ===============================================================
// FONCTION DE MISE À JOUR DES VOLS RÉELS
// ===============================================================
export async function refreshFlightsData(airport = state.currentAirport) {
  if (airport === "ALL") {
    await Promise.all([
      refreshFlightsData("EBLG"),
      refreshFlightsData("EBCI")
    ]);
    return;
  }

  try {
    // Récupération en parallèle des départs et arrivées réels
    const [arrivals, departures] = await Promise.all([
      fetchRealFlights(airport, "arrival"),
      fetchRealFlights(airport, "departure")
    ]);

    // Stockage dans l'état global
    state.flights[airport] = { arrivals, departures };

    // Injection dans le DOM (recherche de plusieurs formats d'IDs possibles)
    const prefix = airport.toLowerCase();
    
    renderFlightTable(`${prefix}-arrivals-list`, arrivals);
    renderFlightTable(`${prefix}-departures-list`, departures);
    
    // IDs alternatifs si présents dans votre HTML
    renderFlightTable(`fids-${prefix}-arrivals`, arrivals);
    renderFlightTable(`fids-${prefix}-departures`, departures);

    // Synchronisation optionnelle avec votre module FIDS
    if (typeof updateFIDS === "function") {
      updateFIDS(airport, { arrivals, departures });
    }
  } catch (err) {
    console.error(`Erreur lors du rafraîchissement des vols pour ${airport}:`, err);
  }
}

// ===============================================================
// INITIALISATION
// ===============================================================
document.addEventListener("DOMContentLoaded", async () => {
  console.log("🚀 Initialisation de l'application Bruit Aéro...");

  // 1. Initialiser la carte radar
  initRadarMap();

  // 2. Charger les données météo initiales
  await fetchWeatherData();

  // 3. CHARGER LES VOLS RÉELS (ÉTAIT MANQUANT !)
  await refreshFlightsData("ALL");

  // 4. Initialiser la sélection des pistes et les sonomètres
  updateRunwaySonometers();
  syncNdWindUI();

  // 5. Planification des rafraîchissements récurrents
  setInterval(() => fetchWeatherData(), WEATHER_REFRESH_MS || 30000);
  setInterval(() => fetchMetarData(), METAR_REFRESH_MS || 60000);
  setInterval(() => refreshFlightsData("ALL"), 60000); // Mise à jour des vols toutes les 60s

  // 6. Configuration des boutons
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
  const apt = state.currentAirport === "ALL" ? "EBLG" : state.currentAirport;

  // Vent SONO (km/h)
  const windSono = getAirportWind(apt);

  // Vent METAR
  const windMetar = state.metar[apt];

  let dir = 0;
  let spdKt = 0;

  if (windSono && windSono.speed > 0) {
    dir = windSono.deg;
    spdKt = windSono.speed / 1.852; // km/h -> kt
  } else if (windMetar) {
    dir = windMetar.windDeg;
    spdKt = windMetar.speedMs * 1.94384; // m/s -> kt
  }

  updateNdWindComponents(
    apt,
    { windDeg: dir, windSpdKt: spdKt },
    { windDeg: dir, windSpdKt: spdKt },
    spdKt,
    spdKt,
    RUNWAY_HEADINGS
  );
}

function updateControlBarButtons(activeAirport) {
  const buttons = document.querySelectorAll(".control-group .airport-icon-btn");
  buttons.forEach(btn => {
    if (btn.id === "btn-recenter") return;
    const onclickAttr = btn.getAttribute("onclick") || "";
    if (onclickAttr.includes(`'${activeAirport}'`)) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

// ===============================================================
// METAR (FALLBACK DIRECT)
// ===============================================================
async function fetchMetarData() {
  const airports = ["EBCI", "EBLG"];
  
  await Promise.all(airports.map(async (apt) => {
    try {
      const res = await fetch(`https://metar.vatsim.net/${apt}`);
      if (res.ok) {
        const text = (await res.text()).trim();
        updateMetarUI(apt, text);
        parseAndApplyMetar(apt, text);
      }
    } catch (e) {
      console.warn(`Fallback METAR Vatsim échoué pour ${apt}`, e);
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
      // Utilisation stricte de `\({WORKER_BASE_URL}/api/meteo?apt=\){apt}`
      const res = await fetch(`\({WORKER_BASE_URL}/api/meteo?apt=\){apt}`);
      if (!res.ok) return;

      const data = await res.json();

      if (data.metar) {
        updateMetarUI(apt, data.metar);
        parseAndApplyMetar(apt, data.metar);
      }

      if (data.meteo) {
        const temp = Math.round(data.meteo.main?.temp ?? 15);
        const windSpeedKmh = Math.round((data.meteo.wind?.speed ?? 0) * 3.6);
        const windDeg = data.meteo.wind?.deg ?? 0;

        const prefix = apt.toLowerCase();

        const tempEl = document.getElementById(`\({prefix}-temp`) || document.getElementById(`temp-\){prefix}`);
        if (tempEl) tempEl.textContent = `${temp}°C`;

        const windEl = document.getElementById(`\({prefix}-wind`) || document.getElementById(`wind-\){prefix}`);
        if (windEl) windEl.textContent = `Vent: \({windSpeedKmh} km/h (\){windDeg}°)`;

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
      }
    } catch (e) {
      console.error(`Erreur météo ${apt} :`, e);
    }
  }));

  syncNdWindUI();
  updateRunwaySonometers();
}

/**
 * Analyse le texte METAR brut pour extraire la température, le vent et la piste si besoin
 */
function parseAndApplyMetar(apt, metarRaw) {
  if (!metarRaw) return;

  const prefix = apt.toLowerCase();

  // Extraction Température (ex: 17/07 -> 17°C)
  const tempMatch = metarRaw.match(/\s(M?\d{2})\/(M?\d{2})\s/);
  if (tempMatch) {
    const tempVal = tempMatch[1].replace("M", "-");
    const tempEl = document.getElementById(`\({prefix}-temp`) || document.getElementById(`temp-\){prefix}`);
    if (tempEl && tempEl.textContent.includes("--")) {
      tempEl.textContent = `${tempVal}°C`;
    }
  }

  // Extraction Vent (ex: 19006KT -> 190°, 6kt)
  const windMatch = metarRaw.match(/(\d{3})(\d{2})KT/);
  if (windMatch) {
    const windDeg = parseInt(windMatch[1], 10);
    const windSpdKt = parseInt(windMatch[2], 10);
    const windSpeedMs = windSpdKt * 0.514444;

    state.metar[apt] = { windDeg, speedMs: windSpeedMs };
    autoSelectRunway(apt, windDeg, windSpeedMs);
  }
}

function updateMetarUI(apt, metarRaw) {
  const prefix = apt.toLowerCase();
  const el = document.getElementById(`\({prefix}-metar`) || document.getElementById(`metar-\){prefix}`);
  if (!el) return;

  el.textContent = metarRaw;

  // Détection tendance METAR
  let trend = "NOSIG";
  if (metarRaw.includes("BECMG")) trend = "BECMG";
  if (metarRaw.includes("TEMPO")) trend = "TEMPO";

  const trendEl = document.getElementById(`\({prefix}-metar-trend`) || document.getElementById(`trend-\){prefix}`);
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

  const prefix = airport.toLowerCase();
  const el = document.getElementById(`\({prefix}-runway`) || document.getElementById(`rwy-\){prefix}`);
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

  const rwyEBLG = state.metar.EBLG.windDeg > 130 && state.metar.EBLG.windDeg < 310 ? "22" : "04";
  const rwyEBCI = state.metar.EBCI.windDeg > 150 && state.metar.EBCI.windDeg < 330 ? "24" : "06";

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

  refreshFlightsData(airport);
  updateNdSonometersStatus(state.sonometersEnabled, sonoLayer);
  updateControlBarButtons(airport);
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
  state,
  updateControlBarButtons
};
