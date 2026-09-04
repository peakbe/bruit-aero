// =================================================================
// 1. CONFIGURATION ET VARIABLES GLOBALES
// =================================================================
var WORKER_BASE_URL = "https://bruit-aero-proxy.pnyr682w7f.workers.dev";

var map = map || null;
var planeMarkers = planeMarkers || {};
// Traces historiques ADS-B (PRO+++)
var adsbTracks = {}; // key = callsign/icao24, value = { positions: [], lastUpdate: timestamp }
// [CORRECTION BUG 3] objets Leaflet des traces / trajectoires futures, indexés par clé,
// pour pouvoir les mettre à jour au lieu de les recréer à chaque cycle
var trackLines = {};
var futureLines = {};
var currentAirport = currentAirport || "EBLG";
var flightsGroup = flightsGroup || null;
var radarMode = "all"; // all | approach | departure | enroute

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
// 3. UTILITAIRES
// =================================================================
function parseCallsign(flightStr) {
  if (!flightStr) return { raw: "", prefix: "", number: "" };
  const clean = flightStr.replace(/\s+/g, '').toUpperCase();
  const match = clean.match(/^([A-Z0-9]{2,3})?(\d+[A-Z]*)$/);
  return { raw: clean, prefix: match ? match[1] || "" : "", number: match ? match[2] : "" };
}

function calculateEstimatedCoords(airportKey, cityStr, type) {
  const airport = AIRPORTS[airportKey] || AIRPORTS.EBCI;
  let targetCoords = [50.8503, 4.3517]; // Bruxelles par défaut si ville inconnue

  for (const [code, coords] of Object.entries(CITY_COORDS)) {
    if (cityStr && cityStr.includes(code)) {
      targetCoords = coords;
      break;
    }
  }

  const toRad = deg => deg * Math.PI / 180;
  const toDeg = rad => rad * 180 / Math.PI;

  // Cap réel vers la destination
  const dLonRad = toRad(targetCoords[1] - airport.lon);
  const y = Math.sin(dLonRad) * Math.cos(toRad(targetCoords[0]));
  const x = Math.cos(toRad(airport.lat)) * Math.sin(toRad(targetCoords[0])) - Math.sin(toRad(airport.lat)) * Math.cos(toRad(targetCoords[0])) * Math.cos(dLonRad);
  const heading = (toDeg(Math.atan2(y, x)) + 360) % 360;

  // Distance FIXE en km depuis l'aéroport (pas un % du trajet total)
  // -> reste réaliste même pour un vol long-courrier (Houston, New York, Zhengzhou...)
  const fixedDistanceKm = type === 'departures' ? 8 : 15;

  // Point de destination à distance/cap donnés (formule du grand cercle)
  const angDist = fixedDistanceKm / 6371;
  const lat1 = toRad(airport.lat);
  const lon1 = toRad(airport.lon);
  const headingRad = toRad(heading);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angDist) +
    Math.cos(lat1) * Math.sin(angDist) * Math.cos(headingRad)
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(headingRad) * Math.sin(angDist) * Math.cos(lat1),
    Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2)
  );

  return { lat: toDeg(lat2), lon: toDeg(lon2), heading };
}

// fonction PRO+++ pour dessiner un cône ILS
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
    [lat, lon],
    [leftLat, leftLon],
    [endLat, endLon],
    [rightLat, rightLon]
  ], {
    color: "cyan",
    weight: 2,
    opacity: 0.8,
    fillOpacity: 0.1
  });

  cone.addTo(map);
  return cone;
}

function distKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat/2)**2 +
    Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) *
    Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// =================================================================
