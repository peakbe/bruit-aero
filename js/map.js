import { sonoLayer, renderSonometers } from "./sono.js";

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
// 3. Cônes d'approche / départ — cockpit Airbus PRO+++
// ---------------------------------------------------------------
export function drawApproachDepartureCones(airport, lat, lon, windDeg) {

  // Nettoyage des anciens cônes
  if (!window.conePolygons) window.conePolygons = {};
  if (window.conePolygons[airport]) {
    window.conePolygons[airport].forEach(poly => map.removeLayer(poly));
  }
  window.conePolygons[airport] = [];

  // Détermination piste active
  const runway = airport === "EBLG"
    ? (windDeg > 180 ? 22 : 4)
    : (windDeg > 180 ? 24 : 6);

  const heading = runway * 10; // 22 → 220°, 04 → 40°, etc.

  // Longueur du cône (en mètres)
  const coneLength = 6000;

  // Calcul des points
  const rad = heading * Math.PI / 180;
  const dx = Math.sin(rad) * coneLength / 111320;
  const dy = Math.cos(rad) * coneLength / 111320;

  const p1 = [lat, lon];
  const p2 = [lat + dy, lon + dx];

  // Largeur du cône
  const spread = 0.02;

  const left = [p2[0] + spread, p2[1] - spread];
  const right = [p2[0] - spread, p2[1] + spread];

  // Polygone
  const cone = L.polygon([p1, left, right], {
    color: "#38bdf8",
    weight: 2,
    opacity: 0.7,
    fillOpacity: 0.15
  }).addTo(map);

  window.conePolygons[airport].push(cone);
}
