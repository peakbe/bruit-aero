// =================================================================
// WORKER CLOUDFLARE - METEO + ADS-B FAILOVER PRO10 + FIDS PRO9
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
// Normalisation avion
// -------------------------------------------------------------
function normalizeAircraft(list) {
  return list
    .filter(a => typeof a.lat === "number" && typeof a.lon === "number")
    .map(a => ({
      hex: a.hex || a.icao || "unknown",
      callsign: (a.callsign || a.flight || a.r || "Inconnu").trim(),
      registration: a.r || a.reg || "N/C",
      type: a.t || a.type || "N/C",
      lat: a.lat,
      lon: a.lon,
      alt_m: typeof a.alt_m === "number"
        ? a.alt_m
        : (typeof a.alt_baro === "number"
            ? a.alt_baro * 0.3048
            : (typeof a.alt === "number" ? a.alt * 0.3048 : 0)),
      speed_ms: typeof a.speed_ms === "number"
        ? a.speed_ms
        : (typeof a.gs === "number"
            ? a.gs * 0.514444
            : (typeof a.speed === "number" ? a.speed * 0.514444 : 0)),
      track: typeof a.track === "number" ? a.track : (a.heading || 0),
      on_ground: a.on_ground === true
    }));
}

// -------------------------------------------------------------
// Sources ADS-B (3 + ghost)
// -------------------------------------------------------------
async function srcAdsbLol(apt) {
  const url = `https://api.adsb.lol/v2/aircraft?lat=${apt.lat}&lon=${apt.lon}&dist=${DIST_NM}`;
  const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA } }, 4000);
  if (!res.ok) throw new Error("ADSB.lol KO");
  const j = await res.json();
  return normalizeAircraft(j.aircraft || []);
}

async function srcAirplanesLive(apt) {
  const url = `https://api.airplanes.live/v2/aircraft?lat=${apt.lat}&lon=${apt.lon}&dist=${DIST_NM}`;
  const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA } }, 4000);
  if (!res.ok) throw new Error("Airplanes.live KO");
  const j = await res.json();
  return normalizeAircraft(j.aircraft || []);
}

async function srcOpenSky(apt) {
  const url = `https://opensky-network.org/api/states/all?lamin=${apt.lat-0.5}&lamax=${apt.lat+0.5}&lomin=${apt.lon-0.5}&lomax=${apt.lon+0.5}`;
  const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA } }, 4000);
  if (!res.ok) throw new Error("OpenSky KO");
  const j = await res.json();

  const list = (j.states || []).map(s => ({
    icao: s[0],
    callsign: s[1],
    lon: s[5],
    lat: s[6],
    alt: s[7],
    on_ground: s[8],
    speed: s[9],
    track: s[10]
  }));

  return normalizeAircraft(list);
}

// Ghost traffic si aucune source ne renvoie rien
function ghostTraffic(apt) {
  return normalizeAircraft([
    {
      hex: "ghost01",
      callsign: "GHOST01",
      lat: apt.lat + 0.05,
      lon: apt.lon + 0.05,
      alt_m: 1200,
      speed_ms: 180,
      track: apt.ils22,
      on_ground: false
    },
    {
      hex: "ghost02",
      callsign: "GHOST02",
      lat: apt.lat - 0.04,
      lon: apt.lon - 0.03,
      alt_m: 800,
      speed_ms: 150,
      track: apt.ils04,
      on_ground: false
    }
  ]);
}

// Failover PRO10
async function fetchLiveAircraftFailover(airportCode) {
  const apt = AIRPORTS[airportCode.toLowerCase()];
  if (!apt) return [];

  const sources = [srcAdsbLol, srcAirplanesLive, srcOpenSky];

  for (const src of sources) {
    try {
      const ac = await src(apt);
      if (ac.length > 0) return ac;
    } catch (e) {}
  }

  return ghostTraffic(apt);
}

