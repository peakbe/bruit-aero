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

// =================================================================
// 2. INITIALISATION
// =================================================================
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  fetchMetarData();
  setInterval(fetchMetarData, 300000); // Mise à jour METAR toutes les 5min
});

function initMap() {
  const mapContainer = document.getElementById("map");
  if (!mapContainer) return;

  // Si la carte existe déjà, on la détruit proprement avant de la re-créer
  if (map !== null) {
    map.remove();
    map = null;
  }

  map = L.map("map").setView([50.55, 4.95], 8);
  window.myMap = map; 
  flightsGroup = L.layerGroup().addTo(map);

  // ... Reste de votre fonction initMap ...

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
      button.innerHTML = "🎯 Recentrer";
      button.onclick = (e) => { e.preventDefault(); mapInstance.setView([50.55, 4.95], 8); };
      return container;
    }
  });

  map.addControl(new RecenterControl());

  renderFidsPlanesOnMap(map, flightsGroup);
  fetchFlightsData();
  fetchWeatherData();

  setInterval(() => renderFidsPlanesOnMap(map, flightsGroup), 5000);
  setInterval(fetchFlightsData, 120000);
  setInterval(fetchWeatherData, 300000);

  window.addEventListener("resize", () => { if (map) map.invalidateSize(); });
}

// =================================================================
// 3. FONCTION DE CHARGEMENT DU METAR
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
  const kmToDeg = lengthKm / 111;
  const rad = heading * Math.PI / 180;
  const leftRad = (heading - angleDeg) * Math.PI / 180;
  const rightRad = (heading + angleDeg) * Math.PI / 180;

  const endLat = lat + kmToDeg * Math.cos(rad);
  const endLon = lon + kmToDeg * Math.sin(rad);
  const leftLat = lat + kmToDeg * Math.cos(leftRad);
  const leftLon = lon + kmToDeg * Math.sin(leftRad);
  const rightLat = lat + kmToDeg * Math.cos(rightRad);
  const rightLon = lon + kmToDeg * Math.sin(rightRad);

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
  const headingRad = headingDeg * Math.PI / 180;
  const kmToDeg = ((speedMs * secondsAhead) / 1000) / 111;
  return [[lat, lon], [lat + kmToDeg * Math.cos(headingRad), lon + kmToDeg * Math.sin(headingRad)]];
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
  if (!plane || !plane.lat || !plane.lon) return "enroute";
  const apt = AIRPORTS[airport];
  const d = distKm(plane.lat, plane.lon, apt.lat, apt.lon);
  const alt = plane.altitude || 0;
  const gs = plane.speed ? plane.speed * 3.6 : 0;

  if (d < 18 && alt < 2000 && gs < 350) return "approach";
  if (d < 10 && alt < 3000 && gs > 200) return "departure";
  return "enroute";
}

// =================================================================
// 5. RADAR ADS-B ET PLACEMENT DES AVIONS
// =================================================================
async function renderFidsPlanesOnMap(mapInstance, flightsLayerGroup) {
  if (!flightsLayerGroup) return;
  const currentActiveKeys = new Set();
  const hasRotationPlugin = typeof L.Marker.prototype.setRotationAngle === "function";

  try {
    const resRadar = await fetch(`${WORKER_BASE_URL}/api/adsb`).catch(() => null);
    const radarData = resRadar && resRadar.ok ? await resRadar.json() : { aircraft: [] };
    const livePlanes = radarData.aircraft || [];

    livePlanes.forEach(plane => {
      const callsign = (plane.callsign || "").replace(/\s+/g, '').toUpperCase();
      const primaryKey = callsign || plane.registration || Math.random().toString();
      
      const phase = classifyFlightPhase(plane, currentAirport);
      if (radarMode !== "all" && radarMode !== phase) return;

      const altMeters = plane.altFt ? Math.round(plane.altFt * 0.3048) : null;
      const speedKmh = plane.speedKt ? Math.round(plane.speedKt * 1.852) : null;
      const altText = altMeters !== null ? `${altMeters} m (${plane.altFt} ft)` : "Sol / Inconnu";
      const speedText = speedKmh !== null ? `${speedKmh} km/h` : "N/C";

      const popupContent = `
        <div style="font-family: sans-serif; font-size: 13px;">
          <h3 style="margin: 0 0 5px 0; color: #1e293b;">Vol ${callsign || "Inconnu"}</h3>
          <b>Type :</b> ${plane.type || "N/C"}<br>
          <b>Immatriculation :</b> ${plane.registration || "N/C"}<br>
          <b>Altitude :</b> ${altText}<br>
          <b>Vitesse :</b> ${speedText}
        </div>`;

      const m = updateOrAddMarker(primaryKey, plane.lat, plane.lng, plane.track, popupContent, flightsLayerGroup, hasRotationPlugin);
      currentActiveKeys.add(primaryKey);
      planeMarkers[primaryKey] = m;
    });

    Object.keys(planeMarkers).forEach(key => {
      if (!currentActiveKeys.has(key) && planeMarkers[key]) {
        flightsLayerGroup.removeLayer(planeMarkers[key]);
        delete planeMarkers[key];
      }
    });
  } catch (err) {
    console.error("Erreur mise à jour radar ADS-B :", err);
  }
}

