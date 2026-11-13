import { SurfAnalyticsEngine } from "./surfAnalyticsEngine.js";

/**
 * Renders the 24-Hour MLLW Tide Curve, 7-Day Surf Height Bar Timeline,
 * and the Aerial Satellite Polar Swell & Wind Compass Map.
 */
export class ChartRenderer {
  static FONT = "'Futura', 'Futura PT', 'Avenir Next', 'Avenir', sans-serif";
  static tileCache = new Map();

  static getSatelliteTile(url, onLoadRedraw) {
    if (ChartRenderer.tileCache.has(url)) {
      return ChartRenderer.tileCache.get(url);
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => onLoadRedraw();
    img.src = url;
    ChartRenderer.tileCache.set(url, img);
    return img;
  }

  static renderSwellMapCanvas(canvas, spot, slot, onAsyncTileRedraw) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const outerR = Math.min(w, h) * 0.34;

    // 1. Satellite Background
    ChartRenderer.drawAerialCoastlineBackground(ctx, w, h, spot, onAsyncTileRedraw);

    ctx.fillStyle = "rgba(8, 20, 34, 0.28)";
    ctx.fillRect(0, 0, w, h);

    // 2. Dashed Concentric Polar Rings & Crosshairs
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);

    for (let r = 1; r <= 3; r++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (outerR / 4) * r, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (let deg = 0; deg < 360; deg += 45) {
      const rad = ((deg - 90) * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(rad) * outerR, cy + Math.sin(rad) * outerR);
      ctx.stroke();
    }
    ctx.restore();

    // 3. Directional Wedges
    const drawWedge = (dirDeg, lengthFrac, spreadDeg, fillColor, strokeColor) => {
      const r = Math.max(22, Math.min(outerR * 0.94, outerR * lengthFrac));
      const startRad = ((dirDeg - spreadDeg / 2 - 90) * Math.PI) / 180;
      const endRad = ((dirDeg + spreadDeg / 2 - 90) * Math.PI) / 180;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, startRad, endRad);
      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    };

    const windLen = Math.min(0.88, 0.28 + (slot.windSpeedKmh / 45) * 0.6);
    drawWedge(slot.windDir, windLen, 16, "rgba(56, 189, 248, 0.68)", "rgba(186, 230, 253, 0.85)");

    const secLen = Math.min(0.85, 0.25 + (slot.secSwellHeightM / 3.2) * 0.6);
    drawWedge(slot.secSwellDir, secLen, 14, "rgba(250, 204, 21, 0.78)", "rgba(254, 240, 138, 0.9)");

    const priLen = Math.min(0.92, 0.34 + (slot.swellHeightM / 3.2) * 0.6);
    drawWedge(slot.swellDir, priLen, 18, "rgba(249, 115, 22, 0.85)", "rgba(255, 237, 213, 0.95)");

