import { sonoLayer, renderSonometers } from "./sono.js";
import { ILS_CONFIG } from "./config-ILS.js";

// ===============================================================
// map.js — Radar ADS‑B + ND Airbus
// ===============================================================

export let map = null;
export const planesLayer = L.layerGroup();

// ---------------------------------------------------------------
// 1. Initialisation
// ---------------------------------------------------------------
export function initRadarMap() {
  if (map) return map;

  map = L.map("map").setView([50.55, 4.95], 8);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap"
  }).addTo(map);

  planesLayer.addTo(map);
  sonoLayer.addTo(map);

  return map;
}

// ---------------------------------------------------------------
// 2. Mise à jour ADS‑B
// ---------------------------------------------------------------
export async function updateRadar() {
  try {
    const res = await fetch("https://bruit-aero-proxy.pnyr682w7f.workers.dev/api/adsb");
    const data = await res.json();

    const active = new Set();

    (data.aircraft || []).forEach(p => {
      const hex = p.hex;
      if (!hex || !p.lat || !p.lon) return;

      active.add(hex);

      let marker = planesLayer.getLayer(hex);

      if (!marker) {
        marker = L.circleMarker([p.lat, p.lon], {
          radius: 5,
          color: "#3388ff",
          weight: 2,
          fillOpacity: 0.7
        });

        marker.options.data = p;
        planesLayer.addLayer(marker);

        planesLayer._layers[hex] = marker;

        marker.on("click", () => {
          centerOnAircraft(hex);
          highlightAircraft(hex);
          setSelectedAircraft(hex);
          updateFPV(hex);
        });
      }

      marker.setLatLng([p.lat, p.lon]);
      marker.options.data = p;
    });

    Object.keys(planesLayer._layers).forEach(hex => {
      if (!active.has(hex)) {
        planesLayer.removeLayer(planesLayer._layers[hex]);
        delete planesLayer._layers[hex];
      }
    });

  } catch (err) {
    console.error("Erreur radar ADS‑B:", err);
  }
}

setInterval(updateRadar, 5000);

// ---------------------------------------------------------------
// Cônes ILS avec gradient — cockpit Airbus PRO+++
// ---------------------------------------------------------------
export function drawApproachDepartureCones(airport, lat, lon, windDeg) {

  // Nettoyage
  if (!window.conePolygons) window.conePolygons = {};
  if (window.conePolygons[airport]) {
    window.conePolygons[airport].forEach(poly => map.removeLayer(poly));
  }
  window.conePolygons[airport] = [];

  // Détermination piste active
  const runway = airport === "EBLG"
    ? (windDeg > 180 ? 22 : 4)
    : (windDeg > 180 ? 24 : 6);

  const runwayNum = runway.toString();

  // 🔥 Récupération config ILS avancée
  const ils = ILS_CONFIG[airport].runways[runwayNum];

  const heading = ils.heading;
  const thresholdLat = ils.threshold.lat;
  const thresholdLon = ils.threshold.lon;

  // Remplace lat/lon du seuil par ceux du config-ILS
  const p1 = [thresholdLat, thresholdLon];

  // Calcul du cône
  const rad = heading * Math.PI / 180;
  const dx = Math.sin(rad) * ILS_CONE_LENGTH / 111320;
  const dy = Math.cos(rad) * ILS_CONE_LENGTH / 111320;

  const p2 = [thresholdLat + dy, thresholdLon + dx];

  const left = [p2[0] + ILS_CONE_SPREAD, p2[1] - ILS_CONE_SPREAD];
  const right = [p2[0] - ILS_CONE_SPREAD, p2[1] + ILS_CONE_SPREAD];

  // Gradient PRO+++
  const layers = [
    { opacity: 0.35, weight: 3 },
    { opacity: 0.22, weight: 2 },
    { opacity: 0.12, weight: 1 }
  ];

  layers.forEach(layer => {
    const poly = L.polygon([p1, left, right], {
      color: "#38bdf8",
      weight: layer.weight,
      opacity: layer.opacity,
      fillOpacity: layer.opacity * 0.6,
      smoothFactor: 1
    }).addTo(map);

    window.conePolygons[airport].push(poly);
  });
}