// FUTURE PATH IFR (PRO+++)
// =================================================================
function computeFuturePath(lat, lon, headingDeg, speedMs, secondsAhead = 60) {
  if (!lat || !lon || !headingDeg || !speedMs) return [];

  const headingRad = headingDeg * Math.PI / 180;
  const distanceKm = (speedMs * secondsAhead) / 1000; // m/s → km
  const kmToDeg = distanceKm / 111;

  const futureLat = lat + kmToDeg * Math.cos(headingRad);
  const futureLon = lon + kmToDeg * Math.sin(headingRad);

  return [
    [lat, lon],
    [futureLat, futureLon]
  ];
}

// =================================================================
// ON FINAL : Détection automatique (PRO+++)
// =================================================================
function isOnFinal(plane, airport) {
  if (!plane || !plane.lat || !plane.lon) return false;

  const apt = AIRPORTS[airport];
  const d = distKm(plane.lat, plane.lon, apt.lat, apt.lon);

  // Trop loin → pas en finale
  if (d > 12) return false;

  const alt = plane.altitude || 0;
  const gs = plane.speed ? plane.speed * 3.6 : 0;

  // Altitude trop haute → pas en finale
  if (alt > 2500) return false;

  // Vitesse trop élevée → pas en finale
  if (gs > 350) return false;

  // Déterminer heading de la piste active
  const rwyHeading =
    airport === "EBLG"
      ? (currentRunwayEBLG === "22" ? 220 : 40)
      : (currentRunwayEBCI === "24" ? 240 : 60);

  // Angle avion → axe de piste
  const diff = Math.abs(plane.heading - rwyHeading);
  const angle = diff > 180 ? 360 - diff : diff;

  // Trop décalé → pas en finale
  if (angle > 15) return false;

  return true;
}

// =================================================================
// CLASSIFICATION IFR : approche / départ / en‑route (PRO+++)
// =================================================================
function classifyFlightPhase(plane, airport) {
  if (!plane || !plane.lat || !plane.lon) return "enroute";

  const apt = AIRPORTS[airport];
  const d = distKm(plane.lat, plane.lon, apt.lat, apt.lon);

  const alt = plane.altitude || 0;
  const gs = plane.speed ? plane.speed * 3.6 : 0; // m/s → km/h

  // APPROCHE : proche + altitude basse + vitesse modérée
  if (d < 18 && alt < 2000 && gs < 350) return "approach";

  // DÉPART : proche + montée + vitesse en augmentation
  if (d < 10 && alt < 3000 && gs > 200) return "departure";

  // EN‑ROUTE : tout le reste
  return "enroute";
}

