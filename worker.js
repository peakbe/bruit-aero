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

// -------------------------------------------------------------
// Statut dynamique FR24 (En approche / En montée / Au sol / En vol)
// -------------------------------------------------------------
function computeStatus(f, airportLat, airportLon) {
  const lon = f[5];
  const lat = f[6];
  const alt = f[7];   // m
  const speed = f[9]; // m/s

  if (!lat || !lon) return "En vol";

  const speedKt = speed / 0.514444;

  const R = 6371e3;
  const φ1 = lat * Math.PI/180;
  const φ2 = airportLat * Math.PI/180;
  const Δφ = (airportLat - lat) * Math.PI/180;
  const Δλ = (airportLon - lon) * Math.PI/180;

  const a = Math.sin(Δφ/2)**2 +
            Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  const d = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); // m

  if (alt < 80 && speedKt < 40) return "Au sol";
  if (alt > 300 && speedKt > 120) return "En montée";
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
      // 6. FIDS DYNAMIQUE (FR24 JSON) — EBCI / EBLG
      // -------------------------------------------------------------
      if (path.includes("/api/fids-dyn")) {
        const airportCode = (url.searchParams.get("airport") || "EBLG").toUpperCase();

        const fr24Url =
          "https://data-cloud.flightradar24.com/zones/fcgi/feed.json?bounds=52,49,2,7&faa=1&satellite=1&mlat=1&flarm=1&adsb=1&gnd=1&air=1&vehicles=0&estimated=1";

        let arrivals = [];
        let departures = [];

        try {
          const res = await fetchWithTimeout(fr24Url, {
            headers: {
              "User-Agent": "Mozilla/5.0",
              "Accept": "application/json"
            }
          });

          if (res.ok) {
            const data = await res.json();
            const systemKeys = ["full_count", "version", "stats"];

            Object.keys(data).forEach(key => {
              if (systemKeys.includes(key) || !Array.isArray(data[key])) return;

              const f = data[key];
              const lat = f[1];
              const lon = f[2];
              if (!lat || !lon) return;

              const hex = key;
              const callsign = f[16] || f[13] || "Inconnu";
              const origin = f[11] || "";
              const dest = f[12] || "";
              const eta = f[9] || 0;

              const timeStr = eta
                ? new Date(eta * 1000).toLocaleTimeString("fr-BE", {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Europe/Brussels"
                  })
                : "--:--";

              const aptKey = airportCode.toLowerCase();
              const aptCoords = AIRPORTS[aptKey];
              const status = aptCoords
                ? computeStatus(f, aptCoords.lat, aptCoords.lon)
                : "En vol";

              // Départ
              if (origin.toUpperCase() === airportCode) {
                departures.push({
                  flight: callsign,
                  city: dest || "Inconnu",
                  time: timeStr,
                  status,
                  hex
                });
              }

              // Arrivée
              if (dest.toUpperCase() === airportCode) {
                arrivals.push({
                  flight: callsign,
                  city: origin || "Inconnu",
                  time: timeStr,
                  status,
                  hex
                });
              }
            });
          }
        } catch (e) {
          console.error("FR24 FIDS dyn KO:", e);
        }

        // Mock si vraiment vide
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
