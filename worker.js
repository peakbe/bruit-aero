// =================================================================
// WORKER CLOUDFLARE - PROXY AÉRO ND AIRBUS PRO+++
// =================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const UA = "AeroNoiseMonitor/1.0 (https://aero-sonic-pulse.base44.app)";
const DIST_NM = 25;

// Coordonnées pour ADS-B (radar)
const AIRPORTS = {
  ebci: { lat: 50.4594, lon: 4.4536 },
  eblg: { lat: 50.6378, lon: 5.4444 },
};

const RELAYS = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

// -------------------------------------------------------------
// Utils
// -------------------------------------------------------------
async function fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function decodeWmoCode(code) {
  if (code === 0) return { desc: "Ciel dégagé", icon: "01d" };
  if (code >= 1 && code <= 3) return { desc: "Partiellement nuageux", icon: "02d" };
  if (code >= 45 && code <= 48) return { desc: "Brouillard", icon: "50d" };
  if (code >= 51 && code <= 67) return { desc: "Pluie légère", icon: "10d" };
  if (code >= 71 && code <= 77) return { desc: "Neige", icon: "13d" };
  if (code >= 80 && code <= 82) return { desc: "Averses de pluie", icon: "09d" };
  if (code >= 95) return { desc: "Orage", icon: "11d" };
  return { desc: "Nuageux", icon: "03d" };
}

// -------------------------------------------------------------
// ADS-B helpers (adsb.lol / adsb.fi)
// -------------------------------------------------------------
async function fetchReadsb(base, ap, relay) {
  const target = `${base}/lat/${ap.lat}/lon/${ap.lon}/dist/${DIST_NM}`;
  const url = relay !== null ? RELAYS[relay](target) : target;

  const res = await fetchWithTimeout(url, {
    headers: { "User-Agent": UA, "Accept": "application/json" }
  });

  if (!res.ok) return [];

  const j = await res.json();
  const list = Array.isArray(j) ? j : j.aircraft || j.ac || [];

  return list
    .filter((a) => typeof a.lat === "number" && typeof a.lon === "number")
    .map((a) => {
      const altFt = typeof a.alt_baro === "number" ? a.alt_baro : 0;
      const speedKt = typeof a.gs === "number" ? a.gs : 0;

      return [
        a.hex || "unknown",
        (a.flight || a.r || "Inconnu").trim(),
        "BE",
        Math.floor(Date.now() / 1000),
        Math.floor(Date.now() / 1000),
        a.lon,
        a.lat,
        altFt * 0.3048,
        a.alt_baro === "ground",
        speedKt * 0.514444,
        typeof a.track === "number" ? a.track : 0
      ];
    });
}

async function fetchBothAdsb(base, relay) {
  const [ebci, eblg] = await Promise.all([
    fetchReadsb(base, AIRPORTS.ebci, relay).catch(() => []),
    fetchReadsb(base, AIRPORTS.eblg, relay).catch(() => []),
  ]);
  return [...ebci, ...eblg];
}

