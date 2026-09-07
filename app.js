// =================================================================
// 1. CONFIGURATION ET VARIABLES GLOBALES
// =================================================================
var WORKER_BASE_URL = "https://bruit-aero-proxy.pnyr682w7f.workers.dev";

var map = null;
var planeMarkers = {};
var adsbTracks = {};
var trackLines = {};
var futureLines = {};
var currentAirport = "EBLG";
var flightsGroup = null;
var radarMode = "all";
var isFetchingRadar = false;

var AIRPORTS = {
  EBLG: { lat: 50.6374, lon: 5.4432, name: "Liège Airport" },
  EBCI: { lat: 50.4592, lon: 4.4538, name: "Charleroi Airport" }
};

const AIRPORT_COORDS = {
  EBCI: [50.4592, 4.4538],
  EBLG: [50.6374, 5.4432],
  ALL:  [50.55, 4.95]
};

const yellowPlaneIcon = L.divIcon({
  className: "custom-plane-icon",
  html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28">
           <path fill="#FFD700" stroke="#000000" stroke-width="1.2" d="M21,16v-2l-8-5V3.5C13,2.67,12.33,2,11.5,2S10,2.67,10,3.5V9l-8,5v2l8-2.5V19l-2,1.5V22l3.5-1l3.5,1v-1.5L13,19v-5.5L21,16z"/>
         </svg>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const IATA_TO_ICAO = {
  "FR": "RYR", "TB": "TUI", "SN": "BEL", "LH": "DLH",
  "HV": "TRA", "W6": "WZZ", "3V": "TAY", "FQ": "BAW", "VY": "VLG", "FX": "FDX", "QR": "QTR"
};

const CITY_COORDS = {
  "LIS": [38.7742, -9.1342], "NAP": [40.8860, 14.2908], "OTP": [44.5711, 26.0850],
  "SOF": [42.6952, 23.4062], "BDS": [40.6576, 17.9470], "SUF": [38.9054, 16.2423],
  "IBZ": [38.8729, 1.3731], "DUB": [53.4264, -6.2499], "CDG": [49.0097, 2.5479],
  "BSL": [47.5896, 7.5299], "ACC": [5.6052, -0.1668], "ORD": [41.9742, -87.9073],
  "LOS": [6.5774, 3.3212], "DMM": [26.4712, 49.7979], "NBO": [-1.3192, 36.9275],
  "DOH": [25.2731, 51.6081], "TLV": [32.0055, 34.8854], "QKD": [51.588, -0.528]
};

function msToKmh(ms) {
  return Math.round(ms * 3.6);
}

// =================================================================
// 2. INITIALISATION
// =================================================================
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  fetchMetarData();
  fetchWeatherData();

  setInterval(fetchMetarData, 300000);   // METAR toutes les 5 min
  setInterval(fetchWeatherData, 300000); // Météo + cônes toutes les 5 min

  if (typeof updateFIDS === "function") {
    updateFIDS();
    setInterval(updateFIDS, 30000);      // FIDS Airplanes.live toutes les 30 s
  }
});

function initMap() {
  const mapContainer = document.getElementById("map");
  if (!mapContainer) return;

  if (map !== null) {
    map.remove();
    map = null;
    planeMarkers = {};
  }

  map = L.map("map").setView([50.55, 4.95], 8);
  window.myMap = map;
  flightsGroup = L.layerGroup().addTo(map);

  const CompassControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function() {
      const div = L.DomUtil.create('div', 'leaflet-bar leaflet-compass-control');
      div.style.backgroundColor = '#ffffff';
      div.style.padding = '6px 10px';
      div.style.fontWeight = 'bold';
      div.style.fontSize = '14px';
      div.style.boxShadow = '0 1px 5px rgba(0,0,0,0.4)';
      div.style.borderRadius = '4px';
      div.innerHTML = '🧭 <span style="color:#ef4444;">N</span>';
      return div;
    }
  });
  map.addControl(new CompassControl());

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap",
  }).addTo(map);

  L.marker([AIRPORTS.EBLG.lat, AIRPORTS.EBLG.lon]).addTo(map).bindPopup(`<b>${AIRPORTS.EBLG.name} (EBLG)</b>`);
  L.marker([AIRPORTS.EBCI.lat, AIRPORTS.EBCI.lon]).addTo(map).bindPopup(`<b>${AIRPORTS.EBCI.name} (EBCI)</b>`);

  renderSonometersOnMap(map);

  const RecenterControl = L.Control.extend({
    options: { position: "topleft" },
    onAdd: function (mapInstance) {
      const container = L.DomUtil.create("div", "leaflet-bar");
      const button = L.DomUtil.create("button", "leaflet-btn-recenter", container);
      button.type = "button";
      button.style.cursor = "pointer";
      button.style.padding = "5px 8px";
      button.innerHTML = "🎯 Recentrer";
      button.onclick = (e) => { e.preventDefault(); mapInstance.setView([50.55, 4.95], 8); };
      return container;
    }
  });

  map.addControl(new RecenterControl());

  window.addEventListener("resize", () => { if (map) map.invalidateSize(); });
}

