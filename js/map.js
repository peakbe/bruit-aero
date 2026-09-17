// ===============================================================
// map.js — Radar ADS‑B + ND Airbus PRO+++ (Optimisé)
// ===============================================================

import { sonoLayer } from "./sono.js";
import { ILS_CONFIG } from "./config-ILS.js";
import {
  ILS_CONE_LENGTH,
  ILS_CONE_SPREAD,
  RADAR_REFRESH_MS,
  AIRPORT_COORDS
} from "./config.js";

import {
  centerOnAircraft,
  highlightAircraft,
  updateFPV,
  setSelectedAircraft
} from "./nd.js";

// ===============================================================
// GLOBALS
// ===============================================================
export let map = null;

export const planesLayer = L.layerGroup();
export const planeIndex = {};

if (!window.ilsLayers) window.ilsLayers = {};

// ===============================================================
// 1. INITIALISATION DE LA CARTE — PRO+++
// ===============================================================
export function initRadarMap() {
  if (map) return map;

  map = L.map("map", {
    preferCanvas: true,
    zoomControl: false,
    worldCopyJump: true
  }).setView(
    [AIRPORT_COORDS.ALL.lat, AIRPORT_COORDS.ALL.lon],
    8
  );

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap"
  }).addTo(map);

  planesLayer.addTo(map);
  sonoLayer.addTo(map);

  setTimeout(() => map.invalidateSize(), 200);

  return map;
}

// ===============================================================
// 2. RADAR ADS‑B — Mise à jour PRO+++
// ===============================================================
export async function updateRadar() {
  try {
    const res = await fetch(
      "https://bruit-aero-proxy.pnyr682w7f.workers.dev/api/adsb",
      { cache: "no-store" }
    );
    const data = await res.json();

    const active = new Set();

    for (const p of (data.aircraft || [])) {
      if (!p.hex || !p.lat || !p.lon) continue;

      active.add(p.hex);

      let marker = planeIndex[p.hex];

      // Création du marqueur avion
      if (!marker) {
        marker = L.circleMarker([p.lat, p.lon], {
          radius: 5,
          color: "#38bdf8",
          weight: 2,
          fillColor: "#0ea5e9",
          fillOpacity: 0.8,
          renderer: map.getRenderer(map)
        });

        marker._leaflet_id = p.hex;
        marker.options.data = p;

        marker.on("click", () => {
          centerOnAircraft(p.hex);
          highlightAircraft(p.hex);
          setSelectedAircraft(p.hex);
          updateFPV(p.hex);
        });

        planesLayer.addLayer(marker);
        planeIndex[p.hex] = marker;
      }

      // Mise à jour position + data
      marker.setLatLng([p.lat, p.lon]);
      marker.options.data = p;
    }

    // Suppression des avions disparus
    for (const hex in planeIndex) {
      if (!active.has(hex)) {
        planesLayer.removeLayer(planeIndex[hex]);
        delete planeIndex[hex];
      }
    }

  } catch (err) {
    console.error("Erreur radar ADS‑B:", err);
  }
}

setInterval(updateRadar, RADAR_REFRESH_MS);

// ===============================================================
// 3. ILS — Cône + LOC + Glidepath 3° — PRO+++
// ===============================================================
export function drawApproachDepartureCones(airport, lat, lon, windDeg) {

  // Nettoyage ancien ILS
  const layers = window.ilsLayers[airport] || [];
  layers.forEach(layer => map.removeLayer(layer));
  window.ilsLayers[airport] = [];

  // Détermination piste active
  const runway =
    airport === "EBLG"
      ? (windDeg > 180 ? "22" : "04")
      : (windDeg > 180 ? "24" : "06");

  const ils = ILS_CONFIG[airport].runways[runway];
  const heading = ils.heading;
  const threshold = [ils.threshold.lat, ils.threshold.lon];

  const rad = heading * Math.PI / 180;

  // ---------------------------------------------------------------
  // CÔNE ILS — PRO+++ (optimisé)
  // ---------------------------------------------------------------
  const dx = Math.sin(rad) * ILS_CONE_LENGTH / 111320;
  const dy = Math.cos(rad) * ILS_CONE_LENGTH / 111320;

  const p2 = [threshold[0] + dy, threshold[1] + dx];
  const left  = [p2[0] + ILS_CONE_SPREAD, p2[1] - ILS_CONE_SPREAD];
  const right = [p2[0] - ILS_CONE_SPREAD, p2[1] + ILS_CONE_SPREAD];

  const coneLayers = [
    { opacity: 0.35, weight: 3 },
    { opacity: 0.22, weight: 2 },
    { opacity: 0.12, weight: 1 }
  ];

  for (const layer of coneLayers) {
    const poly = L.polygon([threshold, left, right], {
      color: "#38bdf8",
      weight: layer.weight,
      opacity: layer.opacity,
      fillOpacity: layer.opacity * 0.6,
      smoothFactor: 1
    }).addTo(map);

    window.ilsLayers[airport].push(poly);
  }

  // ---------------------------------------------------------------
  // LOCALIZER (LOC) — PRO+++ (optimisé)
  // ---------------------------------------------------------------
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

  // ---------------------------------------------------------------
  // GLIDEPATH 3° — PRO+++ (optimisé)
  // ---------------------------------------------------------------
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
