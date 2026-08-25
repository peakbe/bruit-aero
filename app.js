// =================================================================
// 1. CONFIGURATION ET VARIABLES GLOBALES SÉCURISÉES
// =================================================================
var WORKER_BASE_URL = "https://bruit-aero-proxy.pnyr682w7f.workers.dev";

// Utilisation de var pour éviter les conflits 'let/const' au rechargement
var map = map || null;
var planeMarkers = planeMarkers || {}; 
var lastValidStates = lastValidStates || [];
var currentAirport = currentAirport || "EBLG";

// Coordonnées des aéroports
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

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap",
  }).addTo(map);

  // Marqueurs aéroports avec événement de clic
  const markerEBLG = L.marker([AIRPORTS.EBLG.lat, AIRPORTS.EBLG.lon]).addTo(map).bindPopup(`<b>${AIRPORTS.EBLG.name} (EBLG)</b>`);
  const markerEBCI = L.marker([AIRPORTS.EBCI.lat, AIRPORTS.EBCI.lon]).addTo(map).bindPopup(`<b>${AIRPORTS.EBCI.name} (EBCI)</b>`);

  markerEBLG.on('click', () => fetchFlightsData('EBLG'));
  markerEBCI.on('click', () => fetchFlightsData('EBCI'));

  // Affichage initial des sonomètres sur la carte
  renderSonometersOnMap(map);

  // Bouton Recentrer
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

  fetchRadarData();
  fetchFlightsData();
  fetchWeatherData();

  setInterval(fetchRadarData, 8000);
  setInterval(fetchFlightsData, 120000);
  setInterval(fetchWeatherData, 300000);
}

// =================================================================
// 3. GESTION DU RADAR VOLS (AVEC CACHE)
// =================================================================
async function fetchRadarData() {
  try {
    const response = await fetch(`${WORKER_BASE_URL}/api/opensky`);
    
    if (response.ok) {
      const data = await response.json();
      if (data && Array.isArray(data.states)) {
        lastValidStates = data.states;
        updatePlaneMarkers(data.states);
        return;
      }
    }
  } catch (error) {
    console.warn("Erreur temporaire radar, utilisation du cache :", error);
  }

  if (lastValidStates.length > 0) {
    updatePlaneMarkers(lastValidStates);
  }
}

function updatePlaneMarkers(states) {
  if (!map) return;
  const currentIcaos = new Set();

  const hasRotationPlugin = typeof L.Marker.prototype.setRotationAngle === "function";

  states.forEach((flight) => {
    const icao24 = flight[0];
    const callsign = (flight[1] || "Inconnu").trim();
    const longitude = flight[5];
    const latitude = flight[6];
    const altitude = flight[7] !== null ? `${Math.round(flight[7])} m` : "N/C";
    const speed = flight[9] !== null ? `${Math.round(flight[9] * 3.6)} km/h` : "N/C";
    const heading = flight[10] || 0;

    if (latitude !== null && longitude !== null) {
      currentIcaos.add(icao24);

      const popupContent = `
        <div style="font-family: sans-serif; font-size: 13px;">
          <strong>Vol : ${callsign}</strong><br/>
          ICAO : ${icao24.toUpperCase()}<br/>
          Altitude : ${altitude}<br/>
          Vitesse : ${speed}<br/>
          Cap : ${Math.round(heading)}°
        </div>
      `;

      if (planeMarkers[icao24]) {
        planeMarkers[icao24].setLatLng([latitude, longitude]);
        if (hasRotationPlugin) {
          planeMarkers[icao24].setRotationAngle(heading);
        }
        planeMarkers[icao24].getPopup().setContent(popupContent);
      } else {
        const markerOptions = { icon: yellowPlaneIcon };
        if (hasRotationPlugin) {
          markerOptions.rotationAngle = heading;
          markerOptions.rotationOrigin = "center center";
        }

        const marker = L.marker([latitude, longitude], markerOptions).bindPopup(popupContent);
        marker.addTo(map);
        planeMarkers[icao24] = marker;
      }
    }
  });

  Object.keys(planeMarkers).forEach((icao) => {
    if (!currentIcaos.has(icao)) {
      map.removeLayer(planeMarkers[icao]);
      delete planeMarkers[icao];
    }
  });
}

// ==========================================
// GESTION DES ONGLETS DE VOLS (EBCI / EBLG)
// ==========================================
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
    const flightType = (type === 'dep') ? 'departures' : 'arrivals';
    loadFlightType(flightType, container, airport.toUpperCase());
  }
}

// ==========================================
// 4. DATA DES SONOMÈTRES EBCI ET EBLG
// ==========================================
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

// ==========================================
// 5. ÉTAT DES PISTES EN SERVICE
// ==========================================
let currentRunwayEBCI = "24"; 
let currentRunwayEBLG = "22"; 

