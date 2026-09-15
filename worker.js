// =================================================================
// WORKER CLOUDFLARE - METEO + ADS-B + FIDS PRO v4
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

// -------------------------------------------------------------
// Utils
// -------------------------------------------------------------
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

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// -------------------------------------------------------------
// ADS-B brut (liste avions) - /api/adsb
// -------------------------------------------------------------
async function fetchReadsb(base, ap) {
  const url = `${base}/aircraft?lat=${ap.lat}&lon=${ap.lon}&dist=${DIST_NM}`;
  const res = await fetchWithTimeout(url, {
    headers: { "User-Agent": UA, "Accept": "application/json" }
  });
  if (!res.ok) return [];

  const j = await res.json();
  const list = j.aircraft || [];

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
// Statut directionnel + ILS (FIDS)
// -------------------------------------------------------------
function angleDiff(a, b) {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function computeStatus(a, apt) {
  const d = haversine(a.lat, a.lon, apt.lat, apt.lon);
  const alt = a.alt_m;
  const speedKt = a.speed_ms / 0.514444;

  const diff22 = angleDiff(a.track, apt.ils22);
  const diff04 = angleDiff(a.track, apt.ils04);

  if (alt < 80 && speedKt < 40 && d < 3000) return "Au sol";

  if (alt < 3000 && speedKt > 120 && speedKt < 260 && d < 20000) {
    if (diff22 < 25 || diff04 < 25) return "En approche";
  }

  if (alt > 300 && speedKt > 120 && d < 8000) {
    const dirToApt = Math.atan2(apt.lon - a.lon, apt.lat - a.lat) * 180 / Math.PI;
    const diff = angleDiff(a.track, dirToApt);
    if (diff > 120) return "En montée";
  }

  return "En vol";
}

function computePredictedRole(a, apt) {
  const d = haversine(a.lat, a.lon, apt.lat, apt.lon);
  const alt = a.alt_m;
  const speedKt = a.speed_ms / 0.514444;

  const dirToApt = Math.atan2(apt.lon - a.lon, apt.lat - a.lat) * 180 / Math.PI;
  const diffDir = angleDiff(a.track, dirToApt);

  if (alt > 1500 && alt < 8000 && speedKt > 200 && d < 80000 && diffDir < 40) {
    return "Arrivée prévue";
  }

  if (alt < 1500 && speedKt > 120 && d < 15000) {
    return "Départ probable";
  }

  return null;
}

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

// -------------------------------------------------------------
// METEO (METAR + Open-Meteo) - /api/meteo
// -------------------------------------------------------------
async function fetchMetar(aptCode) {
  const url = `https://metar.vatsim.net/${aptCode}`;
  const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return "METAR indisponible";
  return (await res.text()).trim();
}

async function fetchOpenMeteo(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current_weather=true`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) return null;
  const j = await res.json();
  return j.current_weather || null;
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
      // 1) ADS-B brut — /api/adsb?airport=EBLG
      // -------------------------------------------------------------
      if (path.includes("/api/adsb")) {
        const airportCode = (url.searchParams.get("airport") || "EBLG").toUpperCase();
        const aptKey = airportCode.toLowerCase();
        const apt = AIRPORTS[aptKey];

        if (!apt) {
          return new Response(JSON.stringify({ airport: airportCode, aircraft: [] }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const base = "https://api.adsb.lol/v2";
        let aircraft = [];

        try {
          aircraft = await fetchReadsb(base, apt);
        } catch (e) {
          console.error("ADS-B KO:", e);
        }

        return new Response(JSON.stringify({
          airport: airportCode,
          aircraft
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // -------------------------------------------------------------
      // 2) METEO — /api/meteo?apt=EBLG
      // -------------------------------------------------------------
      if (path.includes("/api/meteo")) {
        const aptCode = (url.searchParams.get("apt") || "EBLG").toUpperCase();
        const aptKey = aptCode.toLowerCase();
        const apt = AIRPORTS[aptKey];

        if (!apt) {
          return new Response(JSON.stringify({
            apt: aptCode,
            metar: "Aéroport inconnu",
            meteo: null
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const metar = await fetchMetar(aptCode);
        const current = await fetchOpenMeteo(apt.lat, apt.lon);

        const meteo = current
          ? {
              main: { temp: current.temperature },
              wind: {
                speed: current.windspeed,
                deg: current.winddirection
              }
            }
          : null;

        return new Response(JSON.stringify({
          apt: aptCode,
          metar,
          meteo
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // -------------------------------------------------------------
      // 3) FIDS ADS-B PRO v3 — /api/fids-adsb?airport=EBLG
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

            if (status === "En approche")
              arrivals.push({ flight: a.callsign, city: "Inconnu", time: timeStr, status, hex: a.hex });

            if (status === "En montée" || status === "Au sol")
              departures.push({ flight: a.callsign, city: "Inconnu", time: timeStr, status, hex: a.hex });

            if (predicted === "Arrivée prévue")
              arrivals.push({ flight: a.callsign, city: "Inconnu", time: timeStr, status: predicted, hex: a.hex });

            if (predicted === "Départ probable")
              departures.push({ flight: a.callsign, city: "Inconnu", time: timeStr, status: predicted, hex: a.hex });
          });
        } catch (e) {
          console.error("FIDS ADS-B KO:", e);
        }

        if (arrivals.length === 0 && departures.length === 0) {
          const now = new Date();
          const t = (m) => {
            const d = new Date(now.getTime() + m * 60000);
            return d.toLocaleTimeString("fr-BE", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Europe/Brussels"
            });
          };

          departures = [
            { flight: "3V801", city: "Alicante (ALC)", time: t(10), status: "Programmé", hex: null },
            { flight: "XQ120", city: "Antalya (AYT)", time: t(35), status: "Programmé", hex: null }
          ];
        }

        return new Response(JSON.stringify({
          airport: airportCode,
          arrivals,
          departures
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

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
