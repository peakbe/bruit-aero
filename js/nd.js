// ===============================================================
// ND Airbus — centrage + surbrillance + FPV PRO+++
// ===============================================================

import { setSelectedAircraft } from "./nd-panel.js";
import { map, planesLayer, planeIndex } from "./map.js";

// ===============================================================
// 0. FPV Airbus — icône optimisée
// ===============================================================
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

let fpvMarker = null;

// ===============================================================
// 1. Centrage avion — ND Airbus PRO+++
// ===============================================================
export function centerOnAircraft(hex) {
  const plane = planeIndex[hex];
  if (!plane) return;

  const { lat, lon } = plane.options.data;
  map.setView([lat, lon], 11, { animate: true });
}

// ===============================================================
// 2. Surbrillance avion — ND Airbus PRO+++
// ===============================================================
export function highlightAircraft(hex) {
  const plane = planeIndex[hex];
  if (!plane) return;

  plane.setStyle({
    color: "#00ffff",
    weight: 4
  });

  setTimeout(() => {
    plane.setStyle({
      color: "#38bdf8",
      weight: 2
    });
  }, 2500);
}

// ===============================================================
// 3. FPV Airbus — PRO+++
// ===============================================================
export function updateFPV(hex) {
  const plane = planeIndex[hex];
  if (!plane) return;

  const p = plane.options.data;

  // Heading / Track fallback
  const hdg = p.heading || p.true_heading || p.mag_heading || p.track || 0;
  const trk = p.track || hdg;

  // Drift = différence HDG/TRK
  const drift = trk - hdg;

  // FPV = track corrigé du drift
  const fpv = trk - drift;

  const lat = p.lat;
  const lon = p.lon;

  // Mise à jour FPV existant
  if (fpvMarker) {
    fpvMarker.setLatLng([lat, lon]);
    fpvMarker.setRotationAngle(fpv);
    return;
  }

  // Création FPV
  fpvMarker = L.marker([lat, lon], {
    icon: fpvIcon,
    rotationAngle: fpv,
    rotationOrigin: "center center"
  }).addTo(map);
}
