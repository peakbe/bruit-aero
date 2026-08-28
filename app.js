// =================================================================
// 1. CONFIGURATION ET VARIABLES GLOBALES SÉCURISÉES
// =================================================================
var WORKER_BASE_URL = "https://bruit-aero-proxy.pnyr682w7f.workers.dev";

var map = map || null;
var planeMarkers = planeMarkers || {}; 
var lastValidStates = lastValidStates || [];
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
  "FR": "RYR",
  "TB": "TUI",
  "SN": "BEL",
  "LH": "DLH",
  "HV": "TRA",
  "W6": "WZZ",
  "3V": "TAY"
};

// =================================================================
// 2. INITIALISATION CARTE
// =================================================================
function initMap() {
  const mapContainer = document.getElementById("map");
  if (!mapContainer) {
    console.error("Conteneur #map introuvable.");
    return;
  }

  map = L.map("map").setView([50.55, 4.95], 9);
  flightsGroup = L.layerGroup().addTo(map);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap",
  }).addTo(map);

  const markerEBLG = L.marker([AIRPORTS.EBLG.lat, AIRPORTS.EBLG.lon]).addTo(map).bindPopup(`<b>${AIRPORTS.EBLG.name} (EBLG)</b>`);
  const markerEBCI = L.marker([AIRPORTS.EBCI.lat, AIRPORTS.EBCI.lon]).addTo(map).bindPopup(`<b>${AIRPORTS.EBCI.name} (EBCI)</b>`);

  markerEBLG.on('click', () => fetchFlightsData('EBLG'));
  markerEBCI.on('click', () => fetchFlightsData('EBCI'));

  renderSonometersOnMap(map);

  const RecenterControl = L.Control.extend({
    options: { position: "topleft" },
    onAdd: function (mapInstance) {
      const container = L.DomUtil.create("div", "leaflet-bar");
      const button = L.DomUtil.create("button", "leaflet-btn-recenter", container);
      button.type = "button";
      button.innerHTML = "🎯 Recentrer";
      button.title = "Recentrer la carte";

      L.DomEvent.disableClickPropagation(button);
      L.DomEvent.disableScrollPropagation(button);

      button.onclick = function (e) {
        e.preventDefault();
        mapInstance.setView([50.55, 4.95], 9);
      };

      return container;
    }
  });

  map.addControl(new RecenterControl());

  renderFidsPlanesOnMap(map, flightsGroup);
  fetchFlightsData();
  fetchWeatherData();

  setInterval(() => renderFidsPlanesOnMap(map, flightsGroup), 60000);
  setInterval(fetchFlightsData, 120000);
  setInterval(fetchWeatherData, 300000);

  window.addEventListener("resize", () => {
    if (map) map.invalidateSize();
  });
}

// =================================================================
// 3. UTILITAIRES ET PARSING
// =================================================================
function parseCallsign(flightStr) {
  if (!flightStr) return { raw: "", prefix: "", number: "" };
  const clean = flightStr.replace(/\s+/g, '').toUpperCase();
  const match = clean.match(/^([A-Z0-9]{2,3})?(\d+)$/);
  
  if (!match) return { raw: clean, prefix: "", number: "" };
  return {
    raw: clean,
    prefix: match[1] || "",
    number: match[2]
  };
}

const AIRPORT_CONFIG = {
  EBLG: { name: "Liège Airport", lat: 50.6374, lon: 5.4432, heading: 228 },
  EBCI: { name: "Charleroi Airport", lat: 50.4592, lon: 4.4538, heading: 242 }
};

function calculateEstimatedCoords(airportCode, type, index) {
  const cfg = AIRPORT_CONFIG[airportCode] || AIRPORT_CONFIG.EBCI;
  
  // Distance entre chaque avion sur la ligne d'attente/approche
  const step = (index + 1) * 0.018; 

  if (type === "departures") {
    // Départs : Partent de l'aéroport et s'éloignent dans l'axe de décollage
    return {
      lat: cfg.lat + (step * 0.5),
      lon: cfg.lon + step,
      heading: cfg.heading
    };
  } else {
    // Arrivées : Placées EN AMONT de l'aéroport (éloignées sur l'axe d'approche)
    // Le premier avion à l'atterrissage est le plus proche (index 0), les suivants sont plus loin
    const approachHeading = (cfg.heading + 180) % 360; // Cap orienté vers la piste
    
    return {
      // Soustraction pour placer les avions en amont (Sud-Ouest / Ouest selon l'axe)
      lat: cfg.lat - (step * 0.5) - 0.01, 
      lon: cfg.lon - step - 0.02,
      heading: approachHeading
    };
  }
}

