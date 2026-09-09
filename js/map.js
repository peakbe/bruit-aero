// ===============================================================
// map.js — Radar ADS‑B + ND Airbus PRO+++
// ===============================================================

import { sonoLayer } from "./sono.js";
import { ILS_CONFIG } from "./config-ILS.js";
import {
  ILS_CONE_LENGTH,
  ILS_CONE_SPREAD,
  RADAR_REFRESH_MS,
  AIRPORT_COORDS
} from "./config.js";


export let map = null;
export const planesLayer = L.layerGroup();

if (!window.ilsLayers) window.ilsLayers = {};

// ===============================================================
// 1. INITIALISATION DE LA CARTE
// ===============================================================
export function initRadarMap() {
  if (map) return map;

  map = L.map("map").setView([AIRPORT_COORDS.ALL.lat, AIRPORT_COORDS.ALL.lon], 8);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap"
  }).addTo(map);

  planesLayer.addTo(map);
  sonoLayer.addTo(map);

  // Correction affichage Leaflet
  setTimeout(() => map.invalidateSize(), 200);

  return map;
}

// ===============================================================
// 2. RADAR ADS‑B — Mise à jour PRO+++
// ===============================================================
export async function updateRadar() {
  try {
    const res = await fetch(
      "https://bruit-aero-proxy.pnyr682w7f.workers.dev/api/adsb"
    );
    const data = await res.json();

    const active = new Set();

    (data.aircraft || []).forEach(p => {
      if (!p.hex || !p.lat || !p.lon) return;

      active.add(p.hex);

      let marker = null;

      planesLayer.eachLayer(m => {
        if (m._hex === p.hex) marker = m;
      });

      if (!marker) {
        marker = L.circleMarker([p.lat, p.lon], {
          radius: 5,
          color: "#38bdf8",
          weight: 2,
          fillColor: "#0ea5e9",
          fillOpacity: 0.8
        });

        marker._hex = p.hex;
        marker.options.data = p;

        marker.on("click", () => {
          centerOnAircraft(p.hex);
          highlightAircraft(p.hex);
          setSelectedAircraft(p.hex);
          updateFPV(p.hex);
        });

        planesLayer.addLayer(marker);
      }

      marker.setLatLng([p.lat, p.lon]);
      marker.options.data = p;
    });

    planesLayer.eachLayer(marker => {
      if (!active.has(marker._hex)) planesLayer.removeLayer(marker);
    });

  } catch (err) {
    console.error("Erreur radar ADS‑B:", err);
  }
}

setInterval(updateRadar, RADAR_REFRESH_MS);

// ===============================================================
// 3. ILS — Cône + LOC + Glidepath 3°
// ===============================================================
export function drawApproachDepartureCones(airport, lat, lon, windDeg) {

  if (!window.ilsLayers[airport]) window.ilsLayers[airport] = [];
  window.ilsLayers[airport].forEach(layer => map.removeLayer(layer));
  window.ilsLayers[airport] = [];

  const runway = airport === "EBLG"
    ? (windDeg > 180 ? "22" : "04")
    : (windDeg > 180 ? "24" : "06");

  const ils = ILS_CONFIG[airport].runways[runway];
  const heading = ils.heading;
  const threshold = [ils.threshold.lat, ils.threshold.lon];

  const rad = heading * Math.PI / 180;
  const dx = Math.sin(rad) * ILS_CONE_LENGTH / 111320;
  const dy = Math.cos(rad) * ILS_CONE_LENGTH / 111320;

  const p2 = [threshold[0] + dy, threshold[1] + dx];
  const left = [p2[0] + ILS_CONE_SPREAD, p2[1] - ILS_CONE_SPREAD];
  const right = [p2[0] - ILS_CONE_SPREAD, p2[1] + ILS_CONE_SPREAD];

  const coneLayers = [
    { opacity: 0.35, weight: 3 },
    { opacity: 0.22, weight: 2 },
    { opacity: 0.12, weight: 1 }
  ];

  coneLayers.forEach(layer => {
    const poly = L.polygon([threshold, left, right], {
      color: "#38bdf8",
      weight: layer.weight,
      opacity: layer.opacity,
      fillOpacity: layer.opacity * 0.6,
      smoothFactor: 1
    }).addTo(map);

    window.ilsLayers[airport].push(poly);
  });

  const loc = ils.loc;
  const locStart = [loc.lat, loc.lon];

  const locDx = Math.sin(rad) * 10 / 111320;
  const locDy = Math.cos(rad) * 10 / 111320;

  const locEnd = [loc.lat + locDy, loc.lon + locDx];

  const locLine = L.polyline([locStart, locEnd], {
    color: "#f87171",
    weight: 4,
    opacity: 0.9
  }).addTo(map);

  window.ilsLayers[airport].push(locLine);

  const gp = ils.glidepath;

  const fafDistDeg = gp.fafDistanceNm * 1852 / 111320;
  const gpDx = Math.sin(rad) * fafDistDeg;
  const gpDy = Math.cos(rad) * fafDistDeg;

  const fafPoint = [threshold[0] + gpDy, threshold[1] + gpDx];

  const gpLine = L.polyline([threshold, fafPoint], {
    color: "#22c55e",
    weight: 3,
    dashArray: "6,6",
    opacity: 0.9
  }).addTo(map);

  window.ilsLayers[airport].push(gpLine);
}