    // 4. Solid White Outer Compass Circle
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#0f172a";
    ctx.beginPath();
    ctx.arc(cx, cy, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 5. Degree Labels Around Perimeter
    ctx.font = `700 12px ${ChartRenderer.FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const labelR = outerR + 24;

    for (let deg = 0; deg < 360; deg += 45) {
      const rad = ((deg - 90) * Math.PI) / 180;
      const lx = cx + Math.cos(rad) * labelR;
      const ly = cy + Math.sin(rad) * labelR;

      ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
      ctx.fillText(`${deg}°`, lx + 1, ly + 1);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(`${deg}°`, lx, ly);
    }

    // 6. Bold White Ideal Offshore Arrow on Perimeter Ring
    const offRad = ((spot.offshoreWindDeg - 90) * Math.PI) / 180;
    const tipX = cx + Math.cos(offRad) * (outerR + 3);
    const tipY = cy + Math.sin(offRad) * (outerR + 3);
    const tailX = cx + Math.cos(offRad) * (outerR + 22);
    const tailY = cy + Math.sin(offRad) * (outerR + 22);

    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.fillStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    const headLen = 9;
    const angle = Math.atan2(tipY - tailY, tipX - tailX);
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - headLen * Math.cos(angle - Math.PI / 6), tipY - headLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(tipX - headLen * Math.cos(angle + Math.PI / 6), tipY - headLen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  static drawAerialCoastlineBackground(ctx, w, h, spot, onAsyncTileRedraw) {
    const zoom = 14;
    const n = Math.pow(2, zoom);
    const latRad = (spot.lat * Math.PI) / 180;
    const xFloat = ((spot.lon + 180) / 360) * n;
    const yFloat = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

    const xTile = Math.floor(xFloat);
    const yTile = Math.floor(yFloat);
    const offsetX = (xFloat - xTile) * 256;
    const offsetY = (yFloat - yTile) * 256;

    ctx.save();
    ctx.fillStyle = "#10324a";
    ctx.fillRect(0, 0, w, h);

    const avgSwellDeg = (spot.idealSwellDeg[0] + spot.idealSwellDeg[1]) / 2;
    const landRad = ((avgSwellDeg + 180 - 90) * Math.PI) / 180;
    ctx.translate(w / 2, h / 2);
    ctx.rotate(landRad);

    const waterGrad = ctx.createLinearGradient(-w, 0, w * 0.2, 0);
    waterGrad.addColorStop(0, "#0b283d");
    waterGrad.addColorStop(0.75, "#154e6b");
    waterGrad.addColorStop(1, "#2a7b88");
    ctx.fillStyle = waterGrad;
    ctx.fillRect(-w, -h, w * 1.1, h * 2);

    ctx.fillStyle = "#d6c7a9";
    ctx.fillRect(0, -h, 14, h * 2);
    ctx.fillStyle = "#5b6953";
    ctx.fillRect(14, -h, w, h * 2);
    ctx.restore();

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${yTile + dy}/${xTile + dx}`;
        const img = ChartRenderer.getSatelliteTile(url, onAsyncTileRedraw);
        if (img && img.complete && img.naturalWidth > 0) {
          const drawX = w / 2 - offsetX + dx * 256;
          const drawY = h / 2 - offsetY + dy * 256;
          ctx.drawImage(img, drawX, drawY, 256, 256);
        }
      }
    }
  }

  static renderTideCanvas(canvas, hourly24, hiloList, activeSlotTs, isMetric, onSelectHourIndex) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!hourly24.length) return;

    const padL = 26, padR = 16, padT = 22, padB = 22;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const startTs = hourly24[0].timestamp;
    const endTs = hourly24[hourly24.length - 1].timestamp;
    const spanTs = Math.max(1, endTs - startTs);

    const points = [];
    let minH = Infinity, maxH = -Infinity;

    for (let i = 0; i <= 48; i++) {
      const ts = startTs + (i / 48) * spanTs;
      const tide = SurfAnalyticsEngine.evaluateTideAt(ts, hiloList);
      const val = isMetric ? tide.heightFt * 0.3048 : tide.heightFt;
      if (val < minH) minH = val;
      if (val > maxH) maxH = val;
      points.push({ ts, val });
    }

    minH -= isMetric ? 0.3 : 0.9;
    maxH += isMetric ? 0.35 : 1.1;
    const rangeH = Math.max(0.5, maxH - minH);

    const xForTs = (ts) => padL + ((ts - startTs) / spanTs) * plotW;
    const yForVal = (v) => padT + plotH - ((v - minH) / rangeH) * plotH;

    const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    grad.addColorStop(0, "rgba(79, 70, 229, 0.22)");
    grad.addColorStop(1, "rgba(79, 70, 229, 0.01)");

    ctx.beginPath();
    points.forEach((p, idx) => {
      const px = xForTs(p.ts);
      const py = yForVal(p.val);
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.lineTo(xForTs(endTs), padT + plotH);
    ctx.lineTo(xForTs(startTs), padT + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    points.forEach((p, idx) => {
      const px = xForTs(p.ts);
      const py = yForVal(p.val);
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = "#4f46e5";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = `600 10px ${ChartRenderer.FONT}`;
    ctx.textAlign = "center";
    for (const hl of hiloList) {
      if (hl.time < startTs || hl.time > endTs) continue;
      const v = isMetric ? hl.heightFt * 0.3048 : hl.heightFt;
      const px = xForTs(hl.time);
      const py = yForVal(v);

      ctx.fillStyle = "#1e293b";
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();

      const unit = isMetric ? "m" : "ft";
      ctx.fillText(`${hl.type} ${v.toFixed(1)}${unit}`, px, py - 8);
    }

    if (activeSlotTs >= startTs && activeSlotTs <= endTs) {
      const nowX = xForTs(activeSlotTs);
      ctx.strokeStyle = "#1e293b";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(nowX, padT);
      ctx.lineTo(nowX, padT + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = "#64748b";
    ctx.font = `500 10px ${ChartRenderer.FONT}`;
    for (let i = 0; i < hourly24.length; i += 6) {
      const x = xForTs(hourly24[i].timestamp);
      const lbl = new Date(hourly24[i].timestamp).toLocaleTimeString([], { hour: "numeric" });
      ctx.fillText(lbl, x, h - 5);
    }

    canvas.onclick = (e) => {
      const r = canvas.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - r.left - padL) / plotW));
      const idx = Math.min(hourly24.length - 1, Math.round(frac * (hourly24.length - 1)));
      onSelectHourIndex(idx);
    };
  }

  static renderSwellCanvas(canvas, sampledSlots, activeSlotTs, isMetric, onSelectSlot) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!sampledSlots.length) return;

    const padL = 18, padR = 12, padT = 16, padB = 22;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    let maxFace = 5.5;
    for (const item of sampledSlots) {
      const v = isMetric ? item.analysis.maxFaceFt * 0.3048 : item.analysis.maxFaceFt;
      if (v > maxFace) maxFace = v * 1.15;
    }

    const barStep = plotW / sampledSlots.length;
    const barW = Math.max(3, barStep - 2.5);

    sampledSlots.forEach((item, idx) => {
      const val = isMetric ? item.analysis.maxFaceFt * 0.3048 : item.analysis.maxFaceFt;
      const barH = Math.max(4, (val / maxFace) * plotH);
      const x = padL + idx * barStep;
      const y = padT + plotH - barH;

      const isSelected = item.slot.timestamp === activeSlotTs;
      const q = item.analysis.qualityClass;

      if (isSelected) {
        ctx.fillStyle = "#1e293b";
      } else {
        ctx.fillStyle = q === "EPIC" ? "#7c3aed" : q === "GOOD" ? "#10b981" : q === "FAIR" ? "#6366f1" : "#cbd5e1";
      }

      ctx.fillRect(x, y, barW, barH);

      if (idx % 8 === 0) {
        const dName = new Date(item.slot.timestamp).toLocaleDateString([], { weekday: "short" });
        ctx.fillStyle = "#64748b";
        ctx.font = `600 10px ${ChartRenderer.FONT}`;
        ctx.textAlign = "left";
        ctx.fillText(dName, x, h - 5);
      }
    });

    canvas.onclick = (e) => {
      const r = canvas.getBoundingClientRect();
      const idx = Math.floor(((e.clientX - r.left - padL) / plotW) * sampledSlots.length);
      if (idx >= 0 && idx < sampledSlots.length) {
        onSelectSlot(sampledSlots[idx].slot.timestamp);
      }
    };
  }
}