// =================================================================
// 3. FONCTION DE CHARGEMENT DU METAR (VATSIM DIRECT)
// =================================================================
async function fetchMetarData() {
  const airports = ["EBCI", "EBLG"];

  for (const icao of airports) {
    const metarElement = document.getElementById(`${icao.toLowerCase()}-metar`);
    if (!metarElement) continue;

    try {
      const response = await fetch(`https://metar.vatsim.net/${icao}`);
      if (response.ok) {
        const rawMetar = await response.text();
        metarElement.innerText = rawMetar.trim() || "METAR non disponible";
      } else {
        metarElement.innerText = "Erreur de chargement METAR";
      }
    } catch (error) {
      console.error(`Erreur METAR pour ${icao}:`, error);
      metarElement.innerText = "METAR indisponible";
    }
  }
}

// =================================================================
// 4. UTILITAIRES ET CALCULS
// =================================================================
function parseCallsign(flightStr) {
  if (!flightStr) return { raw: "", prefix: "", number: "" };
  const clean = flightStr.replace(/\s+/g, '').toUpperCase();
  const match = clean.match(/^([A-Z0-9]{2,3})?(\d+[A-Z]*)$/);
  return { raw: clean, prefix: match ? match[1] || "" : "", number: match ? match[2] : "" };
}

function drawILSCone(lat, lon, heading, lengthKm = 15, angleDeg = 3) {
  const latRad = lat * Math.PI / 180;
  const kmToDegLat = lengthKm / 110.574;
  const kmToDegLon = lengthKm / (111.320 * Math.cos(latRad));

  const rad = heading * Math.PI / 180;
  const leftRad = (heading - angleDeg) * Math.PI / 180;
  const rightRad = (heading + angleDeg) * Math.PI / 180;

  const endLat = lat + kmToDegLat * Math.cos(rad);
  const endLon = lon + kmToDegLon * Math.sin(rad);
  const leftLat = lat + kmToDegLat * Math.cos(leftRad);
  const leftLon = lon + kmToDegLon * Math.sin(leftRad);
  const rightLat = lat + kmToDegLat * Math.cos(rightRad);
  const rightLon = lon + kmToDegLon * Math.sin(rightRad);

  const cone = L.polygon([
    [lat, lon], [leftLat, leftLon], [endLat, endLon], [rightLat, rightLon]
  ], { color: "cyan", weight: 2, opacity: 0.8, fillOpacity: 0.1 });

  cone.addTo(map);
  return cone;
}

function distKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function computeFuturePath(lat, lon, headingDeg, speedMs, secondsAhead = 60) {
  if (!lat || !lon || !headingDeg || !speedMs) return [];
  const latRad = lat * Math.PI / 180;
  const headingRad = headingDeg * Math.PI / 180;
  const distanceKm = (speedMs * secondsAhead) / 1000;

  const dLat = (distanceKm / 110.574) * Math.cos(headingRad);
  const dLon = (distanceKm / (111.320 * Math.cos(latRad))) * Math.sin(headingRad);

  return [[lat, lon], [lat + dLat, lon + dLon]];
}

