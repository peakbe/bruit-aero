// ===============================
// ND Airbus – centrage + highlight
// ===============================

import { map, planesLayer } from "./map.js";

export function centerOnAircraft(hex) {
    const plane = planesLayer.getLayer(hex);
    if (!plane) return;

    const { lat, lon } = plane.options.data;
    map.setView([lat, lon], 11, { animate: true });
}

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
