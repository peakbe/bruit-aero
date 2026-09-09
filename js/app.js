// ===============================================================
// IMPORTS MODULES
// ===============================================================
import { map, initRadarMap, drawApproachDepartureCones } from "./map.js";
import { updateFIDS } from "./fids.js";
import { renderSonometers, sonoLayer } from "./sono.js";
import {
  updateWindTrend,
  updateNdWindComponents,
  updateNdSonometersStatus
} from "./nd-utils.js";
import { updateCompassUI } from "./nd-panel.js";

import {
  WORKER_BASE_URL,
  AIRPORT_COORDS,
  RUNWAY_HEADINGS,
  RADAR_REFRESH_MS,
  METAR_REFRESH_MS,
  WEATHER_REFRESH_MS
} from "./config.js";

// ===============================================================
// GLOBAL STATE
// ===============================================================
let currentAirport = "EBLG";
let sonometersEnabled = true;

const windTrend = {
  EBLG: [],
  EBCI: []
};

window.metarEBLG = { windDeg: 0 };
window.metarEBCI = { windDeg: 0 };
window.lastWindSpeedEBLG = 0;
window.lastWindSpeedEBCI = 0;

// ===============================================================
// INITIALISATION
// ===============================================================
document.addEventListener("DOMContentLoaded", async () => {
  initRadarMap();

  updateFIDS();
  setInterval(updateFIDS, RADAR_REFRESH_MS);

  await fetchWeatherData();
  updateRunwaySonometers();
  updateNdSonometersStatus(sonometersEnabled, sonoLayer);
  updateNdWindComponents(
    currentAirport,
    window.metarEBLG,
    window.metarEBCI,
    window.lastWindSpeedEBLG,
    window.lastWindSpeedEBCI,
    RUNWAY_HEADINGS
  );

  setInterval(fetchWeatherData, WEATHER_REFRESH_MS);
  setInterval(fetchMetarData, METAR_REFRESH_MS);

  setupSonometersToggle();
  setupRecenterButton();
});

window.addEventListener("load", () => {
  setTimeout(() => {
    if (map) map.invalidateSize();
  }, 150);
});

// ===============================================================
// METAR (fallback si Worker indisponible)
// ===============================================================
async function fetchMetarData() {
  const airports = ["EBCI", "EBLG"];

  for (const apt of airports) {
    const el = document.getElementById(`${apt.toLowerCase()}-metar`);
    if (!el) continue;

    try {
      const res = await fetch(`https://metar.vatsim.net/${apt}`);
      el.innerText = res.ok ? (await res.text()).trim() : "METAR indisponible";
    } catch {
      el.innerText = "METAR indisponible";
    }
  }
}

// ===============================================================
// METEO FUSIONNÉE (METAR + Open-Meteo via Worker)
// ===============================================================
async function fetchWeatherData() {
  const airports = ["EBCI", "EBLG"];

  for (const apt of airports) {
    try {
      const res = await fetch(`${WORKER_BASE_URL}/api/meteo?apt=${apt}`);
      if (!res.ok) continue;

      const data = await res.json();

      // --- METAR ---
      updateMetarUI(apt, data.metar);

      // --- METEO ---
      const temp = Math.round(data.meteo.main.temp);
      const windSpeedKmh = data.meteo.wind.speed;
      const windSpeedMs = windSpeedKmh / 3.6;
      const windDeg = data.meteo.wind.deg;

      // Stockage global ND Airbus
      if (apt === "EBLG") {
        window.metarEBLG = { windDeg };
        window.lastWindSpeedEBLG = windSpeedMs;
      }
      if (apt === "EBCI") {
        window.metarEBCI = { windDeg };
        window.lastWindSpeedEBCI = windSpeedMs;
      }

      // UI cockpit Airbus
      const prefix = apt.toLowerCase();
      document.getElementById(`${prefix}-temp`).textContent = `${temp}°C`;
      document.getElementById(`${prefix}-wind`).textContent =
        `Vent: ${windSpeedKmh} km/h (${windDeg}°)`;

      updateWindTrend(prefix, windSpeedKmh, windTrend);
      updateCompassUI(prefix, windDeg, windSpeedKmh);

      autoSelectRunway(apt, windDeg, windSpeedMs);

      drawApproachDepartureCones(
        apt,
        AIRPORT_COORDS[apt].lat,
        AIRPORT_COORDS[apt].lon,
        windDeg
      );

    } catch (e) {
      console.error(`Erreur météo ${apt} :`, e);
    }
  }
}

