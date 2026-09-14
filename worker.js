// =================================================================
// WORKER CLOUDFLARE - FIDS ADS-B PRO+++ v2 (Direction + Corridors ILS)
// =================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const UA = "AeroNoiseMonitor/1.0";
const DIST_NM = 50;

const AIRPORTS = {
  ebci: { lat: 50.4594, lon: 4.4536, ils22: 236, ils04: 56 },
  eblg: { lat: 50.6378, lon: 5.4444, ils22: 220, ils04: 40 }
};

function deg2rad(d) { return d * Math.PI / 180; }
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 +
            Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
            Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchReadsb(base, ap) {
  const url = `${base}/lat/${ap.lat}/lon/${ap.lon}/dist/${DIST_NM}`;
  const res = await fetchWithTimeout(url, {
    headers: { "User-Agent": UA, "Accept": "application/json" }
  });
  if (!res.ok) return [];

  const j = await res.json();
  const list = Array.isArray(j) ? j : j.aircraft || j.ac || [];

  return list
    .filter(a => typeof a.lat === "number" && typeof a.lon === "number")
    .map(a => ({
      hex: a.hex || "unknown",
      callsign: (a.flight || a.r || "Inconnu").trim(),
      lat: a.lat,
      lon: a.lon,
      alt_m: typeof a.alt_baro === "number" ? a.alt_baro * 0.3048 : 0,
      speed_ms: typeof a.gs === "number" ? a.gs * 0.514444 : 0,
      track: typeof a.track === "number" ? a.track : 0,
      on_ground: a.alt_baro === "ground"
    }));
}

// -------------------------------------------------------------
// Détection directionnelle + corridors ILS
// -------------------------------------------------------------
function angleDiff(a, b) {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function computeStatus(a, apt) {
  const d = haversine(a.lat, a.lon, apt.lat, apt.lon);
  const alt = a.alt_m;
  const speedKt = a.speed_ms / 0.514444;

  const ils22 = apt.ils22;
  const ils04 = apt.ils04;

  const diff22 = angleDiff(a.track, ils22);
  const diff04 = angleDiff(a.track, ils04);

  // AU SOL PROBABLE
  if (alt < 80 && speedKt < 40 && d < 3000) return "Au sol";

  // EN APPROCHE (corridor ILS)
  if (alt < 3000 && speedKt > 120 && speedKt < 260 && d < 20000) {
    if (diff22 < 25 || diff04 < 25) return "En approche";
  }

  // EN MONTÉE (s'éloigne de l'aéroport)
  if (alt > 300 && speedKt > 120 && d < 8000) {
    const dirToApt = Math.atan2(apt.lon - a.lon, apt.lat - a.lat) * 180 / Math.PI;
    const diff = angleDiff(a.track, dirToApt);
    if (diff > 120) return "En montée";
  }

  return "En vol";
}

// fonction de prédiction
function computePredictedRole(a, apt) {
  const d = haversine(a.lat, a.lon, apt.lat, apt.lon);
  const alt = a.alt_m;
  const speedKt = a.speed_ms / 0.514444;

  // Direction vers l'aéroport
  const dirToApt = Math.atan2(apt.lon - a.lon, apt.lat - a.lat) * 180 / Math.PI;
  const diffDir = angleDiff(a.track, dirToApt);

  // ARRIVÉE PRÉVUE : avion en descente vers l'aéroport
  if (alt > 1500 && alt < 8000 && speedKt > 200 && d < 80000 && diffDir < 40) {
    return "Arrivée prévue";
  }

  // DÉPART PROBABLE : avion très bas, proche, en montée
  if (alt < 1500 && speedKt > 120 && d < 15000) {
    return "Départ probable";
  }

  return null;
}

// -------------------------------------------------------------
// ETA / ETD réaliste
// -------------------------------------------------------------
function computeTimeStr(a, apt) {
  const d = haversine(a.lat, a.lon, apt.lat, apt.lon);
  const speed = a.speed_ms;
  if (speed < 30) return "--:--";

  const tSec = d / speed;
  const eta = new Date(Date.now() + tSec * 1000);
  return eta.toLocaleTimeString("fr-BE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels"
  });
}

