// =================================================================
// WORKER CLOUDFLARE - PROXY AÉRO
// =================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Configuration pour les endpoints ADS-B directes
const AIRPORTS = {
  ebci: { lat: 50.4594, lng: 4.4536 },
  eblg: { lat: 50.6378, lng: 5.4444 },
};
const DIST_NM = 25;
const UA = "AeroNoiseMonitor/1.0 (https://aero-sonic-pulse.base44.app)";

const RELAYS = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

// Helper pour convertir les codes météo WMO (Open-Meteo) en texte / icônes
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

async function fetchReadsb(base, ap, relay) {
  const target = `${base}/lat/${ap.lat}/lon/${ap.lng}/dist/${DIST_NM}`;
  const url = relay !== null ? RELAYS[relay](target) : target;
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
  if (!res.ok) return [];
  const j = await res.json();
  const list = Array.isArray(j) ? j : j.aircraft || j.ac || [];
  
  return list
    .filter((a) => typeof a.lat === "number" && typeof a.lon === "number")
    .map((a) => {
      const altFt = typeof a.alt_baro === "number" ? a.alt_baro : a.alt_baro === "ground" ? 0 : 0;
      const speedKt = typeof a.gs === "number" ? a.gs : 0;
      
      return [
        a.hex || "unknown",                         // [0] ICAO Hex
        (a.flight || a.r || "Inconnu").trim(),      // [1] Indicatif / Vol
        "BE",                                       // [2] Pays
        Math.floor(Date.now() / 1000),              // [3] Horodatage
        Math.floor(Date.now() / 1000),              // [4] Dernier contact
        a.lon,                                      // [5] Longitude
        a.lat,                                      // [6] Latitude
        altFt * 0.3048,                             // [7] Altitude (mètres)
        a.alt_baro === "ground",                    // [8] Au sol
        speedKt * 0.514444,                         // [9] Vitesse (m/s)
        typeof a.track === "number" ? a.track : 0   // [10] Cap / Heading
      ];
    });
}