// =================================================================
// 4. RADAR TEMPS RÉEL GPS (PRIORITÉ ABSOLUE AUX POSITIONS DIRECTES)
// =================================================================
async function renderFidsPlanesOnMap(map, flightsLayerGroup) {
  if (!flightsLayerGroup) return;
  const currentActiveKeys = new Set();
  const hasRotationPlugin = typeof L.Marker.prototype.setRotationAngle === "function";

  try {
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
        lat: state[6],   // Position Latitude GPS exacte
        lon: state[5],   // Position Longitude GPS exacte
        heading: state[10] || 0,
        altitude: state[7],
        speed: state[9]
      };
    }).filter(p => p.lat !== null && p.lon !== null);

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

    // A. TRAITEMENT DES POSITIONS GPS RÉELLES
    livePlanes.forEach(plane => {
      const primaryKey = plane.callsign || plane.icao24;

      const matchingFids = fidsList.find(f => {
        const icaoPrefix = IATA_TO_ICAO[f.parsed.prefix] || f.parsed.prefix;
        const targetCallsign = `${icaoPrefix}${f.parsed.number}`;
        return plane.callsign === targetCallsign || plane.callsign === f.parsed.raw || (plane.numberOnly && plane.numberOnly === f.parsed.number);
      });

      // Déterminer phase de vol IFR et appliquer le filtre radar AVANT de dessiner
      // [CORRECTION BUG 3] on calcule la phase et on applique le filtre radarMode
      // avant de toucher aux traces / trajectoires, pour ne jamais dessiner ce qui
      // doit être filtré.
      const phase = classifyFlightPhase(plane, matchingFids ? matchingFids.airport : currentAirport);
      if (radarMode !== "all" && radarMode !== phase) return;

      const altText = plane.altitude ? `${Math.round(plane.altitude)} m` : "En vol";
      const speedText = plane.speed ? `${Math.round(plane.speed * 3.6)} km/h` : "N/C";

      let popupContent = `
        <div style="font-family: sans-serif; font-size: 13px;">
          <h3 style="margin: 0 0 5px 0; color: #1e293b;">Vol ${plane.callsign || "Inconnu"}</h3>
          <b>Altitude :</b> ${altText}<br>
          <b>Vitesse :</b> ${speedText}<br>
          <b>Source :</b> <span style="color: #22c55e; font-weight: bold;">📡 Position GPS Directe</span>
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
            <b>Source :</b> <span style="color: #22c55e; font-weight: bold;">📡 Position GPS Directe</span>
          </div>
        `;
      }

      // =================================================================
      // TRACES HISTORIQUES ADS-B (PRO+++)
      // [CORRECTION BUG 3] on met à jour la polyline existante au lieu d'en
      // recréer une nouvelle à chaque cycle (évite l'accumulation infinie)
      // =================================================================
      const trackKey = primaryKey;

      if (!adsbTracks[trackKey]) {
        adsbTracks[trackKey] = { positions: [], lastUpdate: Date.now() };
      }

      adsbTracks[trackKey].positions.push([plane.lat, plane.lon]);
      adsbTracks[trackKey].lastUpdate = Date.now();

      if (adsbTracks[trackKey].positions.length > 40) {
        adsbTracks[trackKey].positions.shift();
      }

      const trackColor = "#00e1ff"; // cyan Airbus ND
      if (trackLines[trackKey]) {
        trackLines[trackKey].setLatLngs(adsbTracks[trackKey].positions);
        if (!flightsLayerGroup.hasLayer(trackLines[trackKey])) {
          flightsLayerGroup.addLayer(trackLines[trackKey]);
        }
      } else {
        trackLines[trackKey] = L.polyline(adsbTracks[trackKey].positions, {
          color: trackColor,
          weight: 2,
          opacity: 0.7
        }).addTo(flightsLayerGroup);
      }

      // =================================================================
      // FUTURE PATH IFR (PRO+++)
      // [CORRECTION BUG 3] idem : mise à jour au lieu de recréation
      // =================================================================
      const futurePath = computeFuturePath(
        plane.lat,
        plane.lon,
        plane.heading,
        plane.speed
      );

      if (futurePath.length === 2) {
        if (futureLines[trackKey]) {
          futureLines[trackKey].setLatLngs(futurePath);
          if (!flightsLayerGroup.hasLayer(futureLines[trackKey])) {
            flightsLayerGroup.addLayer(futureLines[trackKey]);
          }
        } else {
          futureLines[trackKey] = L.polyline(futurePath, {
            color: "#00e1ff", // cyan Airbus ND
            weight: 2,
            dashArray: "6, 6",
            opacity: 0.9
          }).addTo(flightsLayerGroup);
        }
      }

      // =================================================================
      // ON FINAL : Détection IFR (PRO+++)
      // =================================================================
      const onFinal = isOnFinal(plane, matchingFids ? matchingFids.airport : currentAirport);

      if (onFinal) {
        popupContent += `
          <div style="margin-top:6px; padding:4px; background:#dcfce7; border-left:4px solid #16a34a;">
            <b>🛬 On Final</b><br>
            Approche stabilisée ILS
          </div>
        `;
      }

      // Mise à jour sur la carte avec les coordonnées GPS réelles
      const m = updateOrAddMarker(primaryKey, plane.lat, plane.lon, plane.heading, popupContent, flightsLayerGroup, hasRotationPlugin);
      currentActiveKeys.add(primaryKey);

      if (onFinal) {
        L.circle([plane.lat, plane.lon], {
          radius: 300,
          color: "#16a34a",
          weight: 2,
          opacity: 0.6,
          fillOpacity: 0.1
        }).addTo(flightsLayerGroup);
      }

      planeMarkers[primaryKey] = m;
      if (plane.callsign) { planeMarkers[plane.callsign] = m; currentActiveKeys.add(plane.callsign); }
      if (plane.numberOnly) { planeMarkers[plane.numberOnly] = m; currentActiveKeys.add(plane.numberOnly); }
      if (matchingFids) {
        const cleanMatchKey = matchingFids.flight.replace(/\s+/g, '');
        planeMarkers[cleanMatchKey] = m;
        currentActiveKeys.add(cleanMatchKey);
      }
    });

    // B. FALLBACK FIDS (Uniquement pour les vols sans signal GPS direct)
    fidsList.forEach(fids => {
      const cleanFlight = fids.flight.replace(/\s+/g, '');
      const icaoPrefix = IATA_TO_ICAO[fids.parsed.prefix] || fids.parsed.prefix;
      const radarCallsign = `${icaoPrefix}${fids.parsed.number}`;

      const alreadyHasGps = currentActiveKeys.has(radarCallsign) || currentActiveKeys.has(cleanFlight) || currentActiveKeys.has(fids.parsed.number);

      const statusLower = (fids.status || "").toLowerCase();
      const isScheduled = /programm|scheduled/.test(statusLower);

      if (!alreadyHasGps && isScheduled) {
        const est = calculateEstimatedCoords(fids.airport, fids.city, fids.type);

        const phase = classifyFlightPhase(est, fids.airport);
        if (radarMode !== "all" && radarMode !== phase) return;

        const popupContent = `
          <div style="font-family: sans-serif; font-size: 13px;">
            <h3 style="margin: 0 0 5px 0; color: #1e293b;">Vol ${fids.flight} (${fids.type === 'departures' ? 'Départ' : 'Arrivée'})</h3>
            <b>Aéroport :</b> ${fids.airport}<br>
            <b>Destination/Origine :</b> ${fids.city}<br>
            <b>Heure :</b> ${fids.time}<br>
            <b>Statut :</b> ${fids.status}<br>
            <b>Source :</b> <span style="color: #ef4444; font-weight: bold;">⚠️ Pas de Signal GPS (Position Estimée)</span>
          </div>
        `;

        const m = updateOrAddMarker(cleanFlight, est.lat, est.lon, est.heading, popupContent, flightsLayerGroup, hasRotationPlugin);
        currentActiveKeys.add(cleanFlight);

        planeMarkers[cleanFlight] = m;
        if (fids.parsed.number) { planeMarkers[fids.parsed.number] = m; currentActiveKeys.add(fids.parsed.number); }
        if (radarCallsign) { planeMarkers[radarCallsign] = m; currentActiveKeys.add(radarCallsign); }
      }
    });

    // Nettoyage des marqueurs inactifs
    Object.keys(planeMarkers).forEach(key => {
      if (!currentActiveKeys.has(key) && planeMarkers[key]) {
        flightsLayerGroup.removeLayer(planeMarkers[key]);
        delete planeMarkers[key];
      }
    });

    // Nettoyage des traces trop anciennes (60 secondes sans mise à jour)
    // [CORRECTION BUG 3] on retire aussi les polylines de la carte, pas seulement
    // l'entrée adsbTracks — sinon les lignes restaient affichées pour toujours
    Object.keys(adsbTracks).forEach(key => {
      if (Date.now() - adsbTracks[key].lastUpdate > 60000) {
        if (trackLines[key]) { flightsLayerGroup.removeLayer(trackLines[key]); delete trackLines[key]; }
        if (futureLines[key]) { flightsLayerGroup.removeLayer(futureLines[key]); delete futureLines[key]; }
        delete adsbTracks[key];
      }
    });

  } catch (err) {
    console.error("Erreur mise à jour radar GPS :", err);
  }
}

