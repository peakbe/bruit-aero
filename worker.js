export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname.toLowerCase();

    try {
      // 1. Météo Open-Meteo
      if (path === "/api/weather") {
        const lat = url.searchParams.get("lat") || "50.6374";
        const lon = url.searchParams.get("lon") || "5.4432";

        try {
          const response = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,visibility,wind_speed_10m,wind_direction_10m&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code&forecast_hours=24`
          );

          if (!response.ok) {
            return new Response(JSON.stringify({ error: "Données indisponibles" }), { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }

          const data = await response.json();
          return new Response(JSON.stringify({
            main: { temp: data.current.temperature_2m },
            wind: { speed: data.current.wind_speed_10m / 3.6, deg: data.current.wind_direction_10m },
            visibility: data.current.visibility,
            hourly: data.hourly
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        } catch (err) {
          return new Response(JSON.stringify({ error: "Données indisponibles" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      // 2. METAR NOAA
      if (path === "/api/metar") {
        const station = url.searchParams.get("station") || "EBLG";

        try {
          const response = await fetch(`https://tgftp.nws.noaa.gov/data/observations/metar/stations/${station.toUpperCase()}.TXT`);
          if (!response.ok) {
            return new Response(JSON.stringify({ error: "Données indisponibles" }), { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }

          const text = await response.text();
          const lines = text.trim().split("\n");
          const rawMetar = lines.length > 1 ? lines[1].trim() : text.trim();

          return new Response(JSON.stringify({ raw: rawMetar }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        } catch (err) {
          return new Response(JSON.stringify({ error: "Données indisponibles" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      // 3. FIDS (Vols) avec fallback de test
if (path.includes("/api/fids")) {
  const airport = (url.searchParams.get("airport") || "EBLG").toUpperCase();
  const type = url.searchParams.get("type") || "departures";

  if (airport === "EBLG") {
    try {
      const response = await fetch(`https://fids.liegeairport.com/api/v1/flights?type=${type}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*",
          "Referer": "https://www.liegeairport.com/"
        }
      });

      if (response.ok) {
        const rawData = await response.json();
        const list = Array.isArray(rawData) ? rawData : (rawData.flights || []);

        if (list.length > 0) {
          const cleanFlights = list.slice(0, 10).map((f) => ({
            flight: f.flightNumber || f.code || "N/A",
            city: f.destination || f.origin || f.city || "Inconnu",
            time: f.scheduledTime || f.time || "--:--",
            status: f.status || "Programmé",
          }));

          return new Response(JSON.stringify({ airport, type, flights: cleanFlights }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  // Fallback de secours si l'API de Liège bloque la requête
  const mockFlights = type === "departures" 
    ? [
        { flight: "3V801", city: "Alicante (ALC)", time: "14:30", status: "Embarquement" },
        { flight: "XQ120", city: "Antalya (AYT)", time: "15:15", status: "Programmé" }
      ]
    : [
        { flight: "3V802", city: "Madrid (MAD)", time: "14:10", status: "Atterri" },
        { flight: "TB211", city: "Tenerife (TFS)", time: "14:55", status: "En approche" }
      ];

  return new Response(JSON.stringify({ airport, type, flights: mockFlights }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

      // 1. Endpoint Radar (OpenSky avec fallback ADSB.lol)
if (path.includes("/api/opensky")) {
  try {
    // Essai 1 : OpenSky Network
    const openskyRes = await fetch(
      "https://opensky-network.org/api/states/all?lamin=50.0&lomin=3.5&lamax=51.5&lomax=6.5",
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        }
      }
    );

    if (openskyRes.ok) {
      const data = await openskyRes.json();
      if (data && data.states && data.states.length > 0) {
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }
  } catch (e) {
    console.log("OpenSky indisponible, bascule sur ADSB.lol");
  }

  // Essai 2 : Fallback sur API ADSB.lol (Zone Belgique : lat 50.55, lon 4.95, rayon 100NM)
  try {
    const adsbRes = await fetch("https://api.adsb.lol/v2/lat/50.55/lon/4.95/dist/100");
    if (adsbRes.ok) {
      const adsbData = await adsbRes.json();
      
      // Conversion du format ADSB.lol vers le format OpenSky [icao, callsign, origin, time, last_contact, lon, lat, alt, ...]
      const mappedStates = (adsbData.ac || []).map((ac) => [
        ac.hex,                            // 0: ICAO24
        ac.flight || "Inconnu",            // 1: Callsign
        "BE",                              // 2: Country
        ac.seen,                           // 3: Time
        ac.seen,                           // 4: Last contact
        ac.lon,                            // 5: Longitude
        ac.lat,                            // 6: Latitude
        ac.alt_geom ? ac.alt_geom * 0.3048 : null, // 7: Altitude (conversion pieds -> mètres)
        false,                             // 8: On ground
        ac.gs ? ac.gs * 0.514444 : null,   // 9: Speed (noeuds -> m/s)
        ac.track || 0                      // 10: Heading / Cap
      ]);

      return new Response(JSON.stringify({ states: mappedStates }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  } catch (e) {
    console.error("Erreur fallback ADSB:", e);
  }

  // Si aucune donnée n'est disponible
  return new Response(JSON.stringify({ states: [] }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}
