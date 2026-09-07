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