// =================================================================
// 4. AFFICHAGE ET CORRÉLATION DU RADAR
// =================================================================
async function renderFidsPlanesOnMap(map, flightsLayerGroup) {
  if (!flightsLayerGroup) return;
  flightsLayerGroup.clearLayers();
  planeMarkers = {};

  try {
    // 1. OpenSky Radar (GPS Live)
    const resRadar = await fetch(`${WORKER_BASE_URL}/api/opensky`).catch(() => null);
    const radarData = resRadar && resRadar.ok ? await resRadar.json() : { states: [] };
    const liveStates = radarData.states || [];

    const livePlanes = liveStates.map(state => {
      const callsign = (state[1] || "").trim().toUpperCase();
      const parsed = parseCallsign(callsign);
      return {
        icao24: state[0],
        callsign: callsign,
        numberOnly: parsed.number,
        lat: state[6],
        lon: state[5],
        heading: state[10] || 0,
        altitude: state[7],
        speed: state[9]
      };
    }).filter(p => p.lat && p.lon && p.speed > 30);

    // 2. FIDS Data
    const combinations = [
      { airport: 'EBLG', type: 'departures' },
      { airport: 'EBLG', type: 'arrivals' },
      { airport: 'EBCI', type: 'departures' },
      { airport: 'EBCI', type: 'arrivals' }
    ];

    const fidsList = [];
    for (const c of combinations) {
      try {
        const res = await fetch(`${WORKER_BASE_URL}/api/fids?airport=${c.airport}&type=${c.type}`);
        if (res.ok) {
          const data = await res.json();
          (data.flights || []).forEach((f, idx) => {
            const parsed = parseCallsign(f.flight);
            fidsList.push({ 
              ...f, 
              airport: c.airport, 
              type: c.type, 
              parsed, 
              index_by_type: idx 
            });
          });
        }
      } catch (e) {
        console.error("Erreur FIDS :", e);
      }
      await sleep(100);
    }

    const hasRotationPlugin = typeof L.Marker.prototype.setRotationAngle === "function";

    // A. Traitement des avions FIDS (avec correspondance GPS si disponible)
    // Remplacer le bloc de boucle FIDS dans renderFidsPlanesOnMap par ceci :
    fidsList.forEach(fids => {
      const matchLive = livePlanes.find(p => 
        p.callsign === fids.parsed.raw || 
        (p.numberOnly && p.numberOnly === fids.parsed.number)
      );

      let lat, lon, heading, sourceText, altText, speedText;

      if (matchLive) {
        lat = matchLive.lat;
        lon = matchLive.lon;
        heading = matchLive.heading;
        sourceText = `<span style="color: #22c55e; font-weight: bold;">📡 GPS Temps Réel</span>`;
        altText = `${matchLive.altitude ? Math.round(matchLive.altitude) : 0} m`;
        speedText = `${matchLive.speed ? Math.round(matchLive.speed * 3.6) : 0} km/h`;
        processedFlights.add(matchLive.icao24);
      } else {
        // Utilisation de fids.index_by_type pour garantir l'espacement régulier
        const est = calculateEstimatedCoords(fids.airport, fids.type, fids.index_by_type);
        lat = est.lat;
        lon = est.lon;
        heading = est.heading;
        sourceText = `<span style="color: #f59e0b; font-weight: bold;">⏱️ Position Estimée</span>`;
        altText = fids.type === "departures" ? "Au sol (Départ)" : "En approche";
        speedText = "0 km/h";
      }

      const popupContent = `
        <div style="font-family: sans-serif; font-size: 13px;">
          <h3 style="margin: 0 0 5px 0; color: #1e293b;">Vol ${fids.flight} (${fids.type === 'departures' ? 'Départ' : 'Arrivée'})</h3>
          <b>Aéroport :</b> ${AIRPORT_CONFIG[fids.airport]?.name || fids.airport}<br>
          <b>Destination/Origine :</b> ${fids.city}<br>
          <b>Heure :</b> ${fids.time}<br>
          <b>Altitude :</b> ${altText} | <b>Vitesse :</b> ${speedText}<br>
          <b>Statut :</b> ${fids.status}<br>
          <b>Source :</b> ${sourceText}
        </div>
      `;

      const markerOptions = { icon: yellowPlaneIcon };
      if (hasRotationPlugin) {
        markerOptions.rotationAngle = heading;
        markerOptions.rotationOrigin = "center center";
      }

      const marker = L.marker([lat, lon], markerOptions).bindPopup(popupContent);
      flightsLayerGroup.addLayer(marker);

      planeMarkers[fids.flight] = marker;
      planeMarkers[fids.parsed.raw] = marker;
      if (fids.parsed.number) planeMarkers[fids.parsed.number] = marker;
      if (IATA_TO_ICAO[fids.parsed.prefix]) {
        planeMarkers[IATA_TO_ICAO[fids.parsed.prefix] + fids.parsed.number] = marker;
      }
    });

    // B. Ajout des vols OpenSky restants (Vols en transit non répertoriés dans FIDS)
    livePlanes.forEach(plane => {
      if (processedFlights.has(plane.icao24)) return;

      const popupContent = `
        <div style="font-family: sans-serif; font-size: 13px;">
          <h3 style="margin: 0 0 5px 0; color: #1e293b;">Vol ${plane.callsign || "Inconnu"}</h3>
          <b>Altitude :</b> ${plane.altitude ? Math.round(plane.altitude) : 0} m<br>
          <b>Vitesse :</b> ${plane.speed ? Math.round(plane.speed * 3.6) : 0} km/h<br>
          <b>Source :</b> <span style="color: #22c55e; font-weight: bold;">📡 GPS Radar Transit</span>
        </div>
      `;

      const markerOptions = { icon: yellowPlaneIcon };
      if (hasRotationPlugin) {
        markerOptions.rotationAngle = plane.heading;
        markerOptions.rotationOrigin = "center center";
      }

      const marker = L.marker([plane.lat, plane.lon], markerOptions).bindPopup(popupContent);
      flightsLayerGroup.addLayer(marker);

      if (plane.callsign) planeMarkers[plane.callsign] = marker;
    });

  } catch (err) {
    console.error("Erreur globale d'affichage des vols :", err);
  }
}

