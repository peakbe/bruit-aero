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
      // 2. ENDPOINT FIDS (VOLS DÉPARTS / ARRIVÉES - 10 VOLS PAR CATEGORIE)
      // -------------------------------------------------------------
      if (path.includes("/api/fids")) {
        const type = url.searchParams.get("type") || "departures";
        const airport = (url.searchParams.get("airport") || "EBLG").toUpperCase();
        
        let mockFlights = [];

        if (airport === "EBLG") {
          mockFlights = type === "departures" 
            ? [
                { flight: "3V801", city: "Alicante (ALC)", time: "14:30", status: "Embarquement" },
                { flight: "XQ120", city: "Antalya (AYT)", time: "15:15", status: "Programmé" },
                { flight: "TB2111", city: "Tenerife (TFS)", time: "16:00", status: "Programmé" },
                { flight: "3V502", city: "Zaragoza (ZAZ)", time: "16:45", status: "Programmé" },
                { flight: "3V991", city: "New York (JFK)", time: "17:30", status: "Programmé" },
                { flight: "BJ512", city: "Djerba (DJE)", time: "18:10", status: "Programmé" },
                { flight: "3V104", city: "Dubai (DWC)", time: "19:00", status: "Programmé" },
                { flight: "XQ122", city: "Izmir (ADB)", time: "20:15", status: "Programmé" },
                { flight: "3V303", city: "Hangzhou (HGH)", time: "21:40", status: "Programmé" },
                { flight: "TB3012", city: "Las Palmas (LPA)", time: "22:15", status: "Programmé" }
              ]
            : [
                { flight: "3V802", city: "Madrid (MAD)", time: "14:10", status: "Atterri" },
                { flight: "TB211", city: "Tenerife (TFS)", time: "14:55", status: "En approche" },
                { flight: "3V501", city: "Cologne (CGN)", time: "15:30", status: "Programmé" },
                { flight: "XQ121", city: "Antalya (AYT)", time: "16:20", status: "Programmé" },
                { flight: "3V992", city: "Atlanta (ATL)", time: "17:05", status: "Programmé" },
                { flight: "BJ513", city: "Monastir (MIR)", time: "18:00", status: "Programmé" },
                { flight: "3V105", city: "Riyad (RUH)", time: "18:50", status: "Programmé" },
                { flight: "3V304", city: "Liège Cargo North", time: "19:35", status: "Programmé" },
                { flight: "TB3013", city: "Fuerteventura (FUE)", time: "20:40", status: "Programmé" },
                { flight: "3V804", city: "Valence (VLC)", time: "21:50", status: "Programmé" }
              ];
        } else if (airport === "EBCI") {
          mockFlights = type === "departures" 
            ? [
                { flight: "FR2104", city: "Marseille (MRS)", time: "16:20", status: "Embarquement" },
                { flight: "W64512", city: "Bucarest (OTP)", time: "17:00", status: "Programmé" },
                { flight: "FR1933", city: "Dublin (DUB)", time: "17:40", status: "Programmé" },
                { flight: "FR6312", city: "Barcelone (BCN)", time: "18:15", status: "Programmé" },
                { flight: "FR2952", city: "Porto (OPO)", time: "18:50", status: "Programmé" },
                { flight: "W63001", city: "Budapest (BUD)", time: "19:25", status: "Programmé" },
                { flight: "FR8113", city: "Rome (CIA)", time: "20:00", status: "Programmé" },
                { flight: "FR4912", city: "Lisbonne (LIS)", time: "20:35", status: "Programmé" },
                { flight: "FR1002", city: "Cracovie (KRK)", time: "21:10", status: "Programmé" },
                { flight: "FR6108", city: "Milan (BGY)", time: "21:45", status: "Programmé" }
              ]
            : [
                { flight: "FR1932", city: "Dublin (DUB)", time: "15:40", status: "Atterri" },
                { flight: "FR6311", city: "Barcelone (BCN)", time: "16:15", status: "En approche" },
                { flight: "W64511", city: "Bucarest (OTP)", time: "16:45", status: "Programmé" },
                { flight: "FR2103", city: "Marseille (MRS)", time: "17:15", status: "Programmé" },
                { flight: "FR2951", city: "Porto (OPO)", time: "18:10", status: "Programmé" },
                { flight: "W63002", city: "Budapest (BUD)", time: "18:45", status: "Programmé" },
                { flight: "FR8112", city: "Rome (CIA)", time: "19:20", status: "Programmé" },
                { flight: "FR4911", city: "Lisbonne (LIS)", time: "19:55", status: "Programmé" },
                { flight: "FR1001", city: "Cracovie (KRK)", time: "20:30", status: "Programmé" },
                { flight: "FR6107", city: "Milan (BGY)", time: "21:05", status: "Programmé" }
              ];
        }

        return new Response(JSON.stringify({ airport, type, flights: mockFlights }), {
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
