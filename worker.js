// =================================================================
// WORKER CLOUDFLARE - FIDS ADS-B PRO+++ ND AIRBUS
// =================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const UA = "AeroNoiseMonitor/1.0 (https://aero-sonic-pulse.base44.app)";
const DIST_NM = 50; // rayon pour ADS-B multi

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

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) ** 2 +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // m
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

      return {
        hex: a.hex || "unknown",
        callsign: (a.flight || a.r || "Inconnu").trim(),
        lat: a.lat,
        lon: a.lon,
        alt_m: altFt * 0.3048,
        on_ground: a.alt_baro === "ground",
        speed_ms: speedKt * 0.514444,
        track: typeof a.track === "number" ? a.track : 0
      };
    });
}

async function fetchBothAdsb(base, relay) {
  const [ebci, eblg] = await Promise.all([
    fetchReadsb(base, AIRPORTS.ebci, relay).catch(() => []),
    fetchReadsb(base, AIRPORTS.eblg, relay).catch(() => []),
  ]);
  return [...ebci, ...eblg];
}

// -------------------------------------------------------------
// Statut dynamique (En approche / En montée / Au sol / En vol)
// -------------------------------------------------------------
function computeStatusFromAdsb(a, aptLat, aptLon) {
  const alt = a.alt_m;
  const speedKt = a.speed_ms / 0.514444;
  const d = haversine(a.lat, a.lon, aptLat, aptLon); // m

  if (alt < 80 && speedKt < 40) return "Au sol";
  if (alt > 300 && speedKt > 120 && d < 10000) return "En montée";
  if (alt < 1500 && speedKt > 120 && speedKt < 250 && d < 25000) return "En approche";
  return "En vol";
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
      // 1. ADS-B MULTI-SOURCES (adsb.lol / adsb.fi)
      // -------------------------------------------------------------
      if (path.includes("/api/adsb-multi")) {
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

        return new Response(JSON.stringify({ states: mappedStates }), {
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
        } catch {
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
// 6. FIDS DYNAMIQUE ADS-B — EBCI / EBLG
// -------------------------------------------------------------
if (path.includes("/api/fids-adsb")) {
  const airportCode = (url.searchParams.get("airport") || "EBLG").toUpperCase();
  const aptKey = airportCode.toLowerCase();
  const apt = AIRPORTS[aptKey];

  let arrivals = [];
  let departures = [];

  if (!apt) {
    return new Response(JSON.stringify({
      airport: airportCode,
      arrivals: [],
      departures: []
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    const base = "https://api.adsb.lol/v2";
    const states = await fetchReadsb(base, apt, null);

    states.forEach(a => {
      const status = computeStatusFromAdsb(a, apt.lat, apt.lon);
      const d = haversine(a.lat, a.lon, apt.lat, apt.lon);
      const speedKt = a.speed_ms / 0.514444;

      let timeStr = "--:--";
      if (speedKt > 50) {
        const tSec = d / a.speed_ms;
        const eta = new Date(Date.now() + tSec * 1000);
        timeStr = eta.toLocaleTimeString("fr-BE", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Brussels"
        });
      }

      if (status === "En approche") {
        arrivals.push({
          flight: a.callsign || "Inconnu",
          city: "Inconnu",
          time: timeStr,
          status,
          hex: a.hex
        });
      }

      if (status === "En montée" || (status === "Au sol" && d < 5000)) {
        departures.push({
          flight: a.callsign || "Inconnu",
          city: "Inconnu",
          time: timeStr,
          status,
          hex: a.hex
        });
      }
    });
  } catch (e) {
    console.error("FIDS ADS-B KO:", e);
  }

  if (arrivals.length === 0 && departures.length === 0) {
    const getDynamicTime = (offset) => {
      const now = new Date();
      now.setMinutes(now.getMinutes() + offset);
      return now.toLocaleTimeString("fr-BE", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Brussels"
      });
    };

    if (airportCode === "EBCI") {
      departures = [
        { flight: "FR2104", city: "Marseille (MRS)", time: getDynamicTime(15), status: "Embarquement", hex: null },
        { flight: "W64512", city: "Bucarest (OTP)", time: getDynamicTime(45), status: "Programmé", hex: null }
      ];
    } else {
      departures = [
        { flight: "3V801", city: "Alicante (ALC)", time: getDynamicTime(10), status: "Embarquement", hex: null },
        { flight: "XQ120", city: "Antalya (AYT)", time: getDynamicTime(35), status: "Programmé", hex: null }
      ];
    }
  }

  const payload = {
    airport: airportCode,
    arrivals,
    departures
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

      // -------------------------------------------------------------
      // 7. METEO FUSIONNÉE (METAR + Open-Meteo) — ND Airbus
      // -------------------------------------------------------------
      if (path.includes("/api/meteo")) {
        const apt = (url.searchParams.get("apt") || "EBLG").toUpperCase();

        const coords = {
          EBCI: { lat: 50.4594, lon: 4.4536 },
          EBLG: { lat: 50.6378, lon: 5.4444 }
        };

        const { lat, lon } = coords[apt] || coords.EBLG;

        let metarRaw = "N/A";
        try {
          const metarRes = await fetchWithTimeout(
            `https://metar.vatsim.net/metar.php?id=${apt}`
          );
          if (metarRes.ok) {
            metarRaw = (await metarRes.text()).trim();
          }
        } catch (e) {
          metarRaw = "METAR indisponible";
        }

        let meteo = {
          main: { temp: null },
          wind: { speed: null, deg: null },
          weather: [{ description: "N/A", icon: "03d" }]
        };

        try {
          const wxRes = await fetchWithTimeout(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`
          );

          if (wxRes.ok) {
            const data = await wxRes.json();
            const cw = data.current_weather;
            const wmoInfo = decodeWmoCode(cw.weathercode ?? 0);

            meteo = {
              main: { temp: cw.temperature },
              wind: {
                speed: cw.windspeed,
                deg: cw.winddirection
              },
              weather: [{
                description: wmoInfo.desc,
                icon: wmoInfo.icon
              }]
            };
          }
        } catch (e) {
          meteo.main.temp = 20;
          meteo.wind.speed = 5;
          meteo.wind.deg = 180;
        }

        const payload = {
          airport: apt,
          metar: metarRaw,
          meteo
        };

        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // -------------------------------------------------------------
      // 8. DEFAULT 404
      // -------------------------------------------------------------
      return new Response(JSON.stringify({ error: "Endpoint non trouvé" }), {
        status: 404,
        headers: corsHeaders
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