async function fetchBothAdsb(base, relay) {
  const ebci = await fetchReadsb(base, AIRPORTS.ebci, relay).catch(() => []);
  const eblg = await fetchReadsb(base, AIRPORTS.eblg, relay).catch(() => []);
  return [...ebci, ...eblg];
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // -------------------------------------------------------------
      // 1. ENDPOINT RADAR AÉRIEN (ADSB.lol/fi -> FR24 -> OpenSky)
      // -------------------------------------------------------------
      if (path.includes("/api/opensky") || path.includes("/api/adsb")) {
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
            const deduplicated = mappedStates.filter((s) => {
              const k = `${s[0]}|${s[1]}`;
              if (seen.has(k)) return false;
              seen.add(k);
              return true;
            });

            return new Response(JSON.stringify({ states: deduplicated }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
        } catch (e) {
          console.log("ADSB direct/proxy indisponible, bascule sur FR24...", e);
        }

        try {
          const fr24Url = "https://data-cloud.flightradar24.com/zones/fcgi/feed.json?bounds=52.0,49.0,2.0,7.0&faa=1&satellite=1&mlat=1&flarm=1&adsb=1&gnd=0&air=1&vehicles=0&estimated=0";
          
          const fr24Res = await fetch(fr24Url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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
              const speedKmh = speedKts * 1.852;
              const isGroundFlag = Boolean(f[8]);

              if (isGroundFlag || speedKmh < 60 || altitudeMeters < 150) return;

              mappedStates.push([
                key,                          // [0] ICAO Hex
                f[16] || f[13] || "Inconnu",  // [1] Indicatif / Vol
                "BE",                         // [2] Pays
                f[10] || 0,                   // [3] Horodatage
                f[10] || 0,                   // [4] Dernier contact
                lon,                          // [5] Longitude
                lat,                          // [6] Latitude
                altitudeMeters,               // [7] Altitude (mètres)
                false,                        // [8] Au sol
                speedKts * 0.514444,          // [9] Vitesse (m/s)
                f[3] || 0                     // [10] Cap / Heading
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
          console.log("FR24 indisponible, bascule sur OpenSky...", e);
        }

        try {
          const openskyUrl = "https://opensky-network.org/api/states/all?lamin=49.0&lomin=2.0&lamax=52.0&lomax=7.0";
          const openskyRes = await fetch(openskyUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "application/json"
            }
          });

          if (openskyRes.ok) {
            const data = await openskyRes.json();
            if (data && Array.isArray(data.states) && data.states.length > 0) {
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
      // 2. ENDPOINT FIDS (Schedules & Flights)
      // -------------------------------------------------------------
      if (path.includes("/api/fids")) {
        const type = url.searchParams.get("type") || "departures";
        const airportCode = (url.searchParams.get("airport") || "EBLG").toUpperCase();
        
        const airlabsKey = env.AIRLABS_API_KEY || "VOTRE_CLE_AIRLABS";
        const aviationstackKey = env.AVIATIONSTACK_KEY || "VOTRE_CLE_AVIATIONSTACK";
        const rapidapiKey = env.RAPIDAPI_KEY || "VOTRE_CLE_RAPIDAPI";

        const cache = caches.default;
        const cacheKey = new Request(url.toString(), request);
        let cachedResponse = await cache.match(cacheKey);

        if (cachedResponse) {
          return cachedResponse;
        }

        const isDep = type === "departures";

        // Source 1 : AirLabs
        try {
          const paramName = isDep ? "dep_icao" : "arr_icao";
          const airlabsUrl = `https://airlabs.co/api/v9/schedules?${paramName}=${airportCode}&api_key=${airlabsKey}`;

          const resAirLabs = await fetch(airlabsUrl);
          if (resAirLabs.ok) {
            const data = await resAirLabs.json();
            if (data && Array.isArray(data.response) && data.response.length > 0) {
              const flights = data.response.slice(0, 10).map(f => {
                const targetCode = isDep ? (f.arr_iata || f.arr_icao || "Inconnu") : (f.dep_iata || f.dep_icao || "Inconnu");
                const timeRaw = isDep ? (f.dep_time || f.dep_estimated) : (f.arr_time || f.arr_estimated);
                
                let formattedTime = "--:--";
                if (timeRaw) {
                  const match = timeRaw.match(/\d{2}:\d{2}/);
                  if (match) formattedTime = match[0];
                }

                let status = "Programmé";
                const rawStatus = (f.status || "").toLowerCase();
                if (rawStatus.includes("active") || rawStatus.includes("en-route")) status = "En vol / Parti";
                else if (rawStatus.includes("landed")) status = "Atterri";
                else if (rawStatus.includes("cancelled")) status = "Annulé";

                return {
                  flight: f.flight_number || f.flight_iata || f.flight_icao || "N/C",
                  city: targetCode,
                  time: formattedTime,
                  status: status
                };
              });

              const responseToCache = new Response(JSON.stringify({ airport: airportCode, type, flights }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=300" }
              });
              ctx.waitUntil(cache.put(cacheKey, responseToCache.clone()));
              return responseToCache;
            }
          }
        } catch (e) {
          console.error("Échec AirLabs...", e);
        }

        // Source de secours MOCK
        const getDynamicTime = (offset) => {
          const now = new Date();
          now.setMinutes(now.getMinutes() + offset);
          return now.toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });
        };

        const mockEBCI = [
          { flight: "FR2104", city: "Marseille (MRS)", time: getDynamicTime(15), status: "Embarquement" },
          { flight: "W64512", city: "Bucarest (OTP)", time: getDynamicTime(45), status: "Programmé" }
        ];
        const mockEBLG = [
          { flight: "3V801", city: "Alicante (ALC)", time: getDynamicTime(10), status: "Embarquement" },
          { flight: "XQ120", city: "Antalya (AYT)", time: getDynamicTime(35), status: "Programmé" }
        ];

        return new Response(JSON.stringify({ airport: airportCode, type, flights: airportCode === "EBCI" ? mockEBCI : mockEBLG }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // -------------------------------------------------------------
      // 3. ENDPOINT MÉTÉO ACTUELLE (Open-Meteo -> Format OpenWeather)
      // -------------------------------------------------------------
      if (path.includes("/api/weather")) {
        const lat = url.searchParams.get("lat") || "50.6374";
        const lon = url.searchParams.get("lon") || "5.4432";

        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
        if (res.ok) {
          const data = await res.json();
          const cw = data.current_weather || {};
          const wmoInfo = decodeWmoCode(cw.weathercode ?? 0);

          const responseData = {
            main: { 
              temp: cw.temperature ?? 20 
            },
            wind: {
              speed: cw.windspeed ? Math.round((cw.windspeed / 3.6) * 10) / 10 : 0, // Converti km/h en m/s pour app.js
              deg: cw.winddirection ?? 0                                            // 'deg' au lieu de 'direction'
            },
            weather: [
              {
                description: wmoInfo.desc,
                icon: wmoInfo.icon
              }
            ]
          };

          return new Response(JSON.stringify(responseData), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }

      // -------------------------------------------------------------
      // 4. ENDPOINT TENDANCE MÉTÉO (Forecast Open-Meteo)
      // -------------------------------------------------------------
      if (path.includes("/api/forecast")) {
        const lat = url.searchParams.get("lat") || "50.6374";
        const lon = url.searchParams.get("lon") || "5.4432";

        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,windspeed_10m,weathercode,precipitation_probability&forecast_days=1`);
        
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
              const popProb = (data.hourly.precipitation_probability ? data.hourly.precipitation_probability[i] : 0) / 100;

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
      }

      // -------------------------------------------------------------
      // 5. ENDPOINT METAR
      // -------------------------------------------------------------
      if (path.includes("/api/metar")) {
        const station = (url.searchParams.get("station") || "EBLG").toUpperCase();
        const res = await fetch(`https://metar.vatsim.net/metar.php?id=${station}`);
        
        if (res.ok) {
          const rawMetar = await res.text();
          return new Response(JSON.stringify({ raw: rawMetar.trim() }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }

      return new Response("Endpoint non trouvé", { status: 404, headers: corsHeaders });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
