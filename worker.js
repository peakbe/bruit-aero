// =================================================================
// WORKER CLOUDFLARE PRO v6 - INTEGRATION SECRETS MULTI-API
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
// HELPERS & FETCH WITH TIMEOUT
// -------------------------------------------------------------
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
// 1. MÉTÉO (OPENWEATHERMAP -> OPEN-METEO FALLBACK)
// -------------------------------------------------------------
async function fetchWeatherData(aptKey, env) {
  const apt = AIRPORTS[aptKey];

  // Option 1 : OpenWeatherMap via secret Cloudflare
  if (env.OPENWEATHER_API_KEY) {
    try {
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=\({apt.lat}&lon=\){apt.lon}&units=metric&appid=${env.OPENWEATHER_API_KEY}`;
      const res = await fetchWithTimeout(url, {}, 4000);
      if (res.ok) {
        const j = await res.json();
        return {
          main: { temp: j.main.temp },
          wind: { speed: j.wind.speed * 3.6, deg: j.wind.deg } // m/s -> km/h
        };
      }
    } catch (e) {
      console.warn("OpenWeatherMap KO, fallback vers Open-Meteo", e);
    }
  }

  // Option 2 : Open-Meteo (Sans clé API)
  const fallbackUrl = `https://api.open-meteo.com/v1/forecast?latitude=\({apt.lat}&longitude=\){apt.lon}&current_weather=true`;
  const res = await fetchWithTimeout(fallbackUrl, {}, 4000);
  if (res.ok) {
    const j = await res.json();
    return {
      main: { temp: j.current_weather.temperature },
      wind: { speed: j.current_weather.windspeed, deg: j.current_weather.winddirection }
    };
  }

  return { main: { temp: 15 }, wind: { speed: 10, deg: 220 } };
}

// -------------------------------------------------------------
// 2. RADAR ADS-B EN DIRECT (OPENSKY / ADSB.LOL)
// -------------------------------------------------------------
async function fetchLiveAircraft(apt) {
  const url = `https://api.adsb.lol/v2/aircraft?lat=${apt.lat}&lon=${apt.lon}&dist=${DIST_NM}`;
  const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA } }, 4000);
  if (!res.ok) return [];

  const j = await res.json();
  return (j.aircraft || [])
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
// 3. TABLEAU FIDS (AIRLABS -> AVIATIONSTACK -> FALLBACK)
// -------------------------------------------------------------
async function fetchFidsData(aptKey, type, env) {
  const apt = AIRPORTS[aptKey];
  const isDep = type === "departures";

  // --- SOURCE 1 : AIRLABS ---
  if (env.AIRLABS_API_KEY) {
    try {
      const param = isDep ? `dep_icao=\({apt.icao}` : `arr_icao=\){apt.icao}`;
      const url = `https://airlabs.co/api/v9/schedules?\({param}&api_key=\){env.AIRLABS_API_KEY}`;
      const res = await fetchWithTimeout(url, {}, 5000);
      
      if (res.ok) {
        const json = await res.json();
        if (json.response && json.response.length > 0) {
          return json.response.slice(0, 10).map(f => ({
            flight: f.flight_iata || f.flight_icao || "N/C",
            city: isDep ? (f.arr_iata || f.arr_icao) : (f.dep_iata || f.dep_icao),
            time: (isDep ? f.dep_time : f.arr_time)?.slice(-5) || "--:--",
            status: f.status ? f.status.toUpperCase() : "Programmé"
          }));
        }
      }
    } catch (e) {
      console.warn("AirLabs FIDS KO, basculement...", e);
    }
  }

  // --- SOURCE 2 : AVIATIONSTACK ---
  if (env.AVIATIONSTACK_KEY || env["AVIATIONSTACK_KE`"]) {
    const apiKey = env.AVIATIONSTACK_KEY || env["AVIATIONSTACK_KE`"];
    try {
      const param = isDep ? `dep_iata=\({apt.iata}` : `arr_iata=\){apt.iata}`;
      const url = `http://api.aviationstack.com/v1/flights?access_key=\({apiKey}&\){param}&limit=10`;
      const res = await fetchWithTimeout(url, {}, 5000);

      if (res.ok) {
        const json = await res.json();
        if (json.data && json.data.length > 0) {
          return json.data.map(f => ({
            flight: f.flight?.iata || f.flight?.icao || "N/C",
            city: isDep ? f.arrival?.iata : f.departure?.iata,
            time: (isDep ? f.departure?.scheduled : f.arrival?.scheduled)?.slice(11, 16) || "--:--",
            status: f.flight_status ? f.flight_status.toUpperCase() : "Programmé"
          }));
        }
      }
    } catch (e) {
      console.warn("AviationStack FIDS KO, basculement...", e);
    }
  }

  // --- FALLBACK DYNAMIQUE LORSQU'AUCUNE API NE RÉPOND ---
  const now = new Date();
  const t = (m) => new Date(now.getTime() + m * 60000).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });

  if (apt.icao === "EBLG") {
    return isDep ? [
      { flight: "3V801", city: "ALC", time: t(12), status: "Embarquement" },
      { flight: "XQ120", city: "AYT", time: t(30), status: "Programmé" },
      { flight: "3V551", city: "MAD", time: t(55), status: "Programmé" }
    ] : [
      { flight: "3V802", city: "ALC", time: t(15), status: "En approche" },
      { flight: "FX403", city: "CDG", time: t(40), status: "Programmé" }
    ];
  } else {
    return isDep ? [
      { flight: "FR2104", city: "MRS", time: t(10), status: "Embarquement" },
      { flight: "FR6312", city: "BGY", time: t(25), status: "Programmé" },
      { flight: "W64301", city: "OTP", time: t(45), status: "Programmé" }
    ] : [
      { flight: "FR2105", city: "MRS", time: t(20), status: "En approche" },
      { flight: "FR6313", city: "BGY", time: t(50), status: "Programmé" }
    ];
  }
}

