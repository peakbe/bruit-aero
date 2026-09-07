// ===============================================================
// ND Airbus — centrage + surbrillance avion
// ===============================================================

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
