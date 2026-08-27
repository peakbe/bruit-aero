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
      // 1. ENDPOINT RADAR (OpenSky avec Fallback ADSB.lol)
      // -------------------------------------------------------------
      if (path === "/api/opensky") {
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
          console.log("OpenSky indisponible, bascule sur ADSB.lol");
        }

        try {
          const adsbRes = await fetch("https://api.adsb.lol/v2/lat/50.55/lon/4.95/dist/100");
          if (adsbRes.ok) {
            const adsbData = await adsbRes.json();
            
            const mappedStates = (adsbData.ac || []).map((ac) => [
              ac.hex,                            // 0: ICAO24
              ac.flight || "Inconnu",            // 1: Callsign
              "BE",                              // 2: Country
              ac.seen,                           // 3: Time
              ac.seen,                           // 4: Last contact
              ac.lon,                            // 5: Longitude
              ac.lat,                            // 6: Latitude
              ac.alt_geom ? ac.alt_geom * 0.3048 : null, // 7: Altitude (mètres)
              false,                             // 8: On ground
              ac.gs ? ac.gs * 0.514444 : null,   // 9: Speed (m/s)
              ac.track || 0                      // 10: Cap / Heading
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
      // 2. ENDPOINT FIDS (AERODATABOX - PARSING FIXÉ)
      // -------------------------------------------------------------
      if (path.includes("/api/fids")) {
        const type = url.searchParams.get("type") || "departures";
        const airportCode = (url.searchParams.get("airport") || "EBLG").toUpperCase();

        const apiKey = env.RAPIDAPI_KEY || "VOTRE_CLE_RAPIDAPI_ICI";

        try {
          // Format strict exigé par AeroDataBox : YYYY-MM-DDTHH:mm
          const now = new Date();
          const from = now.toISOString().substring(0, 16);
          const future = new Date(now.getTime() + 12 * 60 * 60 * 1000);
          const to = future.toISOString().substring(0, 16);

          const isDep = type === "departures";
          const direction = isDep ? "Departures" : "Arrivals";

          const targetUrl = `https://aerodatabox.p.rapidapi.com/flights/airports/icao/${airportCode}/${from}/${to}?direction=${direction}&withLeg=true&withCancelled=true&withCodeshares=false&withCargo=true&withPrivate=true`;

          const apiRes = await fetch(targetUrl, {
            headers: {
              "x-rapidapi-key": apiKey,
              "x-rapidapi-host": "aerodatabox.p.rapidapi.com"
            }
          });

          if (apiRes.ok) {
            const data = await apiRes.json();
            
            // AeroDataBox sépare en data.departures et data.arrivals
            const rawList = isDep ? data.departures : data.arrivals;

            if (rawList && Array.isArray(rawList) && rawList.length > 0) {
              const flights = rawList.slice(0, 10).map((f) => {
                const movement = isDep ? f.departure : f.arrival;
                const destinationAirport = isDep ? f.arrival?.airport : f.departure?.airport;
                
                // Récupération de l'heure (Scheduled ou Revised)
                const timeStr = movement?.scheduledTime?.local || movement?.revisedTime?.local || movement?.scheduledTime?.utc;

                let formattedTime = "--:--";
                if (timeStr) {
                  // Extraction de "HH:mm" à partir de "2026-08-27 06:33+02:00" ou ISO
                  const timeMatch = timeStr.match(/\d{2}:\d{2}/);
                  if (timeMatch) {
                    formattedTime = timeMatch[0];
                  }
                }

                // Récupération du numéro de vol (priorité : number > callSign > airline)
                const flightNum = f.number || f.callSign || (f.airline?.iata ? `${f.airline.iata}---` : "N/A");

                // Nom de la destination / provenance
                const cityName = destinationAirport?.municipalityName || destinationAirport?.name || "Inconnu";
                const iataCode = destinationAirport?.iata ? ` (${destinationAirport.iata})` : "";

                // Traduction des statuts AeroDataBox
                let status = "Programmé";
                const rawStatus = (f.status || "").toLowerCase();
                if (rawStatus.includes("enroute") || rawStatus.includes("active") || rawStatus.includes("departed")) {
                  status = "En vol / Parti";
                } else if (rawStatus.includes("landed")) {
                  status = "Atterri";
                } else if (rawStatus.includes("boarding")) {
                  status = "Embarquement";
                } else if (rawStatus.includes("canceled") || rawStatus.includes("cancelled")) {
                  status = "Annulé";
                }

                return {
                  flight: flightNum,
                  city: `${cityName}${iataCode}`,
                  time: formattedTime,
                  status: status
                };
              });

              return new Response(JSON.stringify({ airport: airportCode, type, flights }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }
          }
        } catch (e) {
          console.error("Erreur de parsing AeroDataBox:", e);
        }

        // --- FALLBACK DE SECOURS ---
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
      // 3. ENDPOINT MÉTÉO ACTUELLE (Open-Meteo API)
      // -------------------------------------------------------------
      if (path.includes("/api/weather")) {
        const lat = url.searchParams.get("lat") || "50.6374";
        const lon = url.searchParams.get("lon") || "5.4432";

        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
        if (res.ok) {
          const data = await res.json();
          const responseData = {
            main: { temp: data.current_weather ? data.current_weather.temperature : 20 },
            wind: { speed: data.current_weather ? Math.round(data.current_weather.windspeed / 3.6 * 10) / 10 : 0 } // Conversion km/h -> m/s
          };
          return new Response(JSON.stringify(responseData), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }

      // -------------------------------------------------------------
      // 4. ENDPOINT TENDANCE MÉTÉO (Open-Meteo Hourly API)
      // -------------------------------------------------------------
      if (path.includes("/api/forecast")) {
        const lat = url.searchParams.get("lat") || "50.6374";
        const lon = url.searchParams.get("lon") || "5.4432";

        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,windspeed_10m,weathercode&forecast_days=1`);
        
        if (res.ok) {
          const data = await res.json();
          
          // Formatage des données hourly pour correspondre à la structure demandée par app.js
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
