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
              {
                status: response.status,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }

          const data = await response.json();

          const formattedData = {
            main: { temp: data.current.temperature_2m },
            wind: {
              speed: data.current.wind_speed_10m / 3.6, // Conversion m/s
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
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
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
              {
                status: response.status,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
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
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      }

      // 3. FIDS (Vols)
      if (path.includes("/api/fids")) {
        const airport = (
          url.searchParams.get("airport") || "EBLG"
        ).toUpperCase();
        const type = url.searchParams.get("type") || "departures";

        if (airport === "EBLG") {
          const fidsTargetUrl = `https://fids.liegeairport.com/api/v1/flights?type=${type}`;
          try {
            const response = await fetch(fidsTargetUrl, {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                Referer: "https://www.liegeairport.com/",
              },
            });

            if (response.ok) {
              const rawData = await response.json();
              const list = Array.isArray(rawData)
                ? rawData
                : rawData.flights || [];

              const cleanFlights = list.slice(0, 10).map((f) => ({
                flight: f.flightNumber || f.code || "N/A",
                city: f.destination || f.origin || f.city || "Inconnu",
                time: f.scheduledTime || f.time || "--:--",
                status: f.status || "Programmé",
              }));

              return new Response(
                JSON.stringify({ airport, type, flights: cleanFlights }),
                {
                  status: 200,
                  headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                  },
                }
              );
            }
          } catch (e) {
            console.error(e);
          }
        }

        // Si l'aéroport n'est pas supporté ou si l'API externe échoue
        return new Response(
          JSON.stringify({
            airport,
            type,
            flights: [],
            message: "Données indisponibles",
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

     // 4. Radar Vol (adsb.lol formaté comme OpenSky)
if (path === "/api/opensky") {
  try {
    // Recherche autour du sud de la Belgique (lat: 50.5, lon: 5.0, rayon: 60 nautical miles)
    const adsbUrl = "https://api.adsb.lol/v2/point/50.5/5.0/60";

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(adsbUrl, {
      headers: { "User-Agent": "Dashboard-Aero-App" },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: "Données indisponibles" }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const rawData = await response.json();
    const acList = rawData.ac || [];
    const currentTime = Math.floor(Date.now() / 1000);

    // Mappage au format exact d'un vecteur OpenSky
    const states = acList.map((ac) => {
      const icao24 = (ac.hex || "").toLowerCase();
      const callsign = (ac.flight || "").trim();
      const origin_country = "Unknown";
      const time_position = ac.seen_pos ? currentTime - Math.round(ac.seen_pos) : currentTime;
      const last_contact = ac.seen ? currentTime - Math.round(ac.seen) : currentTime;
      const longitude = ac.lon ?? null;
      const latitude = ac.lat ?? null;
      const baro_altitude = ac.alt_baro !== undefined && ac.alt_baro !== "ground" ? Math.round(ac.alt_baro * 0.3048) : null; // Pieds vers Mètres
      const on_ground = ac.alt_baro === "ground" || ac.gs === 0;
      const velocity = ac.gs !== undefined ? ac.gs * 0.514444 : null; // Noeuds vers m/s
      const true_track = ac.track ?? null;
      const vertical_rate = ac.geom_rate !== undefined ? ac.geom_rate * 0.00508 : null; // Pieds/min vers m/s
      const sensors = null;
      const geo_altitude = ac.alt_geom !== undefined ? Math.round(ac.alt_geom * 0.3048) : null;
      const squawk = ac.squawk || null;
      const spi = false;
      const position_source = 0;

      return [
        icao24,           // 0: icao24
        callsign,         // 1: callsign
        origin_country,   // 2: origin_country
        time_position,    // 3: time_position
        last_contact,     // 4: last_contact
        longitude,        // 5: longitude
        latitude,         // 6: latitude
        baro_altitude,    // 7: baro_altitude (mètres)
        on_ground,        // 8: on_ground
        velocity,         // 9: velocity (m/s)
        true_track,       // 10: true_track (degrés)
        vertical_rate,    // 11: vertical_rate (m/s)
        sensors,          // 12: sensors
        geo_altitude,     // 13: geo_altitude (mètres)
        squawk,           // 14: squawk
        spi,              // 15: spi
        position_source   // 16: position_source
      ];
    });

    const openSkyFormattedData = {
      time: currentTime,
      states: states
    };

    return new Response(JSON.stringify(openSkyFormattedData), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Données indisponibles" }),
      {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}
  },
};
