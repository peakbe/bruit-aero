// ===============================================================
// config-ILS.js — Config ILS avancée (seuils, LOC, GP 3°)
// Cockpit Airbus PRO+++
// ===============================================================

export const ILS_CONFIG = {
  EBLG: {
    runways: {
      "22": {
        heading: 222,
        threshold: { lat: 50.6433, lon: 5.4526 },
        loc: {
          lat: 50.6300,
          lon: 5.4260,
          course: 222
        },
        glidepath: {
          angleDeg: 3.0,
          fafDistanceNm: 5.0,
          fafAltitudeFt: 2000
        }
      },
      "04": {
        heading: 42,
        threshold: { lat: 50.6300, lon: 5.4260 },
        loc: {
          lat: 50.6433,
          lon: 5.4526,
          course: 42
        },
        glidepath: {
          angleDeg: 3.0,
          fafDistanceNm: 5.0,
          fafAltitudeFt: 2000
        }
      }
    }
  },

  EBCI: {
    runways: {
      "24": {
        heading: 241,
        threshold: { lat: 50.4636, lon: 4.4690 },
        loc: {
          lat: 50.4533,
          lon: 4.4360,
          course: 241
        },
        glidepath: {
          angleDeg: 3.0,
          fafDistanceNm: 5.0,
          fafAltitudeFt: 2000
        }
      },
      "06": {
        heading: 61,
        threshold: { lat: 50.4533, lon: 4.4360 },
        loc: {
          lat: 50.4636,
          lon: 4.4690,
          course: 61
        },
        glidepath: {
          angleDeg: 3.0,
          fafDistanceNm: 5.0,
          fafAltitudeFt: 2000
        }
      }
    }
  }
};