function computeCrosswind(windDeg, windSpeed, runwayHeading) {
  const angle = (windDeg - runwayHeading + 360) % 360;
  const rad = angle * Math.PI / 180;
  return {
    cross: Math.round(Math.abs(windSpeed * Math.sin(rad))),
    head: Math.round(windSpeed * Math.cos(rad)),
    side: angle > 180 ? "droite" : "gauche"
  };
}

function classifyFlightPhase(plane, airport) {
  const planeLat = plane.lat;
  const planeLon = plane.lon ?? plane.lng;
  if (!plane || !planeLat || !planeLon) return "enroute";

  const apt = AIRPORTS[airport];
  if (!apt) return "enroute";

  const d = distKm(planeLat, planeLon, apt.lat, apt.lon);
  const alt = plane.altFt || plane.altitude || 0;
  const gs = plane.speedKt ? plane.speedKt * 1.852 : (plane.speed ? plane.speed * 3.6 : 0);

  if (d < 18 && alt < 6500 && gs < 350) return "approach";
  if (d < 10 && alt < 10000 && gs > 200) return "departure";
  return "enroute";
}

// =================================================================
// 6. SONOMÈTRES ET PISTES
// =================================================================
const sonometersEBCI = [
  { id: "F118", address: "Rue Piconette 1, Sombreffe", latDMS: "50 30 18.96 N", lonDMS: "4 36 40.25 E" },
  { id: "F109", address: "Chaussée de Charleroi 265, Sombreffe", latDMS: "50 29 25.27 N", lonDMS: "4 33 44.6 E" },
  { id: "F108", address: "Avenue Brunard 83, Fleurus", latDMS: "50 29 11.97 N", lonDMS: "4 32 46.61 E" },
  { id: "F106", address: "Rue Beaurin et Jonet 17, Wangenies", latDMS: "50 28 47.51 N", lonDMS: "4 31 10.46 E" },
  { id: "F119", address: "Rue René Delhaize 39, Ransart", latDMS: "50 27 47.57 N", lonDMS: "4 28 44.73 E" },
  { id: "F103", address: "Rue Docteur Pircard 61, Jumet", latDMS: "50 27 8.59 N", lonDMS: "4 24 56.68 E" },
  { id: "F102", address: "Rue du Vigneron 5, Jumet", latDMS: "50 26 45.73 N", lonDMS: "4 25 22.56 E" },
  { id: "F101", address: "Rue Bruhaute 46, Jumet", latDMS: "50 26 52.37 N", lonDMS: "4 24 57.02 E" },
  { id: "F107", address: "Rue Maximilien Wattelar 155, Jumet", latDMS: "50 26 38.66 N", lonDMS: "4 24 40.18 E" },
  { id: "F105", address: "Rue Sous le Bois 59, Roux", latDMS: "50 26 49.22 N", lonDMS: "4 24 1.86 E" },
  { id: "F104", address: "Rue du Chiffon Rouge 12, Roux", latDMS: "50 26 32.42 N", lonDMS: "4 23 33.2 E" },
  { id: "F111", address: "Rue de la Baille 42, Courcelles", latDMS: "50 26 18.68 N", lonDMS: "4 21 7.47 E" },
  { id: "F112", address: "Rue des Liserons 44, Goutroux", latDMS: "50 25 28.75 N", lonDMS: "4 21 27.75 E" },
  { id: "F117", address: "Rue du Terril 1, Forchies", latDMS: "50 25 53.4 N", lonDMS: "4 18 53.71 E" },
  { id: "F110", address: "Rue Émile Vandervelde 396, Forchies", latDMS: "50 25 24.85 N", lonDMS: "4 19 38.57 E" },
  { id: "F116", address: "Rue de l'Enseignement 144, Fontaine-l'Evêque", latDMS: "50 24 38.28 N", lonDMS: "4 18 54.19 E" },
  { id: "F114", address: "Rue des Ruelles / Rue de la source, Anderlues", latDMS: "50 24 35.39 N", lonDMS: "4 16 37.8 E" }
];