// =================================================================
// 5. SELECTION DU VOL DEPUIS LE TABLEAU
// =================================================================
function selectFlightOnMap(flightNum) {
  const cleanKey = flightNum.replace(/\s+/g, '').toUpperCase();
  const parsed = parseCallsign(cleanKey);
  
  // Recherche par nom brut, par numéro ou par équivalent ICAO
  let marker = planeMarkers[cleanKey] || planeMarkers[parsed.number];
  if (!marker && IATA_TO_ICAO[parsed.prefix]) {
    marker = planeMarkers[IATA_TO_ICAO[parsed.prefix] + parsed.number];
  }

  if (marker) {
    const latLng = marker.getLatLng();
    map.setView(latLng, 11, { animate: true });
    marker.openPopup();
  } else {
    alert(`Le vol ${flightNum} n'a pas pu être localisé sur la carte.`);
  }
}

// =================================================================
// 6. DONNÉES SONOMÈTRES & PISTES
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
  const degrees = parseFloat(parts[0]);
  const minutes = parseFloat(parts[1]);
  const seconds = parseFloat(parts[2]);
  const direction = parts[3];

  let dd = degrees + minutes / 60 + seconds / 3600;
  if (direction === "S" || direction === "W") dd = -dd;
  return dd;
}

function getSonometerColor(id, airport) {
  if (airport === "EBLG") {
    if (currentRunwayEBLG === "22") return "#10b981"; 
    if (currentRunwayEBLG === "04") {
      const redListEBLG = ["F004", "F005", "F006", "F010", "F012", "F016", "F017"];
      return redListEBLG.includes(id) ? "#ef4444" : "#10b981";
    }
  }
  if (airport === "EBCI") {
    if (currentRunwayEBCI === "24") return "#10b981"; 
    if (currentRunwayEBCI === "06") {
      const redListEBCI = ["F114", "F116", "F117", "F118"];
      return redListEBCI.includes(id) ? "#ef4444" : "#10b981";
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
      radius: 7,
      fillColor: color,
      color: "#ffffff",
      weight: 2,
      opacity: 1,
      fillOpacity: 0.9
    }).addTo(map);

    const activeRunway = s.airport === "EBCI" ? currentRunwayEBCI : currentRunwayEBLG;
    const statusText = color === "#10b981" ? "Actif (Vert)" : "Inactif/Alerte (Rouge)";

    const basePopupHTML = `
      <div style="color: #0f172a; font-family: sans-serif; min-width: 200px;">
        <b style="font-size: 1.05rem;">Sonomètre ${s.id} (${s.airport})</b><br>
        <span style="font-size:0.85rem; color: #475569;">${s.address}</span>
        <hr style="margin:6px 0; border:0; border-top:1px solid #cbd5e1;">
        <b>Piste active :</b> Piste ${activeRunway}<br>
        <b>Statut :</b> <span style="color:${color}; font-weight:bold;">${statusText}</span>
        <hr style="margin:6px 0; border:0; border-top:1px solid #cbd5e1;">
        <div id="weather-sono-${s.id}" style="font-size:0.85rem; color: #64748b;">
          ⏳ Chargement de la météo locale...
        </div>
      </div>
    `;

    marker.bindPopup(basePopupHTML);

    marker.on('click', async () => {
      try {
        const res = await fetch(`${WORKER_BASE_URL}/api/weather?lat=${lat}&lon=${lng}`);
        const weatherDiv = document.getElementById(`weather-sono-${s.id}`);
        
        if (res.ok && weatherDiv) {
          const weather = await res.json();
          const temp = Math.round(weather.main?.temp ?? 0);
          const windMs = weather.wind?.speed ?? 0;
          const windKmh = msToKmh(windMs);
          const city = weather.name || "Localité";
          const icon = weather.weather?.[0]?.icon || "01d";
          const desc = weather.weather?.[0]?.description || "";

          weatherDiv.innerHTML = `
            <b>🌤️ Météo (${city}) :</b><br>
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
              <img src="https://openweathermap.org/img/wn/${icon}.png" width="32" height="32" alt="${desc}"/>
              <div>
                <strong>${temp}°C</strong> — ${desc}<br>
                <span style="font-size: 0.75rem; color: #475569;">💨 Vent : ${windKmh} km/h (${windMs} m/s)</span>
              </div>
            </div>
          `;
        } else if (weatherDiv) {
          weatherDiv.innerHTML = `<span style="color:#ef4444;">Météo indisponible</span>`;
        }
      } catch (err) {
        console.error("Erreur météo sonomètre :", err);
      }
    });

    sonometerMarkers.push(marker);
  });
}