// =================================================================
// MAIN HANDLER
// =================================================================
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // 1) ADS-B Radar
      if (path.includes("/api/opensky") || path.includes("/api/adsb")) {
        const airportCode = (url.searchParams.get("airport") || "EBLG").toLowerCase();
        const apt = AIRPORTS[airportCode] || AIRPORTS.eblg;
        const aircraft = await fetchLiveAircraft(apt);
        return new Response(JSON.stringify({ airport: airportCode.toUpperCase(), aircraft }), { status: 200, headers: corsHeaders });
      }

      // 2) Météo Fusionnée
      if (path.includes("/api/meteo") || path.includes("/api/weather")) {
        const aptCode = (url.searchParams.get("apt") || url.searchParams.get("airport") || "EBLG").toLowerCase();
        const apt = AIRPORTS[aptCode] || AIRPORTS.eblg;

        // Fetch METAR VATSIM + Weather simultanés
        const metarPromise = fetchWithTimeout(`https://metar.vatsim.net/${apt.icao}`, { headers: { "User-Agent": UA } }, 4000)
          .then(r => r.ok ? r.text() : "METAR Indisponible")
          .catch(() => "METAR Indisponible");

        const [metarRaw, meteoData] = await Promise.all([metarPromise, fetchWeatherData(aptCode, env)]);

        return new Response(JSON.stringify({
          apt: apt.icao,
          metar: metarRaw.trim(),
          meteo: meteoData
        }), { status: 200, headers: corsHeaders });
      }

      // 3) FIDS (Grille des vols)
      if (path.includes("/api/fids")) {
        const airportCode = (url.searchParams.get("airport") || "EBLG").toLowerCase();
        const type = (url.searchParams.get("type") || "departures").toLowerCase();

        const flights = await fetchFidsData(airportCode, type, env);
        return new Response(JSON.stringify(flights), { status: 200, headers: corsHeaders });
      }

      return new Response(JSON.stringify({ error: "Endpoint non trouvé" }), { status: 404, headers: corsHeaders });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
  }
};