const sonometersEBLG = [
  { id: "F017", address: "Rue de la Pommeraie, 4690 Wonck", latDMS: "50 45 53.58 N", lonDMS: "5 37 50.18 E" },
  { id: "F001", address: "Rue Franquet 15, Houtain", latDMS: "50 44 16.96 N", lonDMS: "5 36 31.8 E" },
  { id: "F014", address: "Rue Léon Labye 12, Juprelle", latDMS: "50 43 8.02 N", lonDMS: "5 34 23.39 E" },
  { id: "F015", address: "Rue du Brouck 5, Juprelle", latDMS: "50 41 19.82 N", lonDMS: "5 31 34.38 E" },
  { id: "F005", address: "Rue Caquin 4, Haneffe", latDMS: "50 38 21.59 N", lonDMS: "5 19 24.67 E" },
  { id: "F003", address: "Rue Fond Méan 7, St Georges", latDMS: "50 36 4.2 N", lonDMS: "5 22 53.04 E" },
  { id: "F011", address: "Rue Albert 1er 18, St Georges", latDMS: "50 36 4.11 N", lonDMS: "5 21 21.62 E" },
  { id: "F008", address: "Rue Warfusée 5, St Georges", latDMS: "50 35 41.56 N", lonDMS: "5 21 32.22 E" },
  { id: "F002", address: "Rue Noiset 23, St Georges", latDMS: "50 35 18.29 N", lonDMS: "5 22 13.88 E" },
  { id: "F007", address: "Rue Yernawe 13, St Georges", latDMS: "50 35 26.72 N", lonDMS: "5 20 42.81 E" },
  { id: "F009", address: "Bibliothèque Communale, Place Verte, 4470 Stockay", latDMS: "50 34 50.99 N", lonDMS: "5 21 19.5 E" },
  { id: "F004", address: "Vinâve des Stréats 32, Verlaine", latDMS: "50 36 19.49 N", lonDMS: "5 19 17.06 E" },
  { id: "F010", address: "Rue Haute Voie 23, Verlaine", latDMS: "50 35 57.81 N", lonDMS: "5 18 48.57 E" },
  { id: "F013", address: "Rue Bois Léon 31, Verlaine", latDMS: "50 35 12.89 N", lonDMS: "5 18 31.24 E" },
  { id: "F016", address: "Rue de Chapon-Seraing 14, Verlaine", latDMS: "50 37 10.62 N", lonDMS: "5 17 43.24 E" },
  { id: "F006", address: "Rue Bolly Chapon 11, Seraing", latDMS: "50 36 34.54 N", lonDMS: "5 16 17.05 E" },
  { id: "F012", address: "Rue Barbe d'Or 13, 4317 Aineffe", latDMS: "50 37 18.9 N", lonDMS: "5 15 17.09 E" }
];

let currentRunwayEBCI = "24";
let currentRunwayEBLG = "22";

function dmsToDecimal(dmsStr) {
  const parts = dmsStr.trim().split(/\s+/);
  let dd = parseFloat(parts[0]) + parseFloat(parts[1]) / 60 + parseFloat(parts[2]) / 3600;
  return (parts[3] === "S" || parts[3] === "W") ? -dd : dd;
}

function autoSelectRunway(airport, windDeg, windSpeed) {
  const RWYS = airport === "EBLG"
    ? [{ num: "22", heading: 220 }, { num: "04", heading: 40 }]
    : [{ num: "24", heading: 240 }, { num: "06", heading: 60 }];

  let bestRunway = RWYS[0];
  let bestHeadwind = -999;

  RWYS.forEach(rwy => {
    const diff = Math.abs(windDeg - rwy.heading);
    const angle = diff > 180 ? 360 - diff : diff;
    const headwind = windSpeed * Math.cos(angle * Math.PI / 180);
    if (headwind > bestHeadwind) {
      bestHeadwind = headwind;
      bestRunway = rwy;
    }
  });

  if (airport === "EBLG") {
    currentRunwayEBLG = bestRunway.num;
    const el = document.getElementById("eblg-runway");
    if (el) el.textContent = `Piste ${bestRunway.num}`;
  } else {
    currentRunwayEBCI = bestRunway.num;
    const el = document.getElementById("ebci-runway");
    if (el) el.textContent = `Piste ${bestRunway.num}`;
  }
}

