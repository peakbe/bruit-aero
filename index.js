const WORKER_BASE_URL = "https://bruit-aero-proxy.pnyr682w7f.workers.dev";
let map;
let planeMarkers = {};
let lastValidStates = [];

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
            return new Response(
              JSON.stringify({ error: "Données indisponibles" }),
              { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const data = await response.json();
          const formattedData = {
            main: { temp: data.current.temperature_2m },
            wind: {
              speed: data.current.wind_speed_10m / 3.6,
              deg: data.current.wind_direction_10m,
            },
            visibility: data.current.visibility,
            hourly: data.hourly,
          };

          return new Response(JSON.stringify(formattedData), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err) {
          return new Response(
            JSON.stringify({ error: "Données indisponibles" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // 2. METAR NOAA
      if (path === "/api/metar") {
        const station = url.searchParams.get("station") || "EBLG";

        try {
          const response = await fetch(
            `https://tgftp.nws.noaa.gov/data/observations/metar/stations/${station.toUpperCase()}.TXT`
          );

          if (!response.ok) {
            return new Response(
              JSON.stringify({ error: "Données indisponibles" }),
              { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const text = await response.text();
          const lines = text.trim().split("\n");
          const rawMetar = lines.length > 1 ? lines[1].trim() : text.trim();

          return new Response(JSON.stringify({ raw: rawMetar }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err) {
          return new Response(
            JSON.stringify({ error: "Données indisponibles" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // 3. FIDS (Vols Liège Airport)
if (path.includes("/api/fids")) {
  const airport = (url.searchParams.get("airport") || "EBLG").toUpperCase();
  const type = url.searchParams.get("type") || "departures";

  if (airport === "EBLG") {
    const fidsTargetUrl = `https://fids.liegeairport.com/api/v1/flights?type=${type}`;
    try {
      const response = await fetch(fidsTargetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*",
          "Referer": "https://www.liegeairport.com/",
        },
      });

      if (response.ok) {
        const rawData = await response.json();
        const list = Array.isArray(rawData) ? rawData : (rawData.flights || []);

        const cleanFlights = list.slice(0, 10).map((f) => ({
          flight: f.flightNumber || f.code || "N/A",
          city: f.destination || f.origin || f.city || "Inconnu",
          time: f.scheduledTime || f.time || "--:--",
          status: f.status || "Programmé",
        }));

        return new Response(
          JSON.stringify({ airport, type, flights: cleanFlights }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } catch (e) {
      console.error("Erreur FIDS Liège:", e);
    }
  }

  // Fallback si l'API de l'aéroport bloque la requête
  return new Response(
    JSON.stringify({ 
      airport, 
      type, 
      flights: [], 
      error: "Données indisponibles" 
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

     // 4. Radar Vol (adsb.lol avec fallback sur adsb.fi, format OpenSky)
if (path === "/api/opensky") {
  const currentTime = Math.floor(Date.now() / 1000);
  
  const mapToOpenSky = (acList) => {
    return acList.map((ac) => [
      (ac.hex || "").toLowerCase(),
      (ac.flight || "").trim(),
      "Unknown",
      ac.seen_pos ? currentTime - Math.round(ac.seen_pos) : currentTime,
      ac.seen ? currentTime - Math.round(ac.seen) : currentTime,
      ac.lon ?? null,
      ac.lat ?? null,
      ac.alt_baro !== undefined && ac.alt_baro !== "ground" ? Math.round(ac.alt_baro * 0.3048) : null,
      ac.alt_baro === "ground" || ac.gs === 0,
      ac.gs !== undefined ? ac.gs * 0.514444 : null,
      ac.track ?? null,
      ac.geom_rate !== undefined ? ac.geom_rate * 0.00508 : null,
      null,
      ac.alt_geom !== undefined ? Math.round(ac.alt_geom * 0.3048) : null,
      ac.squawk || null,
      false,
      0
    ]);
  };

  try {
    // Essai 1 : adsb.lol (Timeout porté à 6 sec)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    let response = await fetch("https://api.adsb.lol/v2/point/50.5/5.0/60", {
      headers: { "User-Agent": "Dashboard-Aero-App" },
      signal: controller.signal,
    }).catch(() => null);

    clearTimeout(timeoutId);

    // Essai 2 (Fallback) : adsb.fi si le premier a échoué
    if (!response || !response.ok) {
      const controller2 = new AbortController();
      const timeoutId2 = setTimeout(() => controller2.abort(), 5000);
      
      response = await fetch("https://api.adsb.fi/v2/lat/50.5/lon/5.0/dist/60", {
        headers: { "User-Agent": "Dashboard-Aero-App" },
        signal: controller2.signal,
      }).catch(() => null);
      
      clearTimeout(timeoutId2);
    }

    if (response && response.ok) {
      const rawData = await response.json();
      const acList = rawData.ac || [];
      return new Response(
        JSON.stringify({ time: currentTime, states: mapToOpenSky(acList) }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Si aucune API ne répond : renvoie une structure OpenSky valide mais vide
    return new Response(
      JSON.stringify({ time: currentTime, states: [], message: "Données indisponibles" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ time: currentTime, states: [], message: "Données indisponibles" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

      // 404 Endpoint non trouvé
      return new Response(
        JSON.stringify({ error: "Endpoint non trouvé", path }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Données indisponibles", details: err.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  initMap(); // Lance la carte et les rafraîchissements
  // Appel de vos autres fonctions si besoin (ex: fetchWeather())
});
