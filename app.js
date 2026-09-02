// =================================================================
// 1. CONFIGURATION ET VARIABLES GLOBALES
// =================================================================
var WORKER_BASE_URL = "https://bruit-aero-proxy.pnyr682w7f.workers.dev";

var map = map || null;
var planeMarkers = planeMarkers || {}; 
var currentAirport = currentAirport || "EBLG";
var flightsGroup = flightsGroup || null;

var AIRPORTS = {
  EBLG: { lat: 50.6374, lon: 5.4432, name: "Liège Airport" },
  EBCI: { lat: 50.4592, lon: 4.4538, name: "Charleroi Airport" }
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

const ICAO_TO_IATA = Object.fromEntries(Object.entries(IATA_TO_ICAO).map(([k, v]) => [v, k]));

// Coordonnées approximatives pour simuler les approches si pas de signal OpenSky
const CITY_COORDS = {
  "LIS": [38.7742, -9.1342], "NAP": [40.8860, 14.2908], "OTP": [44.5711, 26.0850], 
  "SOF": [42.6952, 23.4062], "BDS": [40.6576, 17.9470], "SUF": [38.9054, 16.2423], 
  "IBZ": [38.8729, 1.3731], "DUB": [53.4264, -6.2499], "CDG": [49.0097, 2.5479], 
  "BSL": [47.5896, 7.5299], "ACC": [5.6052, -0.1668], "ORD": [41.9742, -87.9073], 
  "LOS": [6.5774, 3.3212], "DMM": [26.4712, 49.7979], "NBO": [-1.3192, 36.9275], 
  "DOH": [25.2731, 51.6081], "TLV": [32.0055, 34.8854], "QKD": [51.588, -0.528]
};

// =================================================================
// 2. INITIALISATION CARTE
// =================================================================
function initMap() {
  const mapContainer = document.getElementById("map");
  if (!mapContainer) return;

  map = L.map("map").setView([50.55, 4.95], 8);
  flightsGroup = L.layerGroup().addTo(map);

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
// 3. UTILITAIRES DE CORRESPONDANCE
// =================================================================
function parseCallsign(flightStr) {
  if (!flightStr) return { raw: "", prefix: "", number: "" };
  const clean = flightStr.replace(/\s+/g, '').toUpperCase();
  const match = clean.match(/^([A-Z0-9]{2,3})?(\d+[A-Z]*)$/);
  return { raw: clean, prefix: match ? match[1] || "" : "", number: match ? match[2] : "" };
}

function calculateEstimatedCoords(airportKey, cityStr, type) {
  const airport = AIRPORTS[airportKey] || AIRPORTS.EBCI;
  let targetCoords = [50.8503, 4.3517]; // Bruxelles par défaut

  for (const [code, coords] of Object.entries(CITY_COORDS)) {
    if (cityStr && cityStr.includes(code)) {
      targetCoords = coords;
      break;
    }
  }

  // Positionner le vol à proximité de l'aéroport (phase finale/décollage)
  const factor = type === 'departures' ? 0.08 : 0.12;
  const lat = airport.lat + (targetCoords[0] - airport.lat) * factor;
  const lon = airport.lon + (targetCoords[1] - airport.lon) * factor;
  
  // Calcul du cap (heading)
  const dLon = targetCoords[1] - airport.lon;
  const y = Math.sin(dLon) * Math.cos(targetCoords[0]);
  const x = Math.cos(airport.lat) * Math.sin(targetCoords[0]) - Math.sin(airport.lat) * Math.cos(targetCoords[0]) * Math.cos(dLon);
  const heading = ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;

  return { lat, lon, heading };
}

// =================================================================
// 4. MOTEUR RADAR HYBRIDE (OPENSKY + FALLBACK FIDS)
// =================================================================
async function renderFidsPlanesOnMap(map, flightsLayerGroup) {
  if (!flightsLayerGroup) return;
  const currentActiveKeys = new Set();
  const hasRotationPlugin = typeof L.Marker.prototype.setRotationAngle === "function";

  try {
    // 1. Récupération des vols en direct sur une grande zone
    const resRadar = await fetch(`${WORKER_BASE_URL}/api/opensky?lamin=49.0&lomin=1.5&lamax=52.0&lomax=8.0`).catch(() => null);
    const radarData = resRadar && resRadar.ok ? await resRadar.json() : { states: [] };
    const liveStates = radarData.states || [];

    const livePlanes = liveStates.map(state => {
      const callsign = (state[1] || "").trim().toUpperCase();
      const parsed = parseCallsign(callsign);
      return {
        icao24: state[0],
        callsign: callsign,
        prefix: parsed.prefix,
        numberOnly: parsed.number,
        lat: state[6],
        lon: state[5],
        heading: state[10] || 0,
        altitude: state[7],
        speed: state[9]
      };
    }).filter(p => p.lat && p.lon);

    // 2. Récupération des données FIDS
    const combinations = [
      { airport: 'EBLG', type: 'departures' }, { airport: 'EBLG', type: 'arrivals' },
      { airport: 'EBCI', type: 'departures' }, { airport: 'EBCI', type: 'arrivals' }
    ];

    const fidsList = [];
    for (const c of combinations) {
      try {
        const res = await fetch(`${WORKER_BASE_URL}/api/fids?airport=${c.airport}&type=${c.type}`);
        if (res.ok) {
          const rawData = await res.json();
          const flightArray = Array.isArray(rawData) ? rawData : (rawData.flights || []);
          flightArray.forEach(f => fidsList.push({ ...f, airport: c.airport, type: c.type, parsed: parseCallsign(f.flight) }));
        }
      } catch (e) {}
    }

    // 3. Affichage/Mise à jour des avions OpenSky
    livePlanes.forEach(plane => {
      const markerKey = plane.callsign || plane.icao24;

      const matchingFids = fidsList.find(f => {
        const icaoPrefix = IATA_TO_ICAO[f.parsed.prefix] || f.parsed.prefix;
        const targetCallsign = `${icaoPrefix}${f.parsed.number}`;
        return plane.callsign === targetCallsign || plane.callsign === f.parsed.raw || (plane.numberOnly && plane.numberOnly === f.parsed.number);
      });

      const altText = plane.altitude ? `${Math.round(plane.altitude)} m` : "En vol";
      const speedText = plane.speed ? `${Math.round(plane.speed * 3.6)} km/h` : "N/C";

      let popupContent = `
        <div style="font-family: sans-serif; font-size: 13px;">
          <h3 style="margin: 0 0 5px 0; color: #1e293b;">Vol ${plane.callsign || "Inconnu"}</h3>
          <b>Altitude :</b> ${altText}<br>
          <b>Vitesse :</b> ${speedText}<br>
          <b>Source :</b> <span style="color: #22c55e; font-weight: bold;">📡 Radar Direct</span>
        </div>
      `;

      if (matchingFids) {
        popupContent = `
          <div style="font-family: sans-serif; font-size: 13px;">
            <h3 style="margin: 0 0 5px 0; color: #1e293b;">Vol ${matchingFids.flight} (${matchingFids.type === 'departures' ? 'Départ' : 'Arrivée'})</h3>
            <b>Aéroport :</b> ${matchingFids.airport}<br>
            <b>Destination/Origine :</b> ${matchingFids.city}<br>
            <b>Heure :</b> ${matchingFids.time}<br>
            <b>Altitude :</b> ${altText} | <b>Vitesse :</b> ${speedText}<br>
            <b>Statut :</b> ${matchingFids.status}<br>
            <b>Source :</b> <span style="color: #22c55e; font-weight: bold;">📡 Radar Direct</span>
          </div>
        `;
      }

      updateOrAddMarker(markerKey, plane.lat, plane.lon, plane.heading, popupContent, flightsLayerGroup, hasRotationPlugin);
      currentActiveKeys.add(markerKey);

      // Enregistrer les alias pour la sélection
      planeMarkers[plane.callsign] = planeMarkers[markerKey];
      if (plane.numberOnly) planeMarkers[plane.numberOnly] = planeMarkers[markerKey];
      if (matchingFids) planeMarkers[matchingFids.flight.replace(/\s+/g, '')] = planeMarkers[markerKey];
    });

    // 4. Fallback FIDS : Afficher les vols prévus manquant au radar OpenSky
    fidsList.forEach(fids => {
      const cleanFlight = fids.flight.replace(/\s+/g, '');
      const icaoPrefix = IATA_TO_ICAO[fids.parsed.prefix] || fids.parsed.prefix;
      const radarCallsign = `${icaoPrefix}${fids.parsed.number}`;

      // Si le vol n'a pas été capté par OpenSky
      if (!currentActiveKeys.has(radarCallsign) && !currentActiveKeys.has(cleanFlight)) {
        const est = calculateEstimatedCoords(fids.airport, fids.city, fids.type);
        const popupContent = `
          <div style="font-family: sans-serif; font-size: 13px;">
            <h3 style="margin: 0 0 5px 0; color: #1e293b;">Vol ${fids.flight} (${fids.type === 'departures' ? 'Départ' : 'Arrivée'})</h3>
            <b>Aéroport :</b> ${fids.airport}<br>
            <b>Destination/Origine :</b> ${fids.city}<br>
            <b>Heure :</b> ${fids.time}<br>
            <b>Statut :</b> ${fids.status}<br>
            <b>Source :</b> <span style="color: #eab308; font-weight: bold;">⏱️ Trajectoire Estimée</span>
          </div>
        `;

        updateOrAddMarker(cleanFlight, est.lat, est.lon, est.heading, popupContent, flightsLayerGroup, hasRotationPlugin);
        currentActiveKeys.add(cleanFlight);
        planeMarkers[cleanFlight] = planeMarkers[cleanFlight];
        if (fids.parsed.number) planeMarkers[fids.parsed.number] = planeMarkers[cleanFlight];
      }
    });

    // Clean-up des vols sortis de la zone
    Object.keys(planeMarkers).forEach(key => {
      if (!currentActiveKeys.has(key) && planeMarkers[key]) {
        flightsLayerGroup.removeLayer(planeMarkers[key]);
        delete planeMarkers[key];
      }
    });

  } catch (err) {
    console.error("Erreur radar :", err);
  }
}

function updateOrAddMarker(key, lat, lon, heading, popupContent, layerGroup, hasRotation) {
  if (planeMarkers[key]) {
    planeMarkers[key].setLatLng([lat, lon]);
    if (hasRotation) planeMarkers[key].setRotationAngle(heading);
    planeMarkers[key].getPopup().setContent(popupContent);
  } else {
    const markerOptions = { icon: yellowPlaneIcon };
    if (hasRotation) {
      markerOptions.rotationAngle = heading;
      markerOptions.rotationOrigin = "center center";
    }
    const marker = L.marker([lat, lon], markerOptions).bindPopup(popupContent);
    layerGroup.addLayer(marker);
    planeMarkers[key] = marker;
  }
}

// =================================================================
// 5. SELECTION DU VOL DEPUIS LE TABLEAU
// =================================================================
function selectFlightOnMap(flightNum) {
  const cleanKey = flightNum.replace(/\s+/g, '').toUpperCase();
  const parsed = parseCallsign(cleanKey);

  const icaoPrefix = IATA_TO_ICAO[parsed.prefix] || parsed.prefix;
  const targetCallsign = `${icaoPrefix}${parsed.number}`;

  let marker = planeMarkers[cleanKey] || planeMarkers[targetCallsign] || planeMarkers[parsed.number];

  if (marker) {
    map.setView(marker.getLatLng(), 11, { animate: true });
    marker.openPopup();
  } else {
    alert(`Le vol ${flightNum} n'a pas pu être localisé.`);
  }
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

function getSonometerColor(id, airport) {
  if (airport === "EBLG") {
    if (currentRunwayEBLG === "22") return "#10b981"; 
    if (currentRunwayEBLG === "04") {
      return ["F004", "F005", "F006", "F010", "F012", "F016", "F017"].includes(id) ? "#ef4444" : "#10b981";
    }
  }
  if (airport === "EBCI") {
    if (currentRunwayEBCI === "24") return "#10b981"; 
    if (currentRunwayEBCI === "06") {
      return ["F114", "F116", "F117", "F118"].includes(id) ? "#ef4444" : "#10b981";
    }
  }
  return "#10b981";
}

const sonometerMarkers = [];

function renderSonometersOnMap(map) {
  sonometerMarkers.forEach(m => map.removeLayer(m));
  sonometerMarkers.length = 0;

  const allSonometers = [
    ...sonometersEBCI.map(s => ({ ...s, airport: "EBCI" })),
    ...sonometersEBLG.map(s => ({ ...s, airport: "EBLG" }))
  ];

  allSonometers.forEach(s => {
    const lat = dmsToDecimal(s.latDMS);
    const lng = dmsToDecimal(s.lonDMS);
    const color = getSonometerColor(s.id, s.airport);

    const marker = L.circleMarker([lat, lng], {
      radius: 7, fillColor: color, color: "#ffffff", weight: 2, opacity: 1, fillOpacity: 0.9
    }).addTo(map);

    const activeRunway = s.airport === "EBCI" ? currentRunwayEBCI : currentRunwayEBLG;

    marker.bindPopup(`
      <div style="color: #0f172a; font-family: sans-serif; min-width: 200px;">
        <b style="font-size: 1.05rem;">Sonomètre ${s.id} (${s.airport})</b><br>
        <span style="font-size:0.85rem; color: #475569;">${s.address}</span>
        <hr style="margin:6px 0; border:0; border-top:1px solid #cbd5e1;">
        <b>Piste active :</b> Piste ${activeRunway}<br>
        <div id="weather-sono-${s.id}" style="font-size:0.85rem; color: #64748b; margin-top: 4px;">
          ⏳ Chargement météo...
        </div>
      </div>
    `);

    marker.on('click', async () => {
      try {
        const res = await fetch(`${WORKER_BASE_URL}/api/weather?lat=${lat}&lon=${lng}`);
        const weatherDiv = document.getElementById(`weather-sono-${s.id}`);
        if (res.ok && weatherDiv) {
          const weather = await res.json();
          weatherDiv.innerHTML = `<b>🌤️ Météo :</b> ${Math.round(weather.main?.temp ?? 0)}°C, Vent ${msToKmh(weather.wind?.speed ?? 0)} km/h`;
        }
      } catch (err) {}
    });

    sonometerMarkers.push(marker);
  });
}

function setRunwayEBCI(runwayNum, map) { currentRunwayEBCI = runwayNum; renderSonometersOnMap(map); }
function setRunwayEBLG(runwayNum, map) { currentRunwayEBLG = runwayNum; renderSonometersOnMap(map); }

// =================================================================
// 7. CHARGEMENT TABLEAUX ET MÉTÉO
// =================================================================
function msToKmh(ms) { return Math.round(ms * 3.6); }

function drawCompass(canvasId, windDeg) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = Math.min(centerX, centerY) - 5;

  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate((windDeg * Math.PI) / 180);

  ctx.beginPath();
  ctx.moveTo(0, -radius + 4);
  ctx.lineTo(-6, 8);
  ctx.lineTo(6, 8);
  ctx.closePath();
  ctx.fillStyle = "#38bdf8";
  ctx.fill();

  ctx.restore();
}

async function fetchFlightsData(specificAirport = null) {
  const ebciBody = document.getElementById("ebci-flights-body");
  const eblgBody = document.getElementById("eblg-flights-body");

  if (specificAirport) {
    const targetBody = specificAirport === "EBCI" ? ebciBody : eblgBody;
    if (targetBody) await loadFlightType("departures", targetBody, specificAirport);
    return;
  }

  if (ebciBody) { await loadFlightType("departures", ebciBody, "EBCI"); await sleep(200); }
  if (eblgBody) { await loadFlightType("departures", eblgBody, "EBLG"); }
}

async function loadFlightType(type, elementContainer, airport) {
  try {
    const cleanType = (type === 'dep' || type === 'departures') ? 'departures' : 'arrivals';
    const response = await fetch(`${WORKER_BASE_URL}/api/fids?airport=${airport}&type=${cleanType}`);
    if (!response.ok) return;

    const rawData = await response.json();
    const flights = Array.isArray(rawData) ? rawData : (rawData.flights || []);

    if (flights.length > 0) {
      elementContainer.innerHTML = flights.map((f) => {
        const flightNum = f.flight || f.flightNumber || f.callsign || "—";
        const city = f.city || f.destination || f.origin || "—";
        const time = f.time || f.scheduledTime || "—";
        const status = f.status || "Programmé";

        return `
          <tr onclick="selectFlightOnMap('${flightNum}')" style="cursor: pointer;">
            <td><strong>${flightNum}</strong></td>
            <td>${city}</td>
            <td>${time}</td>
            <td><span class="badge">${status}</span></td>
          </tr>
        `;
      }).join("");
    } else {
      elementContainer.innerHTML = `<tr><td colspan="4" style="text-align:center;">Aucun vol trouvé</td></tr>`;
    }
  } catch (error) {
    elementContainer.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#ef4444;">Erreur de chargement</td></tr>`;
  }
}

function switchFlightTab(airport, type, btnElement) {
  const parent = btnElement.parentElement;
  if (parent) {
    parent.querySelectorAll('.tab-btn, button').forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active');
  }

  const container = document.getElementById(`${airport.toLowerCase()}-flights-body`);
  if (container) loadFlightType((type === 'dep' || type === 'departures') ? 'departures' : 'arrivals', container, airport.toUpperCase());
}

async function fetchWeatherData() {
  loadAirportWeather(AIRPORTS.EBLG.lat, AIRPORTS.EBLG.lon, "EBLG", "eblg-temp", "eblg-metar", "eblg-forecast");
  await sleep(300);
  loadAirportWeather(AIRPORTS.EBCI.lat, AIRPORTS.EBCI.lon, "EBCI", "ebci-temp", "ebci-metar", "ebci-forecast");
}

async function loadAirportWeather(lat, lon, station, tempElemId, metarElemId, forecastElemId) {
  try {
    const resWeather = await fetch(`${WORKER_BASE_URL}/api/weather?lat=${lat}&lon=${lon}`);
    const resMetar = await fetch(`${WORKER_BASE_URL}/api/metar?station=${station}`);

    if (resWeather.ok) {
      const weather = await resWeather.json();
      const tempEl = document.getElementById(tempElemId);

      if (tempEl && weather.main) {
        tempEl.innerHTML = `<strong>${Math.round(weather.main.temp)}°C</strong> | 💨 ${msToKmh(weather.wind?.speed || 0)} km/h`;
        drawCompass(`compass-${station.toLowerCase()}`, weather.wind?.deg || 0);
      }
    }

    if (resMetar.ok) {
      const metar = await resMetar.json();
      const metarEl = document.getElementById(metarElemId);
      if (metarEl) metarEl.innerText = metar.raw || metar.sanitized || metar.metar || "";
    }

    const forecastEl = document.getElementById(forecastElemId);
    if (forecastEl) {
      const resForecast = await fetch(`${WORKER_BASE_URL}/api/forecast?lat=${lat}&lon=${lon}`);
      if (resForecast.ok) {
        const forecastData = await resForecast.json();
        if (forecastData && Array.isArray(forecastData.list)) {
          forecastEl.innerHTML = forecastData.list.slice(0, 4).map(item => `
            <div style="text-align: center; font-size: 0.8rem; padding: 4px;">
              <div>${new Date(item.dt * 1000).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}</div>
              <div><strong>${Math.round(item.main.temp)}°C</strong></div>
            </div>
          `).join('');
        }
      }
    }
  } catch (err) {}
}

function filterAirportView(selectedAirport) {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('onclick')?.includes(`'${selectedAirport}'`));
  });

  document.querySelectorAll('[data-airport]').forEach(el => {
    const elAirport = el.getAttribute('data-airport');
    el.style.display = (selectedAirport === 'ALL' || elAirport === selectedAirport) ? '' : 'none';
  });

  if (map) {
    if (selectedAirport === 'EBLG') map.setView([50.6374, 5.4432], 11);
    else if (selectedAirport === 'EBCI') map.setView([50.4592, 4.4538], 11);
    else map.setView([50.55, 4.95], 8);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initMap);
} else {
  initMap();
}