const sonometerMarkers = [];
function renderSonometersOnMap(mapInstance) {
  sonometerMarkers.forEach(m => mapInstance.removeLayer(m));
  sonometerMarkers.length = 0;

  const allSonometers = [
    ...sonometersEBCI.map(s => ({ ...s, airport: "EBCI" })),
    ...sonometersEBLG.map(s => ({ ...s, airport: "EBLG" }))
  ];

  allSonometers.forEach(s => {
    const lat = dmsToDecimal(s.latDMS);
    const lng = dmsToDecimal(s.lonDMS);

    const marker = L.circleMarker([lat, lng], {
      radius: 7, fillColor: "#10b981", color: "#ffffff", weight: 2, fillOpacity: 0.9
    }).addTo(mapInstance);

    marker.bindPopup(`<b>Sonomètre ${s.id} (${s.airport})</b><br>${s.address}<br><i>Chargement météo...</i>`);

    marker.on('click', async () => {
      try {
        const res = await fetch(`${WORKER_BASE_URL}/api/weather?lat=${lat}&lon=${lng}`);
        if (res.ok) {
          const weatherData = await res.json();
          const temp = Math.round(weatherData.main?.temp ?? 0);
          const windSpeed = msToKmh(weatherData.wind?.speed ?? 0);
          const windDeg = weatherData.wind?.deg ?? 0;
          const description = weatherData.weather && weatherData.weather[0] ? weatherData.weather[0].description : "Ciel dégagé";

          marker.getPopup().setContent(`
            <div style="font-family: sans-serif; font-size: 13px;">
              <h4 style="margin: 0 0 4px 0; color: #1e293b;">Sonomètre ${s.id} (${s.airport})</h4>
              <p style="margin: 0 0 6px 0; font-size: 11px; color: #64748b;">${s.address}</p>
              <hr style="border:0; border-top:1px solid #e2e8f0; margin: 4px 0;">
              <b>🌡️ Température :</b> ${temp}°C<br>
              <b>💨 Vent :</b> ${windSpeed} km/h (${windDeg}°)<br>
              <b>☁️ Météo :</b> ${description}
            </div>
          `);
        }
      } catch (err) {
        console.error("Erreur météo sonomètre :", err);
      }
    });

    sonometerMarkers.push(marker);
  });
}

// =================================================================
// 7. MÉTÉO SATELLITE, METAR & CÔNES D'APPROCHE
// =================================================================
const RUNWAY_HEADINGS = {
  EBLG: 220,
  EBCI: 60
};

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

      const rwyHeading = RUNWAY_HEADINGS[code] || 0;
      const angleRad = Math.abs(windDeg - rwyHeading) * (Math.PI / 180);
      const crosswindKt = Math.round(windSpeedKt * Math.abs(Math.sin(angleRad)));

      if (typeof autoSelectRunway === "function") {
        autoSelectRunway(code, windDeg, windSpeedMs);
      }

      const prefix = code.toLowerCase();
      const tempEl = document.getElementById(`${prefix}-temp`);
      const windEl = document.getElementById(`${prefix}-wind`);

      if (tempEl) tempEl.textContent = `${temp}°C`;
      if (windEl) windEl.textContent = `Vent: ${windSpeedKmh} km/h (${windDeg}°)`;

      updateCompassUI(prefix, windDeg, windSpeedKmh, crosswindKt);
      drawApproachDepartureCones(code, apt.lat, apt.lon, windDeg);

      fetchSingleMetar(code);
      fetchWeatherForecast(code, apt.lat, apt.lon);

    } catch (e) {
      console.error(`Erreur météo ${code} :`, e);
    }
  }
}