// ==========================================
// 6. CONVERTISSEUR COORDONNÉES DMS -> DD
// ==========================================
function dmsToDecimal(dmsStr) {
  const parts = dmsStr.trim().split(/\s+/);
  const degrees = parseFloat(parts[0]);
  const minutes = parseFloat(parts[1]);
  const seconds = parseFloat(parts[2]);
  const direction = parts[3];

  let dd = degrees + minutes / 60 + seconds / 3600;
  if (direction === "S" || direction === "W") {
    dd = -dd;
  }
  return dd;
}

// ==========================================
// 7. LOGIQUE DES COULEURS PAR PISTE
// ==========================================
function getSonometerColor(id, airport) {
  if (airport === "EBLG") {
    if (currentRunwayEBLG === "22") {
      return "#10b981"; 
    } else if (currentRunwayEBLG === "04") {
      const redListEBLG = ["F004", "F005", "F006", "F010", "F012", "F016", "F017"];
      return redListEBLG.includes(id) ? "#ef4444" : "#10b981";
    }
  }

  if (airport === "EBCI") {
    if (currentRunwayEBCI === "24") {
      return "#10b981"; 
    } else if (currentRunwayEBCI === "06") {
      const redListEBCI = ["F114", "F116", "F117", "F118"];
      return redListEBCI.includes(id) ? "#ef4444" : "#10b981";
    }
  }

  return "#10b981";
}

// ==========================================
// 8. AFFICHAGE SUR LA CARTE LEAFLET
// ==========================================
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

    marker.bindPopup(`
      <div style="color: #0f172a; font-family: sans-serif;">
        <b style="font-size: 1.05rem;">Sonomètre ${s.id} (${s.airport})</b><br>
        <span style="font-size:0.85rem; color: #475569;">${s.address}</span><hr style="margin:6px 0; border:0; border-top:1px solid #cbd5e1;">
        <b>Piste active :</b> Piste ${activeRunway}<br>
        <b>Statut :</b> <span style="color:${color}; font-weight:bold;">${statusText}</span>
      </div>
    `);

    sonometerMarkers.push(marker);
  });
}

// ==========================================
// 9. BASCULEMENT DES PISTES (UI)
// ==========================================
function setRunwayEBCI(runwayNum, map) {
  currentRunwayEBCI = runwayNum;
  renderSonometersOnMap(map);
}

function setRunwayEBLG(runwayNum, map) {
  currentRunwayEBLG = runwayNum;
  renderSonometersOnMap(map);
}

// =================================================================
// 10. VOLS & MÉTÉO
// =================================================================
async function fetchFlightsData(specificAirport = null) {
  const ebciBody = document.getElementById("ebci-flights-body");
  const eblgBody = document.getElementById("eblg-flights-body");

  if (specificAirport) {
    const targetBody = specificAirport === "EBCI" ? ebciBody : eblgBody;
    if (targetBody) await loadFlightType("departures", targetBody, specificAirport);
    return;
  }

  if (ebciBody) await loadFlightType("departures", ebciBody, "EBCI");
  if (eblgBody) await loadFlightType("departures", eblgBody, "EBLG");
}

async function loadFlightType(type, elementContainer, airport) {
  try {
    const response = await fetch(`${WORKER_BASE_URL}/api/fids?airport=${airport}&type=${type}`);
    if (!response.ok) return;

    const data = await response.json();
    if (data && Array.isArray(data.flights) && data.flights.length > 0) {
      elementContainer.innerHTML = data.flights
        .map(
          (f) => `
            <tr>
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

async function fetchWeatherData() {
  loadAirportWeather(AIRPORTS.EBLG.lat, AIRPORTS.EBLG.lon, "EBLG", "eblg-temp", "eblg-metar");
  loadAirportWeather(AIRPORTS.EBCI.lat, AIRPORTS.EBCI.lon, "EBCI", "ebci-temp", "ebci-metar");
}

async function loadAirportWeather(lat, lon, station, tempElemId, metarElemId) {
  try {
    const resWeather = await fetch(`${WORKER_BASE_URL}/api/weather?lat=${lat}&lon=${lon}`);
    const resMetar = await fetch(`${WORKER_BASE_URL}/api/metar?station=${station}`);

    if (resWeather.ok) {
      const weather = await resWeather.json();
      const tempEl = document.getElementById(tempElemId);
      if (tempEl && weather.main) tempEl.innerText = `${Math.round(weather.main.temp)}°C`;
    }

    if (resMetar.ok) {
      const metar = await resMetar.json();
      const metarEl = document.getElementById(metarElemId);
      if (metarEl && metar.raw) metarEl.innerText = metar.raw;
    }
  } catch (err) {
    console.error(`Erreur météo ${station} :`, err);
  }
}

// Initialisation au chargement de la page
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initMap);
} else {
  initMap();
}