function updateOrAddMarker(key, lat, lon, heading, popupContent, layerGroup, hasRotation) {
  let marker = planeMarkers[key];
  if (marker) {
    marker.setLatLng([lat, lon]);
    if (hasRotation) marker.setRotationAngle(heading);
    marker.getPopup().setContent(popupContent);
    if (!layerGroup.hasLayer(marker)) {
      layerGroup.addLayer(marker);
    }
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

// =================================================================
// 5. SÉLECTION DU VOL DEPUIS LE TABLEAU
// =================================================================
function selectFlightOnMap(flightNum) {
  const cleanKey = flightNum.replace(/\s+/g, '').toUpperCase();
  const parsed = parseCallsign(cleanKey);

  const icaoPrefix = IATA_TO_ICAO[parsed.prefix] || parsed.prefix;
  const targetCallsign = `${icaoPrefix}${parsed.number}`;

  let marker = planeMarkers[cleanKey] || planeMarkers[targetCallsign] || planeMarkers[parsed.number];

  if (marker) {
    if (!flightsGroup.hasLayer(marker)) {
      flightsGroup.addLayer(marker);
    }
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

// =================================================================
// AUTO : Détection piste active selon vent (logique ATC réelle)
// =================================================================
function autoSelectRunway(airport, windDeg, windSpeed) {
  const RWYS = {
    EBLG: [
      { num: "22", heading: 220 },
      { num: "04", heading: 40 }
    ],
    EBCI: [
      { num: "24", heading: 240 },
      { num: "06", heading: 60 }
    ]
  }[airport];

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

  if (airport === "EBLG") currentRunwayEBLG = bestRunway.num;
  if (airport === "EBCI") currentRunwayEBCI = bestRunway.num;

  // Mise à jour immédiate des sonomètres
  if (map) renderSonometersOnMap(map);
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

  // =================================================================
  // ILS : Affichage automatique du cône selon piste active
  // [CORRECTION BUG 2] ce bloc était auparavant DANS la boucle forEach
  // ci-dessous : il vidait window.ilsConeLayer à chaque sonomètre, ce qui
  // effaçait systématiquement le cône EBCI dès qu'un sonomètre EBLG était
  // traité (car EBCI est listé en premier dans allSonometers). Il est
  // maintenant exécuté UNE SEULE FOIS, avant la boucle, pour les deux
  // aéroports.
  // =================================================================
  if (window.ilsConeLayer) {
    window.ilsConeLayer.clearLayers();
  } else {
    window.ilsConeLayer = L.layerGroup().addTo(map);
  }

  function addCone(lat, lon, heading) {
    const cone = drawILSCone(lat, lon, heading);
    window.ilsConeLayer.addLayer(cone);
  }

  if (currentRunwayEBLG === "22") addCone(AIRPORTS.EBLG.lat, AIRPORTS.EBLG.lon, 220);
  if (currentRunwayEBLG === "04") addCone(AIRPORTS.EBLG.lat, AIRPORTS.EBLG.lon, 40);
  if (currentRunwayEBCI === "24") addCone(AIRPORTS.EBCI.lat, AIRPORTS.EBCI.lon, 240);
  if (currentRunwayEBCI === "06") addCone(AIRPORTS.EBCI.lat, AIRPORTS.EBCI.lon, 60);

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

// =================================================================
// [AJOUT] Direction cardinale du vent (rose à 8 points, notation FR)
// =================================================================
const WIND_CARDINALS = [
  { abbr: "N",   full: "Nord" },
  { abbr: "N-E", full: "Nord-Est" },
  { abbr: "E",   full: "Est" },
  { abbr: "S-E", full: "Sud-Est" },
  { abbr: "S",   full: "Sud" },
  { abbr: "S-O", full: "Sud-Ouest" },
  { abbr: "O",   full: "Ouest" },
  { abbr: "N-O", full: "Nord-Ouest" }
];

function degToCardinal(deg) {
  const normalized = ((deg % 360) + 360) % 360;
  const index = Math.round(normalized / 45) % 8;
  return WIND_CARDINALS[index];
}

// =================================================================
// [CORRECTION] La rose des vents était définie deux fois : une version
// "riche" (N/E/S/O, vitesse) directement dans le <script> du HTML, et
// cette version simplifiée ici dans app.js. Comme app.js est chargé
// APRÈS le script inline, cette dernière écrasait silencieusement la
// version riche dès que les données météo réelles arrivaient — la rose
// perdait ses repères N/E/S/O et l'affichage de la vitesse. Il n'y a
// désormais plus qu'une seule version, ici, qui reprend les repères
// cardinaux et ajoute le texte de direction (N, S, S-E, ...) sous la
// rose, via l'élément #wind-dir-<station> s'il existe dans le HTML.
// =================================================================
function drawCompass(canvasId, windDeg, windSpeedKmh = null) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = Math.min(centerX, centerY) - 5;

  // Cercle extérieur
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Repères N / E / S / O (fixes, ne tournent pas avec le vent)
  ctx.fillStyle = "#94a3b8";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("N", centerX, centerY - radius + 10);
  ctx.fillText("S", centerX, centerY + radius - 10);
  ctx.fillText("E", centerX + radius - 10, centerY);
  ctx.fillText("O", centerX - radius + 10, centerY);

  // Flèche de direction (pointe vers d'où vient le vent, convention météo)
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate((windDeg * Math.PI) / 180);

  ctx.beginPath();
  ctx.moveTo(0, -radius + 16);
  ctx.lineTo(-6, 8);
  ctx.lineTo(6, 8);
  ctx.closePath();
  ctx.fillStyle = "#38bdf8";
  ctx.fill();

  ctx.restore();

  // Vitesse au centre, si fournie
  if (windSpeedKmh !== null && windSpeedKmh !== undefined) {
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${Math.round(windSpeedKmh)} km/h`, centerX, centerY + radius * 0.55);
  }

  // Mise à jour du libellé texte de direction cardinale (N, S, S-E, ...)
  const cardinal = degToCardinal(windDeg);
  const labelEl = document.getElementById(canvasId.replace("compass-", "wind-dir-"));
  if (labelEl) {
    labelEl.textContent = `Vent du ${cardinal.full} (${cardinal.abbr}) — ${Math.round(windDeg)}°`;
  }
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

// =================================================================
// [CORRECTION BUG 1] Fonction réécrite : `weather` était utilisée en dehors
// du bloc `if (resWeather.ok) { const weather = ... }` où elle était
// déclarée, ce qui provoquait un ReferenceError à chaque appel (avalé
// silencieusement par le catch global) et empêchait `autoSelectRunway`
// de jamais s'exécuter. Le code dupliqué de mise à jour de tempEl a
// aussi été supprimé.
// =================================================================
async function loadAirportWeather(lat, lon, station, tempElemId, metarElemId, forecastElemId) {
  try {
    const resWeather = await fetch(`${WORKER_BASE_URL}/api/weather?lat=${lat}&lon=${lon}`);
    const resMetar = await fetch(`${WORKER_BASE_URL}/api/metar?station=${station}`);

    if (resWeather.ok) {
      const weather = await resWeather.json();
      const tempEl = document.getElementById(tempElemId);

      if (tempEl && weather.main) {
        tempEl.innerHTML = `<strong>${Math.round(weather.main.temp)}°C</strong> | 💨 ${msToKmh(weather.wind?.speed || 0)} km/h`;
        drawCompass(`compass-${station.toLowerCase()}`, weather.wind?.deg || 0, msToKmh(weather.wind?.speed || 0));
      }

      autoSelectRunway(station, weather.wind?.deg || 0, weather.wind?.speed || 0);
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
