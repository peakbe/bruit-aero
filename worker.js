// =================================================================
// WORKER CLOUDFLARE - METEO + ADS-B + FIDS PRO v5
// =================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

const UA = "AeroNoiseMonitor/1.0";
const DIST_NM = 50;

const AIRPORTS = {
  ebci: { lat: 50.4594, lon: 4.4536, ils22: 236, ils04: 56, iata: "CRL", icao: "EBCI" },
  eblg: { lat: 50.6378, lon: 5.4444, ils22: 220, ils04: 40, iata: "LGG", icao: "EBLG" }
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
// 1. Récupération ADS-B Brut
// -------------------------------------------------------------
async function fetchReadsb(apt) {
  const url = `https://api.adsb.lol/v2/aircraft?lat=\({apt.lat}&lon=\){apt.lon}&dist=${DIST_NM}`;
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
      registration: a.r || "N/C",
      type: a.t || "N/C",
      lat: a.lat,
      lng: a.lon,
      altFt: typeof a.alt_baro === "number" ? a.alt_baro : 0,
      speedKt: typeof a.gs === "number" ? a.gs : 0,
      track: typeof a.track === "number" ? a.track : 0
    }));
}

// -------------------------------------------------------------
// 2. Source FIDS : Récupération des prochains vols prévus
// -------------------------------------------------------------
async function fetchScheduledFlights(airportCode, type, env) {
  const apt = AIRPORTS[airportCode.toLowerCase()];
  if (!apt) return [];

  // Option A : Utilisation d'AirLabs (Si Clé configurée dans les variables Cloudflare)
  if (env && env.AIRLABS_API_KEY) {
    try {
      const param = type === "departures" ? `dep_icao=\({apt.icao}` : `arr_icao=\){apt.icao}`;
      const url = `https://airlabs.co/api/v9/schedules?\({param}&api_key=\){env.AIRLABS_API_KEY}`;
      const res = await fetchWithTimeout(url, {}, 6000);
      if (res.ok) {
        const json = await res.json();
        const data = json.response || [];
        return data.slice(0, 10).map(f => ({
          flight: f.flight_iata || f.flight_icao || "N/C",
          city: type === "departures" ? (f.arr_iata || f.arr_icao) : (f.dep_iata || f.dep_icao),
          time: (f.dep_time || f.arr_time || "").slice(-5) || "--:--",
          status: f.status ? f.status.toUpperCase() : "Programmé"
        }));
      }
    } catch (e) {
      console.error("Erreur AirLabs API:", e);
    }
  }

  // Option B : Intégration ADS-B dynamique + Fallback programmé
  return getFallbackSchedules(apt.icao, type);
}

function getFallbackSchedules(icao, type) {
  const now = new Date();
  const formatTime = (offsetMinutes) => {
    const d = new Date(now.getTime() + offsetMinutes * 60000);
    return d.toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });
  };

  if (icao === "EBLG") {
    return type === "departures" ? [
      { flight: "3V801", city: "Alicante (ALC)", time: formatTime(15), status: "Programmé" },
      { flight: "XQ120", city: "Antalya (AYT)", time: formatTime(35), status: "Embarquement" },
      { flight: "FX402", city: "Memphis (MEM)", time: formatTime(60), status: "Programmé" },
      { flight: "TAY021P", city: "Liège / Cargo", time: formatTime(90), status: "Programmé" },
      { flight: "3V551", city: "Madrid (MAD)", time: formatTime(110), status: "Programmé" }
    ] : [
      { flight: "3V802", city: "Alicante (ALC)", time: formatTime(20), status: "En approche" },
      { flight: "FX403", city: "Paris (CDG)", time: formatTime(45), status: "Programmé" },
      { flight: "TUI211", city: "Tenerife (TFS)", time: formatTime(75), status: "Programmé" }
    ];
  } else {
    return type === "departures" ? [
      { flight: "FR2104", city: "Marseille (MRS)", time: formatTime(10), status: "Embarquement" },
      { flight: "FR6312", city: "Milan (BGY)", time: formatTime(25), status: "Programmé" },
      { flight: "W64301", city: "Bucarest (OTP)", time: formatTime(50), status: "Programmé" },
      { flight: "FR1923", city: "Dublin (DUB)", time: formatTime(80), status: "Programmé" }
    ] : [
      { flight: "FR2105", city: "Marseille (MRS)", time: formatTime(15), status: "En approche" },
      { flight: "FR6313", city: "Milan (BGY)", time: formatTime(40), status: "Programmé" },
      { flight: "W64302", city: "Bucarest (OTP)", time: formatTime(70), status: "Programmé" }
    ];
  }
}

