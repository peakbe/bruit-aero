export function drawCompass(canvasId, windDeg, windSpeed) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2 - 6;

  ctx.clearRect(0, 0, w, h);

  // cercle
  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // axe N
  ctx.fillStyle = "#ef4444";
  ctx.font = "10px Segoe UI";
  ctx.textAlign = "center";
  ctx.fillText("N", cx, cy - r + 10);

  // flèche vent
  const rad = (windDeg - 90) * Math.PI / 180;
  const x = cx + r * Math.cos(rad);
  const y = cy + r * Math.sin(rad);

  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(x, y);
  ctx.stroke();

  // texte
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "11px Segoe UI";
  ctx.fillText(`${Math.round(windDeg)}° / ${Math.round(windSpeed)} km/h`, cx, h - 8);
}