// =================================================================
// HANDLER
// =================================================================
export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {

      // -------------------------------------------------------------
      // FIDS ADS-B PRO+++ v2
      // -------------------------------------------------------------
      if (path.includes("/api/fids-adsb")) {
        const airportCode = (url.searchParams.get("airport") || "EBLG").toUpperCase();
        const aptKey = airportCode.toLowerCase();
        const apt = AIRPORTS[aptKey];

        if (!apt) {
          return new Response(JSON.stringify({
            airport: airportCode,
            arrivals: [],
            departures: []
          }), { status: 200, headers: corsHeaders });
        }

        let arrivals = [];
        let departures = [];

        try {
          const base = "https://api.adsb.lol/v2";
          const states = await fetchReadsb(base, apt);

          states.forEach(a => {
  const status = computeStatus(a, apt);
  const predicted = computePredictedRole(a, apt);
  const timeStr = computeTimeStr(a, apt);

  // Arrivées réelles
  if (status === "En approche") {
    arrivals.push({
      flight: a.callsign,
      city: "Inconnu",
      time: timeStr,
      status,
      hex: a.hex
    });
  }

  // Départs réels
  if (status === "En montée" || status === "Au sol") {
    departures.push({
      flight: a.callsign,
      city: "Inconnu",
      time: timeStr,
      status,
      hex: a.hex
    });
  }

  // Prédiction : arrivée prévue
  if (predicted === "Arrivée prévue") {
    arrivals.push({
      flight: a.callsign,
      city: "Inconnu",
      time: timeStr,
      status: "Arrivée prévue",
      hex: a.hex
    });
  }

  // Prédiction : départ probable
  if (predicted === "Départ probable") {
    departures.push({
      flight: a.callsign,
      city: "Inconnu",
      time: timeStr,
      status: "Départ probable",
      hex: a.hex
    });
  }
});

      // -------------------------------------------------------------
      // DEFAULT
      // -------------------------------------------------------------
      return new Response(JSON.stringify({ error: "Endpoint non trouvé" }), {
        status: 404,
        headers: corsHeaders
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: corsHeaders
      });
    }
  }
};


      // -------------------------------------------------------------
      // 4. FORECAST (Open-Meteo)
      // -------------------------------------------------------------
      if (path.includes("/api/forecast")) {
        const lat = url.searchParams.get("lat") || "50.6374";
        const lon = url.searchParams.get("lon") || "5.4432";

        const res = await fetchWithTimeout(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,windspeed_10m,weathercode,precipitation_probability&forecast_days=1`
        );

        if (res.ok) {
          const data = await res.json();
          const list = [];
          const nowHour = new Date().getHours();

          if (data.hourly && data.hourly.time) {
            for (let i = nowHour + 1; i <= nowHour + 3 && i < data.hourly.time.length; i++) {
              const dateObj = new Date(data.hourly.time[i]);
              const windKmh = data.hourly.windspeed_10m[i];
              const windMs = Math.round((windKmh / 3.6) * 10) / 10;
              const wmoInfo = decodeWmoCode(data.hourly.weathercode[i]);
              const popProb = (data.hourly.precipitation_probability?.[i] || 0) / 100;

              list.push({
                dt: Math.floor(dateObj.getTime() / 1000),
                main: { temp: Math.round(data.hourly.temperature_2m[i]) },
                wind: { speed: windMs },
                pop: popProb,
                weather: [{ description: wmoInfo.desc, icon: wmoInfo.icon }]
              });
            }
          }

          return new Response(JSON.stringify({ list }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        return new Response(JSON.stringify({ list: [] }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // -------------------------------------------------------------
      // 5. METAR (VATSIM)
      // -------------------------------------------------------------
      if (path.includes("/api/metar")) {
        const station = (url.searchParams.get("station") || "EBLG").toUpperCase();

        const res = await fetchWithTimeout(
          `https://metar.vatsim.net/metar.php?id=${station}`
        );

        if (res.ok) {
          const rawMetar = await res.text();
          return new Response(JSON.stringify({ raw: rawMetar.trim() }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        return new Response(JSON.stringify({ raw: "METAR indisponible" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

     // -------------------------------------------------------------
// 6. FIDS DYNAMIQUE ADS-B — EBCI / EBLG
// -------------------------------------------------------------
if (path.includes("/api/fids-adsb")) {
  const airportCode = (url.searchParams.get("airport") || "EBLG").toUpperCase();
  const aptKey = airportCode.toLowerCase();
  const apt = AIRPORTS[aptKey];

  let arrivals = [];
  let departures = [];

  if (!apt) {
    return new Response(JSON.stringify({
      airport: airportCode,
      arrivals: [],
      departures: []
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    const base = "https://api.adsb.lol/v2";
    const states = await fetchReadsb(base, apt, null);

    states.forEach(a => {
      const status = computeStatusFromAdsb(a, apt.lat, apt.lon);
      const d = haversine(a.lat, a.lon, apt.lat, apt.lon);
      const speedKt = a.speed_ms / 0.514444;

      let timeStr = "--:--";
      if (speedKt > 50) {
        const tSec = d / a.speed_ms;
        const eta = new Date(Date.now() + tSec * 1000);
        timeStr = eta.toLocaleTimeString("fr-BE", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Brussels"
        });
      }

      if (status === "En approche") {
        arrivals.push({
          flight: a.callsign || "Inconnu",
          city: "Inconnu",
          time: timeStr,
          status,
          hex: a.hex
        });
      }

      if (status === "En montée" || (status === "Au sol" && d < 5000)) {
        departures.push({
          flight: a.callsign || "Inconnu",
          city: "Inconnu",
          time: timeStr,
          status,
          hex: a.hex
        });
      }
    });
  } catch (e) {
    console.error("FIDS ADS-B KO:", e);
  }

  if (arrivals.length === 0 && departures.length === 0) {
    const getDynamicTime = (offset) => {
      const now = new Date();
      now.setMinutes(now.getMinutes() + offset);
      return now.toLocaleTimeString("fr-BE", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Brussels"
      });
    };

    if (airportCode === "EBCI") {
      departures = [
        { flight: "FR2104", city: "Marseille (MRS)", time: getDynamicTime(15), status: "Embarquement", hex: null },
        { flight: "W64512", city: "Bucarest (OTP)", time: getDynamicTime(45), status: "Programmé", hex: null }
      ];
    } else {
      departures = [
        { flight: "3V801", city: "Alicante (ALC)", time: getDynamicTime(10), status: "Embarquement", hex: null },
        { flight: "XQ120", city: "Antalya (AYT)", time: getDynamicTime(35), status: "Programmé", hex: null }
      ];
    }
  }

  const payload = {
    airport: airportCode,
    arrivals,
    departures
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

      // -------------------------------------------------------------
      // 7. METEO FUSIONNÉE (METAR + Open-Meteo) — ND Airbus
      // -------------------------------------------------------------
      if (path.includes("/api/meteo")) {
        const apt = (url.searchParams.get("apt") || "EBLG").toUpperCase();

        const coords = {
          EBCI: { lat: 50.4594, lon: 4.4536 },
          EBLG: { lat: 50.6378, lon: 5.4444 }
        };

        const { lat, lon } = coords[apt] || coords.EBLG;

        let metarRaw = "N/A";
        try {
          const metarRes = await fetchWithTimeout(
            `https://metar.vatsim.net/metar.php?id=${apt}`
          );
          if (metarRes.ok) {
            metarRaw = (await metarRes.text()).trim();
          }
        } catch (e) {
          metarRaw = "METAR indisponible";
        }

        let meteo = {
          main: { temp: null },
          wind: { speed: null, deg: null },
          weather: [{ description: "N/A", icon: "03d" }]
        };

        try {
          const wxRes = await fetchWithTimeout(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`
          );

          if (wxRes.ok) {
            const data = await wxRes.json();
            const cw = data.current_weather;
            const wmoInfo = decodeWmoCode(cw.weathercode ?? 0);

            meteo = {
              main: { temp: cw.temperature },
              wind: {
                speed: cw.windspeed,
                deg: cw.winddirection
              },
              weather: [{
                description: wmoInfo.desc,
                icon: wmoInfo.icon
              }]
            };
          }
        } catch (e) {
          meteo.main.temp = 20;
          meteo.wind.speed = 5;
          meteo.wind.deg = 180;
        }

        const payload = {
          airport: apt,
          metar: metarRaw,
          meteo
        };

        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // -------------------------------------------------------------
      // 8. DEFAULT 404
      // -------------------------------------------------------------
      return new Response(JSON.stringify({ error: "Endpoint non trouvé" }), {
        status: 404,
        headers: corsHeaders
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
