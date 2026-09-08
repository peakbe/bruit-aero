// ===============================================================
// ND Airbus — centrage + surbrillance avion
// ===============================================================

import { setSelectedAircraft } from "./nd-panel.js";
import { map, planesLayer } from "./map.js";

// ---------------------------------------------------------------
// FPV Airbus — icône optimisée pour Leaflet (À PLACER ICI)
// ---------------------------------------------------------------
const fpvIcon = L.divIcon({
    className: "fpv-icon",
    html: `
      <svg width="42" height="42" viewBox="0 0 42 42">
        <circle cx="21" cy="21" r="10" stroke="#00ffff" stroke-width="2" fill="none"/>
        <line x1="11" y1="21" x2="31" y2="21" stroke="#00ffff" stroke-width="2"/>
        <line x1="16" y1="26" x2="21" y2="32" stroke="#00ffff" stroke-width="2"/>
        <line x1="26" y1="26" x2="21" y2="32" stroke="#00ffff" stroke-width="2"/>
      </svg>
    `,
    iconSize: [42, 42],
    iconAnchor: [21, 21]
});

// FPV marker global
let fpvMarker = null;

// ---------------------------------------------------------------
// 1. Centrage sur un avion (hex ICAO)
// ---------------------------------------------------------------
export function centerOnAircraft(hex) {
    const plane = planesLayer.getLayer(hex);
    if (!plane) return;

    const { lat, lon } = plane.options.data;
    map.setView([lat, lon], 11, { animate: true });
}

// ---------------------------------------------------------------
// 2. Surbrillance avion façon Airbus ND
// ---------------------------------------------------------------
export function highlightAircraft(hex) {
    const plane = planesLayer.getLayer(hex);
    if (!plane) return;

    plane.setStyle({
        color: "#00ffff",
        weight: 4
    });

    setTimeout(() => {
        plane.setStyle({
            color: "#3388ff",
            weight: 2
        });
    }, 3000);
}

// ---------------------------------------------------------------
// 3. FPV Airbus — mise à jour
// ---------------------------------------------------------------
export function updateFPV(hex) {
    const plane = planesLayer._layers[hex];
    if (!plane) return;

    const p = plane.options.data;

    const hdg = p.heading || p.track || 0;
    const trk = p.track || hdg;
    const drift = trk - hdg;
    const fpv = trk - drift;

    const lat = p.lat;
    const lon = p.lon;

    if (fpvMarker) {
        fpvMarker.setLatLng([lat, lon]);
        fpvMarker.setRotationAngle(fpv);
        return;
    }

    fpvMarker = L.marker([lat, lon], {
        icon: fpvIcon,
        rotationAngle: fpv,
        rotationOrigin: "center center"
    }).addTo(map);
}
