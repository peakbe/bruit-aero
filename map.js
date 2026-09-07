// ===============================================================
// map.js — Radar ADS‑B + export map + planesLayer
// ===============================================================

export let map = null;

// Layer contenant les avions (clé = hex ICAO)
export const planesLayer = L.layerGroup();

// ---------------------------------------------------------------
// 1. Initialisation de la carte
// ---------------------------------------------------------------
export function initRadarMap() {
    if (map !== null) return map;

    map = L.map("map").setView([50.55, 4.95], 8);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap"
    }).addTo(map);

    planesLayer.addTo(map);

    return map;
}

// ---------------------------------------------------------------
// 2. Mise à jour ADS‑B via Airplanes.live
// ---------------------------------------------------------------
export async function updateRadar() {
    try {
        const res = await fetch("https://api.airplanes.live/v2/positions");
        const data = await res.json();

        const active = new Set();

        data.aircraft.forEach(p => {
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
                planesLayer._layers[hex] = marker; // indexation par hex
            }

            marker.setLatLng([p.lat, p.lon]);
            marker.options.data = p;
        });

        // Suppression des avions disparus
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

// Mise à jour automatique
setInterval(updateRadar, 5000);