function setRunwayEBCI(runwayNum, map) {
  currentRunwayEBCI = runwayNum;
  renderSonometersOnMap(map);
}

function setRunwayEBLG(runwayNum, map) {
  currentRunwayEBLG = runwayNum;
  renderSonometersOnMap(map);
}

// =================================================================
// 7. CHARGEMENT TABLEAUX ET MÉTÉO
// =================================================================
function msToKmh(ms) {
  return Math.round(ms * 3.6);
}

async function fetchFlightsData(specificAirport = null) {
  const ebciBody = document.getElementById("ebci-flights-body");
  const eblgBody = document.getElementById("eblg-flights-body");

  if (specificAirport) {
    const targetBody = specificAirport === "EBCI" ? ebciBody : eblgBody;
    if (targetBody) await loadFlightType("departures", targetBody, specificAirport);
    return;
  }

  if (ebciBody) {
    await loadFlightType("departures", ebciBody, "EBCI");
    await sleep(200);
  }
  if (eblgBody) {
    await loadFlightType("departures", eblgBody, "EBLG");
  }
}

async function loadFlightType(type, elementContainer, airport) {
  try {
    const cleanType = (type === 'dep' || type === 'departures') ? 'departures' : 'arrivals';
    
    const response = await fetch(`${WORKER_BASE_URL}/api/fids?airport=${airport}&type=${cleanType}`);
    if (!response.ok) return;

    const data = await response.json();
    if (data && Array.isArray(data.flights) && data.flights.length > 0) {
      elementContainer.innerHTML = data.flights
        .map(
          (f) => `
            <tr onclick="selectFlightOnMap('${f.flight}')" style="cursor: pointer;">
              <td><strong>${f.flight}</strong></td>
              <td>${f.city}</td>
              <td>${f.time}</td>
              <td><span class="badge">${f.status}</span></td>
            </tr>
          `
        )
        .join("");
    } else {
      elementContainer.innerHTML = `<tr><td colspan="4" style="text-align:center;">Aucun vol trouvé pour ${airport}</td></tr>`;
    }
  } catch (error) {
    console.error(`Erreur vols (${type}) pour ${airport}:`, error);
  }
}