function updateOrAddMarker(key, lat, lon, heading, popupContent, layerGroup, hasRotation) {
  let marker = planeMarkers[key];
  if (marker) {
    marker.setLatLng([lat, lon]);
    if (hasRotation) marker.setRotationAngle(heading);
    marker.getPopup().setContent(popupContent);
  } else {
    const markerOptions = { icon: yellowPlaneIcon };
    if (hasRotation) {
      markerOptions.rotationAngle = heading;
      markerOptions.rotationOrigin = "center center";
    }
    marker = L.marker([lat, lon], markerOptions).bindPopup(popupContent);
    layerGroup.addLayer(marker);
  }
  return marker;
}

function selectFlightOnMap(flightNum) {
  const cleanKey = flightNum.replace(/\s+/g, '').toUpperCase();
  let marker = planeMarkers[cleanKey];
  if (marker) {
    map.setView(marker.getLatLng(), 11, { animate: true });
    marker.openPopup();
  }
}

// =================================================================
// 6. SONOMÈTRES ET PISTES
// =================================================================
const sonometersEBCI = [
  { id: "F118", address: "Rue Piconette 1, Sombreffe", latDMS: "50 30 18.96 N", lonDMS: "4 36 40.25 E" },
  { id: "F109", address: "Chaussée de Charleroi 265, Sombreffe", latDMS: "50 29 25.27 N", lonDMS: "4 33 44.6 E" },
  { id: "F108", address: "Avenue Brunard 83, Fleurus", latDMS: "50 29 11.97 N", lonDMS: "4 32 46.61 E" }
];

const sonometersEBLG = [
  { id: "F017", address: "Rue de la Pommeraie, 4690 Wonck", latDMS: "50 45 53.58 N", lonDMS: "5 37 50.18 E" },
  { id: "F001", address: "Rue Franquet 15, Houtain", latDMS: "50 44 16.96 N", lonDMS: "5 36 31.8 E" }
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
      radius: 6, fillColor: "#10b981", color: "#ffffff", weight: 2, fillOpacity: 0.9
    }).addTo(mapInstance);

    marker.bindPopup(`<b>Sonomètre ${s.id} (${s.airport})</b><br>${s.address}`);
    sonometerMarkers.push(marker);
  });
}

function setRadarMode(mode, btnElement) {
  radarMode = mode;
  if (btnElement && btnElement.parentElement) {
    btnElement.parentElement.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active');
  }
  if (map && flightsGroup) renderFidsPlanesOnMap(map, flightsGroup);
}

// =================================================================
// 7. MÉTÉO SATELLITE & TABLEAUX
// =================================================================
function msToKmh(ms) { return Math.round(ms * 3.6); }

async function fetchFlightsData() {
  const ebciBody = document.getElementById("ebci-flights-body");
  const eblgBody = document.getElementById("eblg-flights-body");
  if (ebciBody) await loadFlightType("departures", ebciBody, "EBCI");
  if (eblgBody) await loadFlightType("departures", eblgBody, "EBLG");
}

async function loadFlightType(type, elementContainer, airport) {
  try {
    const response = await fetch(`${WORKER_BASE_URL}/api/fids?airport=${airport}&type=${type}`);
    if (!response.ok) return;
    const rawData = await response.json();
    const flights = Array.isArray(rawData) ? rawData : (rawData.flights || []);

    if (flights.length > 0) {
      elementContainer.innerHTML = flights.map((f) => `
        <tr onclick="selectFlightOnMap('${f.flight}')" style="cursor: pointer;">
          <td><strong>${f.flight || "—"}</strong></td>
          <td>${f.city || "—"}</td>
          <td>${f.time || "—"}</td>
          <td><span class="badge">${f.status || "Programmé"}</span></td>
        </tr>
      `).join("");
    }
  } catch (e) {
    elementContainer.innerHTML = `<tr><td colspan="4" style="text-align:center;">Aucun vol trouvé</td></tr>`;
  }
}