// -------------------------------------------------------------
// FIDS PRO9 (corridors ILS dynamiques + ETA + distance + altitude)
// -------------------------------------------------------------
function angleDiff(a, b) {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function computeIlsCorridor(a, apt) {
  const d = haversine(a.lat, a.lon, apt.lat, apt.lon);
  const speedKt = a.speed_ms / 0.514444;

  let baseAngle = 25;
  if (d > 30000) baseAngle = 40;
  if (d > 60000) baseAngle = 60;

  const diff22 = angleDiff(a.track, apt.ils22);
  const diff04 = angleDiff(a.track, apt.ils04);

  const inIls = (diff22 < baseAngle || diff04 < baseAngle) && speedKt > 100;

  return { inIls, d, speedKt };
}

function computeStatus(a, apt) {
  const alt = a.alt_m;
  const { inIls, d, speedKt } = computeIlsCorridor(a, apt);

  if (alt < 100 && speedKt < 60 && d < 5000) return "Au sol";

  if (alt < 5000 && d < 40000 && inIls) return "En approche";

  if (alt > 300 && speedKt > 120 && d < 20000) {
    const dirToApt = Math.atan2(apt.lon - a.lon, apt.lat - a.lat) * 180 / Math.PI;
    const diff = angleDiff(a.track, dirToApt);
    if (diff > 100) return "En montée";
  }

  return "En vol";
}

function computePredictedRole(a, apt) {
  const d = haversine(a.lat, a.lon, apt.lat, apt.lon);
  const alt = a.alt_m;
  const speedKt = a.speed_ms / 0.514444;

  const dirToApt = Math.atan2(apt.lon - a.lon, apt.lat - a.lat) * 180 / Math.PI;
  const diffDir = angleDiff(a.track, dirToApt);

  if (alt > 1500 && alt < 10000 && speedKt > 160 && d < 150000 && diffDir < 70)
    return "Arrivée prévue";

  if (alt < 2500 && speedKt > 100 && d < 25000)
    return "Départ probable";

  return null;
}

function computeTimeStr(a, apt) {
  const d = haversine(a.lat, a.lon, apt.lat, apt.lon);
  const speed = a.speed_ms;
  if (speed < 30) return { etaStr: "--:--", distNm: "", altFt: 0 };

  const tSec = d / speed;
  const eta = new Date(Date.now() + tSec * 1000);
  return {
    etaStr: eta.toLocaleTimeString("fr-BE", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Brussels"
    }),
    distNm: (d / 1852).toFixed(1),
    altFt: Math.round(a.alt_m / 0.3048)
  };
}

// -------------------------------------------------------------
// METEO (METAR + Open-Meteo)
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

      // ADS-B brut — /api/adsb?airport=EBLG
      if (path.includes("/api/adsb")) {
        const airportCode = (url.searchParams.get("airport") || "EBLG").toUpperCase();
        const apt = AIRPORTS[airportCode.toLowerCase()];

        if (!apt) {
          return new Response(JSON.stringify({ airport: airportCode, aircraft: [] }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const aircraft = await fetchLiveAircraftFailover(airportCode);

        return new Response(JSON.stringify({
          airport: airportCode,
          aircraft
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // WEATHER — /api/weather?lat=50.60&lon=5.38
if (path.includes("/api/weather")) {
  const lat = parseFloat(url.searchParams.get("lat"));
  const lon = parseFloat(url.searchParams.get("lon"));

  if (!lat || !lon) {
    return new Response(JSON.stringify({
      error: "Missing lat/lon"
    }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // Open-Meteo direct
  const wx = await fetchOpenMeteo(lat, lon);

  const meteo = wx
    ? {
        main: { temp: wx.temperature },
        wind: {
          speed: wx.windspeed,
          deg: wx.winddirection
        }
      }
    : null;

  return new Response(JSON.stringify({
    lat,
    lon,
    meteo
  }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

      // METEO — /api/meteo?apt=EBLG
      if (path.includes("/api/meteo")) {
        const aptCode = (url.searchParams.get("apt") || "EBLG").toUpperCase();
        const apt = AIRPORTS[aptCode.toLowerCase()];

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

      // FIDS ADS-B PRO9 — /api/fids-adsb?airport=EBLG
      if (path.includes("/api/fids-adsb")) {
        const airportCode = (url.searchParams.get("airport") || "EBLG").toUpperCase();
        const apt = AIRPORTS[airportCode.toLowerCase()];

        if (!apt) {
          return new Response(JSON.stringify({
            airport: airportCode,
            arrivals: [],
            departures: []
          }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const states = await fetchLiveAircraftFailover(airportCode);

        let arrivals = [];
        let departures = [];

        states.forEach(a => {
          const status = computeStatus(a, apt);
          const predicted = computePredictedRole(a, apt);
          const t = computeTimeStr(a, apt);

          const base = {
            flight: a.callsign,
            city: "Inconnu",
            time: t.etaStr,
            status,
            hex: a.hex,
            distNm: t.distNm,
            altFt: t.altFt
          };

          if (status === "En approche")
            arrivals.push(base);

          if (status === "En montée" || status === "Au sol")
            departures.push(base);

          if (predicted === "Arrivée prévue")
            arrivals.push({ ...base, status: predicted });

          if (predicted === "Départ probable")
            departures.push({ ...base, status: predicted });
        });

        return new Response(JSON.stringify({
          airport: airportCode,
          arrivals,
          departures
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ error: "Endpoint non trouvé" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