function switchFlightTab(airport, type, btnElement) {
  const parentTabContainer = btnElement.parentElement;
  if (parentTabContainer) {
    const buttons = parentTabContainer.querySelectorAll('.tab-btn');
    buttons.forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active');
  }

  const targetBodyId = `${airport.toLowerCase()}-flights-body`;
  const container = document.getElementById(targetBodyId);

  if (container) {
    const flightType = (type === 'dep' || type === 'departures') ? 'departures' : 'arrivals';
    loadFlightType(flightType, container, airport.toUpperCase());
  }
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
        const windMs = weather.wind?.speed || 0;
        const windKmh = msToKmh(windMs);

        tempEl.innerHTML = `
          <strong>${Math.round(weather.main.temp)}°C</strong> 
          <span style="font-size: 0.85em; opacity: 0.8;">| 💨 ${windMs} m/s (${windKmh} km/h)</span>
        `;
      }
    }

    if (resMetar.ok) {
      const metar = await resMetar.json();
      const metarEl = document.getElementById(metarElemId);
      if (metarEl) {
        const rawText = metar.raw || metar.sanitized || metar.metar || (typeof metar === 'string' ? metar : null);
        if (rawText) metarEl.innerText = rawText;
      }
    }

    const forecastEl = document.getElementById(forecastElemId);
    if (forecastEl) {
      const resForecast = await fetch(`${WORKER_BASE_URL}/api/forecast?lat=${lat}&lon=${lon}`);
      if (resForecast.ok) {
        const forecastData = await resForecast.json();
        if (forecastData && Array.isArray(forecastData.list)) {
          const upcomingForecast = forecastData.list.slice(0, 4); 

          forecastEl.innerHTML = upcomingForecast.map(item => {
            const time = new Date(item.dt * 1000).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
            const temp = Math.round(item.main.temp);
            const icon = item.weather[0]?.icon || "01d";
            const forecastWindMs = item.wind?.speed || 0;
            const forecastWindKmh = msToKmh(forecastWindMs);

            return `
              <div style="text-align: center; font-size: 0.8rem; padding: 4px; border-right: 1px solid rgba(255,255,255,0.1);">
                <div>${time}</div>
                <img src="https://openweathermap.org/img/wn/${icon}.png" width="30" height="30" alt="icon"/>
                <div><strong>${temp}°C</strong></div>
                <div style="font-size: 0.75rem; color: #cbd5e1; margin-top: 2px;">
                  💨 ${forecastWindMs} m/s<br>(${forecastWindKmh} km/h)
                </div>
              </div>
            `;
          }).join('');
        }
      }
    }
  } catch (err) {
    console.error(`Erreur météo ${station} :`, err);
  }
}

function filterAirportView(selectedAirport) {
  const buttons = document.querySelectorAll('.filter-btn');
  buttons.forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('onclick')?.includes(`'${selectedAirport}'`)) {
      btn.classList.add('active');
    }
  });

  const elementsToFilter = document.querySelectorAll('[data-airport]');
  elementsToFilter.forEach(el => {
    const elAirport = el.getAttribute('data-airport');
    if (selectedAirport === 'ALL' || elAirport === selectedAirport) {
      el.style.display = el.classList.contains('control-group') ? 'flex' : 'block';
    } else {
      el.style.display = 'none';
    }
  });

  if (typeof map !== 'undefined' && map) {
    if (selectedAirport === 'EBLG') {
      map.setView([50.6374, 5.4432], 11);
    } else if (selectedAirport === 'EBCI') {
      map.setView([50.4592, 4.4538], 11);
    } else {
      map.setView([50.55, 4.95], 9);
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initMap);
} else {
  initMap();
}
