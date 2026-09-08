// ===============================================================
// config-ILS.js — Config ILS avancée (seuils, LOC, GP 3°)
// Cockpit Airbus PRO+++
// ===============================================================

// Chaque aéroport contient :
// - pistes avec seuils (lat/lon)
// - heading magnétique
// - LOC (position + course)
// - Glidepath 3° (altitude au FAF/FAP, distance)

// Coordonnées approximatives — à affiner avec tes données réelles

export const ILS_CONFIG = {
  EBLG: {
    runways: {
      "22": {
        heading: 220,
        threshold: { lat: 50.6374, lon: 5.4432 },
        loc: {
          lat: 50.6400,
          lon: 5.4300,
          course: 220
        },
        glidepath: {
          angleDeg: 3,
          fafDistanceNm: 5.0,
          fafAltitudeFt: 2000
        }
      },
      "04": {
        heading: 40,
        threshold: { lat: 50.6450, lon: 5.4600 },
        loc: {
          lat: 50.6400,
          lon: 5.4700,
          course: 40
        },
        glidepath: {
          angleDeg: 3,
          fafDistanceNm: 5.0,
          fafAltitudeFt: 2000
        }
      }
    }
  },

  EBCI: {
    runways: {
      "24": {
        heading: 240,
        threshold: { lat: 50.4592, lon: 4.4538 },
        loc: {
          lat: 50.4620,
          lon: 4.4400,
          course: 240
        },
        glidepath: {
          angleDeg: 3,
          fafDistanceNm: 5.0,
          fafAltitudeFt: 2000
        }
      },
      "06": {
        heading: 60,
        threshold: { lat: 50.4650, lon: 4.4700 },
        loc: {
          lat: 50.4620,
          lon: 4.4800,
          course: 60
        },
        glidepath: {
          angleDeg: 3,
          fafDistanceNm: 5.0,
          fafAltitudeFt: 2000
        }
      }
    }
  }
};
