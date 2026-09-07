// ===============================================================
// ND Airbus — centrage + surbrillance avion
// ===============================================================
import { setSelectedAircraft } from "./nd-panel.js";

// map et planesLayer doivent être exposés par ton module radar ADS-B
import { map, planesLayer } from "./map.js";

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
// 3. Ajout du FPV sur la carte ND (Leaflet)
// ---------------------------------------------------------------
let fpvMarker = null;

export function updateFPV(hex) {
    const plane = planesLayer._layers[hex];
    if (!plane) return;

    const p = plane.options.data;

    const hdg = p.heading || p.track || 0;
    const trk = p.track || hdg;

    const drift = trk - hdg;
    const fpv = trk - drift;

    // Position = avion
    const lat = p.lat;
    const lon = p.lon;

    // Si FPV déjà affiché → on le déplace
    if (fpvMarker) {
        fpvMarker.setLatLng([lat, lon]);
        fpvMarker.setRotationAngle(fpv);
        return;
    }

    // Sinon → création
    fpvMarker = L.marker([lat, lon], {
        icon: fpvIcon,
        rotationAngle: fpv,
        rotationOrigin: "center center"
    }).addTo(map);
}