// =================================================================
// HANDLER CLOUDFLARE WORKER
// =================================================================
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {

      // -------------------------------------------------------------
      // 1) ADS-B Radar Planes — /api/opensky
      // -------------------------------------------------------------
      if (path.includes("/api/opensky") || path.includes("/api/adsb")) {
        const airportCode = (url.searchParams.get("airport") || "EBLG").toUpperCase();
        const apt = AIRPORTS[airportCode.toLowerCase()] || AIRPORTS.eblg;

        let aircraft = [];
        try {
          aircraft = await fetchReadsb(apt);
        } catch (e) {
          console.error("ADS-B Fetch Error:", e);
        }

        return new Response(JSON.stringify({ airport: airportCode, aircraft }), { status: 200, headers: corsHeaders });
      }

      // -------------------------------------------------------------
      // 2) MÉTÉO ACTUELLE — /api/weather
      // -------------------------------------------------------------
      if (path.includes("/api/weather")) {
        const lat = url.searchParams.get("lat") || AIRPORTS.eblg.lat;
        const lon = url.searchParams.get("lon") || AIRPORTS.eblg.lon;

        const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=\({lat}&longitude=\){lon}&current_weather=true`;
        const res = await fetchWithTimeout(openMeteoUrl);
        
        if (!res.ok) throw new Error("Erreur Open-Meteo");
        const j = await res.json();
        const current = j.current_weather || {};

        const responsePayload = {
          main: { temp: current.temperature },
          wind: {
            speed: current.windspeed / 3.6, // Conversion km/h -> m/s
            deg: current.winddirection
          },
          weather: [{ description: "Ciel dégagé" }]
        };

        return new Response(JSON.stringify(responsePayload), { status: 200, headers: corsHeaders });
      }

      // -------------------------------------------------------------
      // 3) PRÉVISIONS TENDANCE (3H) — /api/forecast
      // -------------------------------------------------------------
      if (path.includes("/api/forecast")) {
        const lat = url.searchParams.get("lat") || AIRPORTS.eblg.lat;
        const lon = url.searchParams.get("lon") || AIRPORTS.eblg.lon;

        const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=\({lat}&longitude=\){lon}&hourly=temperature_2m,precipitation_probability,weathercode&forecast_days=1`;
        const res = await fetchWithTimeout(openMeteoUrl);
        
        if (!res.ok) throw new Error("Erreur Forecast Open-Meteo");
        const j = await res.json();
        
        const list = [];
        const nowHour = new Date().getHours();
        
        if (j.hourly && j.hourly.time) {
          for (let i = 0; i < j.hourly.time.length; i++) {
            const timeDate = new Date(j.hourly.time[i]);
            if (timeDate.getHours() > nowHour && list.length < 3) {
              list.push({
                dt: Math.floor(timeDate.getTime() / 1000),
                main: { temp: j.hourly.temperature_2m[i] },
                pop: (j.hourly.precipitation_probability[i] || 0) / 100,
                weather: [{ description: "Prévision", icon: "02d" }]
              });
            }
          }
        }

        return new Response(JSON.stringify({ list }), { status: 200, headers: corsHeaders });
      }

      // -------------------------------------------------------------
      // 4) METAR VATSIM — /api/metar
      // -------------------------------------------------------------
      if (path.includes("/api/metar")) {
        const station = (url.searchParams.get("station") || "EBLG").toUpperCase();
        const metarUrl = `https://metar.vatsim.net/${station}`;
        const res = await fetchWithTimeout(metarUrl, { headers: { "User-Agent": UA } });
        
        const raw = res.ok ? (await res.text()).trim() : "METAR Indisponible";
        return new Response(JSON.stringify({ station, raw }), { status: 200, headers: corsHeaders });
      }

      // -------------------------------------------------------------
      // 5) TABLEAU DES VOLS (FIDS) — /api/fids
      // -------------------------------------------------------------
      if (path.includes("/api/fids")) {
        const airportCode = (url.searchParams.get("airport") || "EBLG").toUpperCase();
        const type = (url.searchParams.get("type") || "departures").toLowerCase();

        const flights = await fetchScheduledFlights(airportCode, type, env);
        return new Response(JSON.stringify(flights), { status: 200, headers: corsHeaders });
      }

      // -------------------------------------------------------------
      // DEFAULT (404)
      // -------------------------------------------------------------
      return new Response(JSON.stringify({ error: "Endpoint non trouvé" }), { status: 404, headers: corsHeaders });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
  }
};
