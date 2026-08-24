// =================================================================
// 1. CONFIGURATION & VARIABLES GLOBALES
// =================================================================
const WORKER_BASE_URL = "https://bruit-aero-proxy.pnyr682w7f.workers.dev";

let map;
let planeMarkers = {}; 

const EBLG_LAT = 50.6374, EBLG_LON = 5.4432;
const EBCI_LAT = 50.4592, EBCI_LON = 4.4538;

// =================================================================
// 2. INITIALISATION CARTE
// =================================================================
function initMap() {
  const mapContainer = document.getElementById("map");
  if (!mapContainer) return;

  map = L.map("map").setView([50.55, 4.95], 9);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap",
  }).addTo(map);

  // Repères fixes des aéroports
  L.marker([EBLG_LAT, EBLG_LON]).addTo(map).bindPopup("<b>Liège Airport (EBLG)</b>");
  L.marker([EBCI_LAT, EBCI_LON]).addTo(map).bindPopup("<b>Charleroi Airport (EBCI)</b>");

  fetchRadarData();
  fetchFlightsData();
  fetchWeatherData();

  setInterval(fetchRadarData, 8000);
  setInterval(fetchFlightsData, 120000);
  setInterval(fetchWeatherData, 300000);
}

// =================================================================
// 3. GESTION DU RADAR VOLS
// =================================================================
async function fetchRadarData() {
  try {
    const response = await fetch(`${WORKER_BASE_URL}/api/opensky`);
    if (!response.ok) return;

    const data = await response.json();
    if (data && Array.isArray(data.states)) {
      updatePlaneMarkers(data.states);
    }
  } catch (error) {
    console.error("Erreur radar :", error);
  }
}

// Définition de l'icône d'avion jaune (SVG)
const yellowPlaneIcon = L.divIcon({
  className: "custom-plane-icon",
  html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="30" height="30">
           <path fill="#FFD700" stroke="#000000" stroke-width="1" d="M21,16v-2l-8-5V3.5C13,2.67,12.33,2,11.5,2S10,2.67,10,3.5V9l-8,5v2l8-2.5V19l-2,1.5V22l3.5-1l3.5,1v-1.5L13,19v-5.5L21,16z"/>
         </svg>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15], // Centre de rotation
});

function updatePlaneMarkers(states) {
  if (!map) return;
  const currentIcaos = new Set();

  states.forEach((flight) => {
    const icao24 = flight[0];
    const callsign = (flight[1] || "Inconnu").trim();
    const longitude = flight[5];
    const latitude = flight[6];
    const altitude = flight[7] !== null ? `${flight[7]} m` : "N/C";
    const speed = flight[9] !== null ? `${Math.round(flight[9] * 3.6)} km/h` : "N/C";
    const heading = flight[10] || 0; // Cap en degrés (0° à 360°)

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

      // Si l'avion existe déjà, mise à jour de la position et de l'orientation
      if (planeMarkers[icao24]) {
        planeMarkers[icao24].setLatLng([latitude, longitude]);
        planeMarkers[icao24].setRotationAngle(heading);
        planeMarkers[icao24].getPopup().setContent(popupContent);
      } 
      // Création du nouvel avion avec l'icône jaune
      else {
        const marker = L.marker([latitude, longitude], {
          icon: yellowPlaneIcon,
          rotationAngle: heading,
          rotationOrigin: "center center"
        }).bindPopup(popupContent);

        marker.addTo(map);
        planeMarkers[icao24] = marker;
      }
    }
  });

  // Nettoyage des avions hors de portée
  Object.keys(planeMarkers).forEach((icao) => {
    if (!currentIcaos.has(icao)) {
      map.removeLayer(planeMarkers[icao]);
      delete planeMarkers[icao];
    }
  });
}

// =================================================================
// 4. VOLS DÉPARTS / ARRIVÉES
// =================================================================
async function fetchFlightsData() {
  const containerDepartures = document.getElementById("departures-list");
  const containerArrivals = document.getElementById("arrivals-list");

  if (containerDepartures) await loadFlightType("departures", containerDepartures);
  if (containerArrivals) await loadFlightType("arrivals", containerArrivals);
}

async function loadFlightType(type, elementContainer) {
  try {
    const response = await fetch(`${WORKER_BASE_URL}/api/fids?airport=EBLG&type=${type}`);
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
    }
  } catch (error) {
    console.error(`Erreur vols (${type}) :`, error);
  }
}

// =================================================================
// 5. GESTION MÉTÉO (EBLG + EBCI)
// =================================================================
async function fetchWeatherData() {
  // 1. Météo EBLG (Liège)
  loadAirportWeather(EBLG_LAT, EBLG_LON, "EBLG", "eblg-temp", "eblg-metar");
  // 2. Météo EBCI (Charleroi)
  loadAirportWeather(EBCI_LAT, EBCI_LON, "EBCI", "ebci-temp", "ebci-metar");
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

// =================================================================
// 6. DÉMARRAGE
// =================================================================
document.addEventListener("DOMContentLoaded", () => {
  initMap();
});