// -----------------------------------------------------------------
// C. ROSE DES VENTS
// -----------------------------------------------------------------
function updateCompassUI(prefix, windDeg, speedKmh, crosswindKt) {
  const card = document.querySelector(`.card[data-airport="${prefix.toUpperCase()}"]`);
  if (!card) return;

  let compassContainer = card.querySelector('.rose-des-vents');
  if (!compassContainer) {
    compassContainer = card.querySelector('.compass-container') || card.querySelectorAll('div')[1];
  }

  if (compassContainer) {
    compassContainer.innerHTML = `
      <div style="text-align: center; margin-top: 5px;">
        <div style="position: relative; width: 60px; height: 60px; margin: 0 auto; border: 2px solid #3b82f6; border-radius: 50%; background: #1e293b; display: flex; align-items: center; justify-content: center;">
          <span style="position: absolute; top: 2px; font-size: 9px; color: #ef4444; font-weight: bold;">N</span>
          <div style="transform: rotate(${windDeg}deg); transition: transform 0.5s ease; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
            <div style="width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 22px solid #38bdf8;"></div>
          </div>
        </div>
        <span style="font-size: 11px; color: #94a3b8; display: block; margin-top: 4px;">${windDeg}° - ${speedKmh} km/h</span>
        <span style="font-size: 11px; font-weight: bold; color: #38bdf8; display: block; margin-top: 2px;">Travers: ${crosswindKt} kt</span>
      </div>
    `;
  }
}