async function fetchWeatherData() {
  for (const [code, apt] of Object.entries(AIRPORTS)) {
    try {
      const res = await fetch(`${WORKER_BASE_URL}/api/weather?lat=${apt.lat}&lon=${apt.lon}`);
      if (!res.ok) continue;

      const weather = await res.json();
      const temp = Math.round(weather.main?.temp ?? 0);
      const windSpeedKmh = msToKmh(weather.wind?.speed ?? 0);
      const windDeg = weather.wind?.deg ?? 0;

      autoSelectRunway(code, windDeg, weather.wind?.speed ?? 0);

      const prefix = code.toLowerCase();
      const tempEl = document.getElementById(`${prefix}-temp`);
      const windEl = document.getElementById(`${prefix}-wind`);

      if (tempEl) tempEl.textContent = `${temp}°C`;
      if (windEl) windEl.textContent = `Vent: ${windSpeedKmh} km/h (${windDeg}°)`;
    } catch (e) {
      console.error(`Erreur météo ${code} :`, e);
    }
  }
}

// =================================================================
// 8. FILTRAGE ET RECENTRAGE (BOUTONS HTML)
// =================================================================
window.filterAirportView = function(airport) {
  // 1. Boutons UI
  const buttons = document.querySelectorAll('.control-bar-inline .airport-icon-btn');
  buttons.forEach(btn => btn.classList.remove('active'));
  if (window.event && window.event.currentTarget) {
    window.event.currentTarget.classList.add('active');
  }

  // 2. Visibilité des cartes METAR / VOLS
  const cards = document.querySelectorAll('.card[data-airport]');
  cards.forEach(card => {
    const cardAirport = card.getAttribute('data-airport');
    if (airport === 'ALL' || cardAirport === airport) {
      card.style.display = 'block';
    } else {
      card.style.display = 'none';
    }
  });

  // 3. Deplacement Carte Leaflet
  if (window.myMap && AIRPORT_COORDS[airport]) {
    const zoomLevel = airport === 'ALL' ? 8 : 11;
    window.myMap.setView(AIRPORT_COORDS[airport], zoomLevel, { animate: true });
  }
};

// =================================================================
// 8. FILTRAGE ET RECENTRAGE (BOUTONS HTML)
// =================================================================
window.filterAirportView = function(airport) {
  // 1. Gestion visuelle des boutons
  const buttons = document.querySelectorAll('.control-bar-inline .airport-icon-btn');
  buttons.forEach(btn => btn.classList.remove('active'));
  if (window.event && window.event.currentTarget) {
    window.event.currentTarget.classList.add('active');
  }

  // 2. Affichage / masquage des cartes METAR et Vols
  const cards = document.querySelectorAll('.card[data-airport]');
  cards.forEach(card => {
    const cardAirport = card.getAttribute('data-airport');
    if (airport === 'ALL' || cardAirport === airport) {
      card.style.display = 'block';
    } else {
      card.style.display = 'none';
    }
  });

  // 3. Recentrage de la carte Leaflet
  if (map && AIRPORT_COORDS[airport]) {
    const zoomLevel = airport === 'ALL' ? 8 : 11;
    map.setView(AIRPORT_COORDS[airport], zoomLevel, { animate: true });
  }
};

// =================================================================
// 9. GESTION DES ONGLETS VOLS (DÉPARTS / ARRIVÉES)
// =================================================================
window.switchFlightTab = function(airport, type, btnElement) {
  // 1. Mise à jour visuelle des boutons de l'onglet
  if (btnElement && btnElement.parentElement) {
    const buttons = btnElement.parentElement.querySelectorAll('.tab-btn, button');
    buttons.forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active');
  }

  // 2. Identification du tableau cible dans le HTML
  const targetBodyId = `${airport.toLowerCase()}-flights-body`;
  const container = document.getElementById(targetBodyId);

  // 3. Rechargement des données pour l'aéroport et le type sélectionné
  if (container) {
    container.innerHTML = `<tr><td colspan="4" style="text-align:center;">Chargement...</td></tr>`;
    loadFlightType(type, container, airport);
  }
};

// Initialisation globale au chargement de la page
document.addEventListener("DOMContentLoaded", initMap);
