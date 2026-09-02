// =================================================================
// WORKER CLOUDFLARE - PROXY AÉRO
// =================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // -------------------------------------------------------------
      // 1. ENDPOINT RADAR AÉRIEN (FR24 -> OpenSky -> ADSB.lol)
      // -------------------------------------------------------------
      if (path.includes("/api/opensky")) {
        // --- NIVEAU 1 : FLIGHTRADAR24 ---
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
                key,
                f[16] || f[13] || "Inconnu",
                "BE",
                f[10] || 0,
                f[10] || 0,
                lon,
                lat,
                altitudeMeters,
                false,
                speedKts * 0.514444,
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
          console.log("FR24 indisponible, bascule sur OpenSky...", e);
        }

        // --- NIVEAU 2 : OPENSKY NETWORK ---
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
          console.log("OpenSky indisponible, bascule sur ADSB.lol...", e);
        }

        // --- NIVEAU 3 : ADSB.LOL ---
        try {
          const adsbRes = await fetch("https://api.adsb.lol/v2/lat/50.55/lon/4.95/dist/100");
          if (adsbRes.ok) {
            const adsbData = await adsbRes.json();
            const mappedStates = (adsbData.ac || []).map((ac) => [
              ac.hex,
              ac.flight || "Inconnu",
              "BE",
              ac.seen,
              ac.seen,
              ac.lon,
              ac.lat,
              ac.alt_geom ? ac.alt_geom * 0.3048 : null,
              false,
              ac.gs ? ac.gs * 0.514444 : null,
              ac.track || 0
            ]);

            return new Response(JSON.stringify({ states: mappedStates }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
        } catch (e) {
          console.error("Erreur fallback ADSB:", e);
        }

        return new Response(JSON.stringify({ states: [] }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // -------------------------------------------------------------
      // 2. ENDPOINT FIDS (AirLabs -> Aviationstack -> AeroDataBox -> FR24 -> Mock)
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

        // --- SOURCE 1 : AIRLABS.CO ---
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
          console.error("Échec AirLabs, bascule sur Aviationstack...", e);
        }

        // --- SOURCE 2 : AVIATIONSTACK ---
        try {
          const paramName = isDep ? "dep_icao" : "arr_icao";
          // Correction de HTTP vers HTTPS
          const aviationUrl = `https://api.aviationstack.com/v1/flights?access_key=${aviationstackKey}&${paramName}=${airportCode}&limit=10`;

          const resAviation = await fetch(aviationUrl);
          if (resAviation.ok) {
            const data = await resAviation.json();
            if (data && Array.isArray(data.data) && data.data.length > 0) {
              const flights = data.data.map(f => {
                const airportData = isDep ? f.arrival : f.departure;
                const flightInfo = f.flight;

                const timeRaw = isDep ? f.departure?.scheduled : f.arrival?.scheduled;
                let formattedTime = "--:--";
                if (timeRaw) {
                  const match = timeRaw.match(/T(\d{2}:\d{2})/);
                  if (match) formattedTime = match[1];
                }

                let status = "Programmé";
                const rawStatus = (f.flight_status || "").toLowerCase();
                if (rawStatus.includes("active")) status = "En vol / Parti";
                else if (rawStatus.includes("landed")) status = "Atterri";
                else if (rawStatus.includes("cancelled")) status = "Annulé";

                return {
                  flight: flightInfo?.iata || flightInfo?.number || "N/C",
                  city: `${airportData?.airport || 'Inconnu'} (${airportData?.iata || ''})`,
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
          console.error("Échec Aviationstack, bascule sur AeroDataBox...", e);
        }

        // --- SOURCE 3 : AERODATABOX ---
        try {
          const now = new Date();
          const fromLocal = now.toISOString().substring(0, 16);
          const future = new Date(now.getTime() + 12 * 60 * 60 * 1000);
          const toLocal = future.toISOString().substring(0, 16);

          const direction = isDep ? "Departures" : "Arrivals";
          const targetUrl = `https://aerodatabox.p.rapidapi.com/flights/airports/icao/${airportCode}/${fromLocal}/${toLocal}?direction=${direction}&withLeg=true&withCancelled=true&withCodeshares=false&withCargo=true&withPrivate=true`;

          const apiRes = await fetch(targetUrl, {
            headers: {
              "x-rapidapi-key": rapidapiKey,
              "x-rapidapi-host": "aerodatabox.p.rapidapi.com"
            }
          });

          if (apiRes.ok) {
            const data = await apiRes.json();
            const rawList = isDep ? data.departures : data.arrivals;

            if (rawList && Array.isArray(rawList) && rawList.length > 0) {
              const flights = rawList.slice(0, 10).map((f) => {
                const movement = isDep ? f.departure : f.arrival;
                const destAirport = isDep ? f.arrival?.airport : f.departure?.airport;

                const timeRaw = movement?.scheduledTime?.local || movement?.revisedTime?.local || "";
                let formattedTime = "--:--";
                if (timeRaw) {
                  const match = timeRaw.match(/\d{2}:\d{2}/);
                  if (match) formattedTime = match[0];
                }

                let flightNum = f.number || f.callSign || (f.airline ? f.airline.name : "N/A");
                const cityName = destAirport?.municipalityName || destAirport?.name || "Inconnu";
                const iata = destAirport?.iata ? ` (${destAirport.iata})` : "";

                let status = "Programmé";
                const rawStatus = (f.status || "").toLowerCase();
                if (rawStatus.includes("enroute") || rawStatus.includes("active") || rawStatus.includes("departed")) status = "En vol / Parti";
                else if (rawStatus.includes("landed")) status = "Atterri";
                else if (rawStatus.includes("canceled") || rawStatus.includes("cancelled")) status = "Annulé";
                else if (rawStatus.includes("delayed")) status = "Retardé";
                else if (rawStatus.includes("estimated")) status = "Estimé";
                else if (rawStatus.includes("boarding")) status = "Embarquement";

                return {
                  flight: flightNum,
                  city: `${cityName}${iata}`,
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
          console.error("Échec AeroDataBox, bascule sur FR24 FIDS...", e);
        }

        // --- SOURCE 4 : FLIGHTRADAR24 FIDS ---
        try {
          const fr24FidsUrl = `https://api.flightradar24.com/common/v1/airport.json?code=${airportCode.toLowerCase()}&plugin[]=&plugin-setting[schedule][mode]=${type}&plugin-setting[schedule][timestamp]=${Math.floor(Date.now() / 1000)}&page=1&limit=10`;
          
          const fr24FidsRes = await fetch(fr24FidsUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "application/json"
            }
          });

          if (fr24FidsRes.ok) {
            const fr24Data = await fr24FidsRes.json();
            const listData = fr24Data?.result?.response?.airport?.pluginData?.schedule?.[type]?.data || [];

            if (listData.length > 0) {
              const flights = listData.map(item => {
                const f = item.flight;
                const dest = isDep ? f?.airport?.destination : f?.airport?.origin;
                const timestamp = isDep ? f?.time?.scheduled?.departure : f?.time?.scheduled?.arrival;
                
                let formattedTime = "--:--";
                if (timestamp) {
                  const date = new Date(timestamp * 1000);
                  formattedTime = date.toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });
                }

               const rawFr24Status = (f?.status?.text || "").toLowerCase();
let mappedStatus = "Programmé";

if (rawFr24Status.includes("landed")) {
  mappedStatus = "Atterri";
} else if (rawFr24Status.includes("boarding")) {
  mappedStatus = "Embarquement";
} else if (rawFr24Status.includes("departed") || rawFr24Status.includes("en route") || rawFr24Status.includes("en-route")) {
  mappedStatus = "En vol / Parti";
} else if (rawFr24Status.includes("delayed")) {
  mappedStatus = "Retardé";
} else if (rawFr24Status.includes("cancelled") || rawFr24Status.includes("canceled")) {
  mappedStatus = "Annulé";
} else {
  // Les mentions "Estimated HH:MM" restent marquées "Programmé" tant qu'il n'y a pas de retard explicite
  mappedStatus = "Programmé";
}

                return {
                  flight: f?.identification?.number?.default || f?.identification?.callsign || "N/C",
                  city: dest ? `${dest.position?.region?.city || dest.name} (${dest.code?.iata || ''})` : "Inconnu",
                  time: formattedTime,
                  status: mappedStatus
                };
              });

              return new Response(JSON.stringify({ airport: airportCode, type, flights }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }
          }
        } catch (e) {
          console.error("Échec FR24 FIDS, bascule sur Mock...", e);
        }

        // --- SOURCE 5 : DONNÉES FICTIVES DE SECOURS (MOCK) ---
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
      // 3. ENDPOINT MÉTÉO ACTUELLE (Open-Meteo)
      // -------------------------------------------------------------
      if (path.includes("/api/weather")) {
        const lat = url.searchParams.get("lat") || "50.6374";
        const lon = url.searchParams.get("lon") || "5.4432";

        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
        if (res.ok) {
          const data = await res.json();
          const responseData = {
            main: { temp: data.current_weather ? data.current_weather.temperature : 20 },
            wind: {
              speed: data.current_weather ? Math.round(data.current_weather.windspeed / 3.6 * 10) / 10 : 0,
              direction: data.current_weather ? data.current_weather.winddirection : 0
            }
          };
          return new Response(JSON.stringify(responseData), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }

      // -------------------------------------------------------------
      // 4. ENDPOINT TENDANCE MÉTÉO (Open-Meteo)
      // -------------------------------------------------------------
      if (path.includes("/api/forecast")) {
        const lat = url.searchParams.get("lat") || "50.6374";
        const lon = url.searchParams.get("lon") || "5.4432";

        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,windspeed_10m,weathercode&forecast_days=1`);
        
        if (res.ok) {
          const data = await res.json();
          const list = [];
          const nowHour = new Date().getHours();

          if (data.hourly && data.hourly.time) {
            for (let i = nowHour; i < nowHour + 4 && i < data.hourly.time.length; i++) {
              const dateObj = new Date(data.hourly.time[i]);
              const windKmh = data.hourly.windspeed_10m[i];
              const windMs = Math.round((windKmh / 3.6) * 10) / 10;

              list.push({
                dt: Math.floor(dateObj.getTime() / 1000),
                main: { temp: data.hourly.temperature_2m[i] },
                wind: { speed: windMs },
                weather: [{ icon: "01d" }]
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
      // 5. ENDPOINT METAR (VATSIM API)
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