// -----------------------------------------------------------------
// D. TENDANCE MÉTÉO
// -----------------------------------------------------------------
async function fetchWeatherForecast(airportCode, lat, lon) {
  const card = document.querySelector(`.card[data-airport="${airportCode}"]`);
  if (!card) return;

  let forecastEl = card.querySelector('.weather-forecast-box');
  if (!forecastEl) {
    forecastEl = document.createElement('div');
    forecastEl.className = 'weather-forecast-box';
    forecastEl.style.cssText = "margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 12px; color: #cbd5e1;";
    card.appendChild(forecastEl);
  }

  try {
    const res = await fetch(`${WORKER_BASE_URL}/api/forecast?lat=${lat}&lon=${lon}`);
    if (!res.ok) {
      forecastEl.innerHTML = `<span style="opacity: 0.7;">Tendance : non disponible</span>`;
      return;
    }

    const data = await res.json();
    const list = data.list ? data.list.slice(0, 3) : [];

    if (list.length > 0) {
      const itemsHtml = list.map(item => {
        const time = new Date(item.dt * 1000).toLocaleTimeString("fr-BE", { hour: '2-digit', minute: '2-digit' });
        const temp = Math.round(item.main.temp);
        const icon = item.weather[0]?.icon ? `https://openweathermap.org/img/wn/${item.weather[0].icon}.png` : '';
        const pop = Math.round((item.pop || 0) * 100);

        return `
          <div style="text-align: center; flex: 1;">
            <div style="color: #94a3b8; font-size: 10px;">${time}</div>
            ${icon ? `<img src="${icon}" style="width:28px; height:28px; margin:-4px 0;" title="${item.weather[0].description}" />` : ''}
            <div style="font-weight: bold;">${temp}°C</div>
            ${pop > 20 ? `<div style="color: #38bdf8; font-size: 10px;">🌧️ ${pop}%</div>` : ''}
          </div>
        `;
      }).join('');

      forecastEl.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 4px; color: #f8fafc;">Tendance à venir :</div>
        <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.2); padding: 6px; border-radius: 6px;">
          ${itemsHtml}
        </div>
      `;
    }
  } catch (err) {
    console.error(`Erreur tendance ${airportCode}:`, err);
    forecastEl.innerHTML = `<span style="opacity: 0.7;">Tendance indisponible</span>`;
  }
}

// -----------------------------------------------------------------
// E. METAR UNIFIÉ
// -----------------------------------------------------------------
async function fetchSingleMetar(airportCode) {
  const card = document.querySelector(`.card[data-airport="${airportCode}"]`);
  if (!card) return;

  try {
    const res = await fetch(`${WORKER_BASE_URL}/api/metar?station=${airportCode}`);
    if (!res.ok) return;

    const data = await res.json();
    let metarBox = card.querySelector('.metar-box');

    if (!metarBox) {
      metarBox = document.createElement('div');
      metarBox.className = 'metar-box';
      metarBox.style.cssText = "background: rgba(15, 23, 42, 0.6); padding: 8px; border-radius: 6px; font-family: monospace; font-size: 11px; margin-top: 8px; border: 1px solid rgba(255,255,255,0.1); color: #cbd5e1; word-break: break-all;";
      card.appendChild(metarBox);
    }

    metarBox.innerHTML = `<strong style="color: #f59e0b;">METAR:</strong> ${data.raw || 'Indisponible'}`;
  } catch (e) {
    console.error(`Erreur METAR ${airportCode}:`, e);
  }
}

// -----------------------------------------------------------------
// F. CÔNES D'APPROCHE & DÉPART
// -----------------------------------------------------------------
function drawApproachDepartureCones(airportCode, lat, lon, windDeg) {
  if (typeof map === 'undefined' || !map) return;

  if (conePolygons[airportCode]) {
    conePolygons[airportCode].forEach(layer => map.removeLayer(layer));
  }
  conePolygons[airportCode] = [];

  const rwyHeading = RUNWAY_HEADINGS[airportCode] || 0;
  const diff = Math.abs(((windDeg - rwyHeading + 180) % 360) - 180);

  const activeApproachBearing = diff > 90 ? (rwyHeading + 180) % 360 : rwyHeading;

  function createConePoints(originLat, originLng, bearing, distanceKm = 8, angleWidth = 25) {
    const coords = [[originLat, originLng]];
    const startAngle = bearing - angleWidth / 2;
    const endAngle = bearing + angleWidth / 2;

    for (let a = startAngle; a <= endAngle; a += 5) {
      const rad = a * (Math.PI / 180);
      const dLat = (distanceKm / 110.574) * Math.cos(rad);
      const dLng = (distanceKm / (111.320 * Math.cos(originLat * (Math.PI / 180)))) * Math.sin(rad);
      coords.push([originLat + dLat, originLng + dLng]);
    }
    return coords;
  }

  const appBearing = (activeApproachBearing + 180) % 360;
  const approachPoints = createConePoints(lat, lon, appBearing);
  const approachPoly = L.polygon(approachPoints, {
    color: '#10b981',
    fillColor: '#10b981',
    fillOpacity: 0.15,
    weight: 1,
    dashArray: '4, 4'
  }).bindTooltip(`Axe d'approche (${activeApproachBearing}°)`, { permanent: false });

  const departurePoints = createConePoints(lat, lon, activeApproachBearing);
  const departurePoly = L.polygon(departurePoints, {
    color: '#ef4444',
    fillColor: '#ef4444',
    fillOpacity: 0.12,
    weight: 1,
    dashArray: '4, 4'
  }).bindTooltip(`Axe de départ (${activeApproachBearing}°)`, { permanent: false });

  approachPoly.addTo(map);
  departurePoly.addTo(map);

  conePolygons[airportCode].push(approachPoly, departurePoly);
}

// =================================================================
// 8–9. FILTRAGE ET COMPORTEMENT DES ONGLET / VUE AÉROPORT
// =================================================================
window.filterAirportView = function(airport) {
  const buttons = document.querySelectorAll('.control-bar-inline .airport-icon-btn');
  buttons.forEach(btn => btn.classList.remove('active'));

  if (window.event && window.event.currentTarget) {
    window.event.currentTarget.classList.add('active');
  } else {
    const activeBtn = document.querySelector(`.control-bar-inline .airport-icon-btn[onclick*="${airport}"]`);
    if (activeBtn) activeBtn.classList.add('active');
  }

  currentAirport = airport;

  const cards = document.querySelectorAll('[data-airport]');
  cards.forEach(card => {
    const cardAirport = card.getAttribute('data-airport');
    card.style.display = (airport === 'ALL' || cardAirport === airport) ? 'block' : 'none';
  });

  if (map && AIRPORT_COORDS[airport]) {
    const zoomLevel = airport === 'ALL' ? 8 : 11;
    map.setView(AIRPORT_COORDS[airport], zoomLevel, { animate: true });
  }

  if (typeof updateFIDS === "function") {
    updateFIDS();
  }
};