// =================================================================
// HANDLER PRINCIPAL
// =================================================================
export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {

      // -------------------------------------------------------------
      // 1. ADS-B MULTI-SOURCES (adsb.lol → adsb.fi → FR24 → OpenSky)
      // -------------------------------------------------------------
      if (path.includes("/api/opensky") || path.includes("/api/adsb-multi")) {
        try {
          const LOL = "https://api.adsb.lol/v2";
          const FI = "https://opendata.adsb.fi/api/v2";

          let mappedStates = [];

          for (const [base, relay] of [
            [LOL, null],
            [FI, null],
            [LOL, 0],
            [FI, 0],
            [LOL, 1],
          ]) {
            mappedStates = await fetchBothAdsb(base, relay);
            if (mappedStates.length > 0) break;
          }

          if (mappedStates.length > 0) {
            const seen = new Set();
            const dedup = mappedStates.filter((s) => {
              const k = `${s[0]}|${s[1]}`;
              if (seen.has(k)) return false;
              seen.add(k);
              return true;
            });

            return new Response(JSON.stringify({ states: dedup }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
        } catch (e) {
          console.log("ADSB direct/proxy indisponible, bascule FR24...", e);
        }

        // FR24 fallback
        try {
          const fr24Url =
            "https://data-cloud.flightradar24.com/zones/fcgi/feed.json?bounds=52.0,49.0,2.0,7.0&faa=1&satellite=1&mlat=1&flarm=1&adsb=1&gnd=0&air=1&vehicles=0&estimated=0";

          const fr24Res = await fetchWithTimeout(fr24Url, {
            headers: {
              "User-Agent": "Mozilla/5.0",
              "Accept": "application/json"
            }
          });

          if (fr24Res.ok) {
            const data = await fr24Res.json();
            const mappedStates = [];
            const systemKeys = ["full_count", "version", "stats"];

            Object.keys(data).forEach(key => {
              if (systemKeys.includes(key) || !Array.isArray(data[key])) return;

              const f = data[key];
              const lat = f[1];
              const lon = f[2];
              if (!lat || !lon || (lat === 0 && lon === 0)) return;

              const altitudeFeet = typeof f[4] === "number" ? f[4] : 0;
              const speedKts = typeof f[5] === "number" ? f[5] : 0;

              const altitudeMeters = altitudeFeet * 0.3048;
              const speedMs = speedKts * 0.514444;

              if (speedMs < 30 || altitudeMeters < 150) return;

              mappedStates.push([
                key,
                f[16] || f[13] || "Inconnu",
                "BE",
                f[10] || 0,
                f[10] || 0,
                lon,
                lat,
                altitudeMeters,
                false,
                speedMs,
                f[3] || 0
              ]);
            });

            if (mappedStates.length > 0) {
              return new Response(JSON.stringify({ states: mappedStates }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }
          }
        } catch (e) {
          console.log("FR24 indisponible, bascule OpenSky...", e);
        }

        // OpenSky fallback
        try {
          const openskyUrl =
            "https://opensky-network.org/api/states/all?lamin=49.0&lomin=2.0&lamax=52.0&lomax=7.0";

          const openskyRes = await fetchWithTimeout(openskyUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0",
              "Accept": "application/json"
            }
          });

          if (openskyRes.ok) {
            const data = await openskyRes.json();
            if (data && Array.isArray(data.states)) {
              return new Response(JSON.stringify(data), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }
          }
        } catch (e) {
          console.log("OpenSky indisponible...", e);
        }

        return new Response(JSON.stringify({ states: [] }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // -------------------------------------------------------------
      // 2. ADS-B Airplanes.live (radar map.js)
      // -------------------------------------------------------------
      if (path.startsWith("/api/adsb")) {
        try {
          const res = await fetchWithTimeout("https://api.airplanes.live/v2/positions");
          const data = await res.json();

          const aircraft = (data.aircraft || []).map(p => ({
            hex: p.hex,
            lat: p.lat,
            lon: p.lon,
            alt: p.alt_baro || p.altitude || 0,
            speed: p.gs || p.speed || 0,
            track: p.track || 0
          }));

          return new Response(JSON.stringify({ aircraft }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        } catch (e) {
          return new Response(JSON.stringify({ aircraft: [] }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }

      // -------------------------------------------------------------
      // 3. METEO ACTUELLE (Open-Meteo → format OpenWeather-like)
      // -------------------------------------------------------------
      if (path.includes("/api/weather")) {
        const lat = url.searchParams.get("lat") || "50.6374";
        const lon = url.searchParams.get("lon") || "5.4432";

        const res = await fetchWithTimeout(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`
        );

        if (res.ok) {
          const data = await res.json();
          const cw = data.current_weather || {};
          const wmoInfo = decodeWmoCode(cw.weathercode ?? 0);

          const responseData = {
            main: { temp: cw.temperature ?? 20 },
            wind: {
              speed: cw.windspeed ? Math.round((cw.windspeed / 3.6) * 10) / 10 : 0,
              deg: cw.winddirection ?? 0
            },
            weather: [{ description: wmoInfo.desc, icon: wmoInfo.icon }]
          };

          return new Response(JSON.stringify(responseData), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        return new Response(JSON.stringify({ error: "Weather unavailable" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

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
      // 6. FIDS UNIFIÉ (EBLG officiel + AirLabs + mock)
      // -------------------------------------------------------------
      if (path.includes("/api/fids")) {
        const airportCode = (url.searchParams.get("airport") || "EBLG").toUpperCase();

        const cache = caches.default;
        const cacheKey = new Request(url.toString(), request);
        let cachedResponse = await cache.match(cacheKey);
        if (cachedResponse) return cachedResponse;

        let arrivals = [];
        let departures = [];

        // 6.1 FIDS officiel Liège Airport pour EBLG
        if (airportCode === "EBLG") {
          try {
            const arrRes = await fetchWithTimeout(
              "https://fids.liegeairport.com/api/flights/Arrivals",
              {
                headers: {
                  "User-Agent": "Mozilla/5.0",
                  "Accept": "application/json"
                }
              }
            );

            const depRes = await fetchWithTimeout(
              "https://fids.liegeairport.com/api/flights/Departures",
              {
                headers: {
                  "User-Agent": "Mozilla/5.0",
                  "Accept": "application/json"
                }
              }
            );

            if (arrRes.ok) {
              const rawArr = await arrRes.json();
              arrivals = rawArr.slice(0, 30).map(f => ({
                flight: f.flightNumber || f.callsign || f.registration || "N/C",
                city: f.origin || f.airport || "Inconnu",
                time: f.scheduledTime || f.estimatedTime || f.time || "--:--",
                status: f.status || "Programmé",
                hex: f.hex || null
              }));
            }

            if (depRes.ok) {
              const rawDep = await depRes.json();
              departures = rawDep.slice(0, 30).map(f => ({
                flight: f.flightNumber || f.callsign || f.registration || "N/C",
                city: f.destination || f.airport || "Inconnu",
                time: f.scheduledTime || f.estimatedTime || f.time || "--:--",
                status: f.status || "Programmé",
                hex: f.hex || null
              }));
            }
          } catch (e) {
            console.error("Échec API FIDS Liège Airport, passage à AirLabs...", e);
          }
        }

        // 6.2 AirLabs pour EBCI + fallback EBLG
        const airlabsKey = env.AIRLABS_API_KEY || "VOTRE_CLE_AIRLABS";

        // Départs
        try {
          const depUrl =
            `https://airlabs.co/api/v9/schedules?dep_icao=${airportCode}&api_key
