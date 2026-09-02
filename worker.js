// =================================================================
// WORKER CLOUDFLARE - PROXY AÉRO COMPLETE
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
      // 1. ENDPOINT RADAR AÉRIEN (/api/opensky)
      // -------------------------------------------------------------
      if (path.includes("/api/opensky")) {
        // SOURCE 1 : FLIGHTRADAR24
        try {
          const fr24Url = "https://data-cloud.flightradar24.com/zones/fcgi/feed.json?bounds=52.0,49.0,2.0,7.0&faa=1&satellite=1&mlat=1&flarm=1&adsb=1&gnd=0&air=1&vehicles=0&estimated=0";
          const fr24Res = await fetch(fr24Url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
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

              const speedKts = typeof f[5] === "number" ? f[5] : 0;
              const altitudeFeet = typeof f[4] === "number" ? f[4] : 0;
              const speedKmh = speedKts * 1.852;
              const altitudeMeters = altitudeFeet * 0.3048;

              // On garde les vols en mouvement (filtre large pour capter les décollages/atterrissages)
              if (speedKmh < 30) return;

              mappedStates.push([
                key,                          // [0] Hex ICAO
                (f[16] || f[13] || "N/C").trim(), // [1] Callsign / Vol
                "BE",                         // [2] Pays
                f[10] || 0,                   // [3] Timestamp
                f[10] || 0,                   // [4] Last contact
                lon,                          // [5] Longitude
                lat,                          // [6] Latitude
                altitudeMeters,               // [7] Altitude
                Boolean(f[8]),                // [8] Au sol
                speedKts * 0.514444,          // [9] Vitesse m/s
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
          console.log("FR24 indisponible, bascule OpenSky...", e);
        }

        // SOURCE 2 : OPENSKY NETWORK
        try {
          const openskyUrl = "https://opensky-network.org/api/states/all?lamin=49.0&lomin=2.0&lamax=52.0&lomax=7.0";
          const openskyRes = await fetch(openskyUrl, {
            headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
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
      // 2. ENDPOINT FIDS (/api/fids)
      // -------------------------------------------------------------
      if (path.includes("/api/fids")) {
        const type = url.searchParams.get("type") || "departures";
        const airportCode = (url.searchParams.get("airport") || "EBLG").toUpperCase();
        const isDep = type === "departures";

        // Capture des vols radar en direct pour injection GPS
        let livePositions = new Map();
        try {
          const radarReq = new Request(`${url.origin}/api/opensky`, request);
          const radarRes = await this.fetch(radarReq, env, ctx);
          if (radarRes.ok) {
            const radarData = await radarRes.json();
            (radarData.states || []).forEach(st => {
              const callsign = (st[1] || "").trim().toUpperCase().replace(/\s+/g, "");
              if (callsign && callsign !== "N/C") {
                livePositions.set(callsign, {
                  hex: st[0], lon: st[5], lat: st[6], alt: st[7], speed: st[9], track: st[10]
                });
              }
            });
          }
        } catch (e) {
          console.error("Erreur linkage radar:", e);
        }

        const enrichWithGPS = (flightObj) => {
          const cleanNum = (flightObj.flight || "").toUpperCase().replace(/\s+/g, "");
          let match = livePositions.get(cleanNum);
          if (!match) {
            for (let [cs, pos] of livePositions.entries()) {
              if (cs.includes(cleanNum) || cleanNum.includes(cs)) {
                match = pos;
                break;
              }
            }
          }
          return match ? { ...flightObj, hasGps: true, ...match } : { ...flightObj, hasGps: false, lat: null, lon: null };
        };

        // FR24 FIDS Source
        try {
          const fr24FidsUrl = `https://api.flightradar24.com/common/v1/airport.json?code=${airportCode.toLowerCase()}&plugin[]=&plugin-setting[schedule][mode]=${type}&plugin-setting[schedule][timestamp]=${Math.floor(Date.now() / 1000)}&page=1&limit=15`;
          const fr24Res = await fetch(fr24FidsUrl, {
            headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
          });

          if (fr24Res.ok) {
            const fr24Data = await fr24Res.json();
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

                const rawStatus = (f?.status?.text || "").toLowerCase();
                let status = "Programmé";
                if (rawStatus.includes("landed")) status = "Atterri";
                else if (rawStatus.includes("boarding")) status = "Embarquement";
                else if (rawStatus.includes("departed") || rawStatus.includes("en route")) status = "En vol / Parti";
                else if (rawStatus.includes("delayed")) status = "Retardé";
                else if (rawStatus.includes("cancelled")) status = "Annulé";

                return enrichWithGPS({
                  flight: f?.identification?.number?.default || f?.identification?.callsign || "N/C",
                  city: dest ? `${dest.position?.region?.city || dest.name} (${dest.code?.iata || ''})` : "Inconnu",
                  time: formattedTime,
                  status: status
                });
              });

              return new Response(JSON.stringify({ airport: airportCode, type, flights }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }
          }
        } catch (e) {
          console.error("Échec FR24 FIDS:", e);
        }

        // Mock Fallback
        const mockFlights = [
          { flight: "FR2104", city: "Marseille (MRS)", time: "14:30", status: "Embarquement", hasGps: true, lat: 50.4592, lon: 4.4538, track: 180, speed: 220 },
          { flight: "3V801", city: "Alicante (ALC)", time: "15:10", status: "Programmé", hasGps: false, lat: null, lon: null }
        ];

        return new Response(JSON.stringify({ airport: airportCode, type, flights: mockFlights }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
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