// ===============================================================
// METAR UI
// ===============================================================
function updateMetarUI(apt, metarRaw) {
  const el = document.getElementById(`${apt.toLowerCase()}-metar`);
  if (el) el.textContent = metarRaw;
}

// ===============================================================
// AUTO-SELECTION PISTE
// ===============================================================
function autoSelectRunway(airport, windDeg, windSpeedMs) {
  const RWYS = airport === "EBLG"
    ? [{ num: "22", heading: 220 }, { num: "04", heading: 40 }]
    : [{ num: "24", heading: 240 }, { num: "06", heading: 60 }];

  let best = RWYS[0];
  let bestHeadwind = -999;

  RWYS.forEach(rwy => {
    const diff = Math.abs(windDeg - rwy.heading);
    const angle = diff > 180 ? 360 - diff : diff;
    const headwind = windSpeedMs * Math.cos(angle * Math.PI / 180);
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
// SONOMÈTRES — cockpit Airbus PRO+++
// ===============================================================
function updateRunwaySonometers() {
  if (!sonometersEnabled) {
    sonoLayer.clearLayers();
    updateNdSonometersStatus(sonometersEnabled, sonoLayer);
    return;
  }

  const windEBLG = window.metarEBLG.windDeg;
  const rwyEBLG = windEBLG > 180 ? "22" : "04";

  const windEBCI = window.metarEBCI.windDeg;
  const rwyEBCI = windEBCI > 180 ? "24" : "06";

  renderSonometers("EBLG", rwyEBLG, { reset: true });
  renderSonometers("EBCI", rwyEBCI);

  updateNdSonometersStatus(sonometersEnabled, sonoLayer);
}

// ===============================================================
// FILTRE AÉROPORT — cockpit Airbus PRO+++
// ===============================================================
window.filterAirportView = function (airport) {
  currentAirport = airport;

  updateNdWindComponents(
    currentAirport,
    window.metarEBLG,
    window.metarEBCI,
    window.lastWindSpeedEBLG,
    window.lastWindSpeedEBCI,
    RUNWAY_HEADINGS
  );

  updateNdSonometersStatus(sonometersEnabled, sonoLayer);

  if (sonometersEnabled) updateRunwaySonometers();

  const target = AIRPORT_COORDS[currentAirport] || AIRPORT_COORDS.ALL;
  const zoom = currentAirport === "ALL" ? 8 : 11;
  map.setView([target.lat, target.lon], zoom, { animate: true });

  document.querySelectorAll(".airport-icon-btn").forEach(btn =>
    btn.classList.remove("active")
  );

  const btn = document.querySelector(
    `button[onclick="filterAirportView('${airport}')"]`
  );
  if (btn) btn.classList.add("active");
};

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
      updateRunwaySonometers();
    } else {
      btn.classList.remove("active");
      sonoLayer.clearLayers();
    }

    updateNdSonometersStatus(sonometersEnabled, sonoLayer);
    updateNdWindComponents(
      currentAirport,
      window.metarEBLG,
      window.metarEBCI,
      window.lastWindSpeedEBLG,
      window.lastWindSpeedEBCI,
      RUNWAY_HEADINGS
    );
  };

  bar.appendChild(btn);
}

// ===============================================================
// RECENTER — cockpit Airbus PRO+++
// ===============================================================
function setupRecenterButton() {
  const btn = document.getElementById("btn-recenter");
  if (!btn) return;

  btn.onclick = () => {
    const target = AIRPORT_COORDS[currentAirport] || AIRPORT_COORDS.ALL;
    const zoom = currentAirport === "ALL" ? 8 : 11;
    map.setView([target.lat, target.lon], zoom, { animate: true });
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
