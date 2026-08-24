// =================================================================
// 1. CONFIGURATION & VARIABLES GLOBALES
// =================================================================
const WORKER_BASE_URL = "https://bruit-aero-proxy.pnyr682w7f.workers.dev";

let map;
let planeMarkers = {}; // Stocke les marqueurs d'avions Leaflet par ICAO24
let lastValidStates = []; // Cache des derniers vols pour éviter la disparition des marqueurs

// Coordonnées de l'aéroport de Liège (EBLG)
const EBLG_LAT = 50.6374;
const EBLG_LON = 5.4432;

// =================================================================
// 2. INITIALISATION DE LA CARTE LEAFLET
// =================================================================
function initMap() {
  // Recherche de l'élément HTML de la carte
  const mapContainer = document.getElementById("map");
  if (!mapContainer) {
    console.warn("Conteneur #map non trouvé dans le DOM.");
    return;
  }

  // Initialisation de Leaflet centrée sur la zone de Liège
  map = L.map("map").setView([EBLG_LAT, EBLG_LON], 9);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap",
  }).addTo(map);

  // Marqueur fixe pour l'aéroport EBLG
  L.marker([EBLG_LAT, EBLG_LON])
    .addTo(map)
    .bindPopup("<b>Aéroport de Liège (EBLG)</b>");

  // Premier chargement des données
  fetchRadarData();
  fetchFlightsData();

  // Boucles de rafraîchissement (8s pour le radar, 2 min pour les vols)
  setInterval(fetchRadarData, 8000);
  setInterval(fetchFlightsData, 120000);
}

// =================================================================
// 3. GESTION DU RADAR VOLS (ANTI-DISPARITION ET CACHE)
// =================================================================
async function fetchRadarData() {
  try {
    const response = await fetch(`${WORKER_BASE_URL}/api/opensky`);

    if (!response.ok) {
      console.warn("API Radar indisponible, conservation des avions actuels.");
      return;
    }

    const data = await response.json();

    // On ne rafraîchit la carte que si le serveur renvoie un tableau valide d'avions
    if (data && Array.isArray(data.states) && data.states.length > 0) {
      lastValidStates = data.states; // Mise à jour du cache local
      updatePlaneMarkers(data.states);
    } else {
      console.warn("Réponse radar vide. Les avions affichés sont conservés.");
    }
  } catch (error) {
    console.error("Erreur lors de la récupération des données radar :", error);
  }
}

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
    const heading = flight[10] || 0;

    if (latitude !== null && longitude !== null) {
      currentIcaos.add(icao24);

      const popupContent = `
        <div style="font-family: sans-serif; font-size: 13px;">
          <strong>Vol : ${callsign}</strong><br/>
          ICAO : ${icao24.toUpperCase()}<br/>
          Altitude : ${altitude}<br/>
          Vitesse : ${speed}
        </div>
      `;

      // Si l'avion existe déjà, mise à jour fluide de sa position
      if (planeMarkers[icao24]) {
        planeMarkers[icao24].setLatLng([latitude, longitude]);
        planeMarkers[icao24].getPopup().setContent(popupContent);

        if (typeof planeMarkers[icao24].setRotationAngle === "function") {
          planeMarkers[icao24].setRotationAngle(heading);
        }
      } 
      // Sinon, création d'un nouveau marqueur
      else {
        const marker = L.marker([latitude, longitude]).bindPopup(popupContent);
        marker.addTo(map);
        planeMarkers[icao24] = marker;
      }
    }
  });

  // Nettoyage optionnel des avions qui ne sont plus détectés
  Object.keys(planeMarkers).forEach((icao) => {
    if (!currentIcaos.has(icao)) {
      map.removeLayer(planeMarkers[icao]);
      delete planeMarkers[icao];
    }
  });
}

// =================================================================
// 4. GESTION DES VOLS AU DÉPART ET À L'ARRIVÉE (FIDS)
// =================================================================
async function fetchFlightsData() {
  const containerDepartures = document.getElementById("departures-list");
  const containerArrivals = document.getElementById("arrivals-list");

  if (containerDepartures) {
    await loadFlightType("departures", containerDepartures);
  }

  if (containerArrivals) {
    await loadFlightType("arrivals", containerArrivals);
  }
}

async function loadFlightType(type, elementContainer) {
  try {
    const response = await fetch(`${WORKER_BASE_URL}/api/fids?airport=EBLG&type=${type}`);

    if (!response.ok) {
      elementContainer.innerHTML = "<tr><td colspan='4'>Données indisponibles</td></tr>";
      return;
    }

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
      elementContainer.innerHTML = "<tr><td colspan='4'>Données indisponibles</td></tr>";
    }
  } catch (error) {
    console.error(`Erreur chargement vols (${type}) :`, error);
    elementContainer.innerHTML = "<tr><td colspan='4'>Données indisponibles</td></tr>";
  }
}

// =================================================================
// 5. GESTION DE LA MÉTÉO ET DES METAR (EXEMPLE)
// =================================================================
async function fetchWeatherData() {
  try {
    const resWeather = await fetch(`${WORKER_BASE_URL}/api/weather?lat=${EBLG_LAT}&lon=${EBLG_LON}`);
    const resMetar = await fetch(`${WORKER_BASE_URL}/api/metar?station=EBLG`);

    if (resWeather.ok) {
      const weather = await resWeather.json();
      const tempEl = document.getElementById("temp-value");
      if (tempEl && weather.main) {
        tempEl.innerText = `${Math.round(weather.main.temp)}°C`;
      }
    }

    if (resMetar.ok) {
      const metar = await resMetar.json();
      const metarEl = document.getElementById("metar-raw");
      if (metarEl && metar.raw) {
        metarEl.innerText = metar.raw;
      }
    }
  } catch (err) {
    console.error("Erreur météo/METAR :", err);
  }
}

// =================================================================
// 6. ÉVÉNEMENT DÉMARRAGE DU DOM
// =================================================================
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  fetchWeatherData();
});
