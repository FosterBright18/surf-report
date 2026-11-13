import { SPOTS } from "./spotsData.js";
import { MarineApiClient } from "./marineApiClient.js";
import { SurfAnalyticsEngine } from "./surfAnalyticsEngine.js";
import { ChartRenderer } from "./chartRenderer.js";

/**
 * Orchestrates spot selection, unit toggling, live buoy fetches, and UI updates.
 */
export class AppController {
  constructor() {
    this.spots = SPOTS;
    this.currentSpot = SPOTS.find(s => s.id === "fl_melbourneshores") || SPOTS[0];
    this.bundle = null;
    this.isMetric = false;
    this.selectedRegion = "ALL";
    this.searchQuery = "";
    this.favorites = this.loadFavorites();

    this.selectedDayIndex = 0;
    this.activeSlotTimestamp = null;

    this.bindEvents();
    this.renderSpotList();
    this.loadSpot(this.currentSpot, false);

    window.addEventListener("resize", () => {
      if (this.bundle) this.renderCharts();
    });
  }

  loadFavorites() {
    try {
      const raw = localStorage.getItem("swell_v4_favs");
      return raw ? JSON.parse(raw) : ["fl_melbourneshores", "fl_sebastian", "ca_venice", "ca_malibu", "ca_elporto", "hi_pipeline"];
    } catch (e) {
      return ["fl_melbourneshores"];
    }
  }

  toggleFavorite(spotId, e) {
    if (e) e.stopPropagation();
    const idx = this.favorites.indexOf(spotId);
    if (idx >= 0) this.favorites.splice(idx, 1);
    else this.favorites.push(spotId);
    try {
      localStorage.setItem("swell_v4_favs", JSON.stringify(this.favorites));
    } catch (err) {}
    this.renderSpotList();
    this.updateHeroFavButton();
  }

  updateHeroFavButton() {
    document.getElementById("heroFavBtn").classList.toggle("active", this.favorites.includes(this.currentSpot.id));
  }

  bindEvents() {
    const drawer = document.getElementById("mainDrawer");
    const backdrop = document.getElementById("drawerBackdrop");
    const toggleDrawer = (open) => {
      drawer.classList.toggle("open", open);
      backdrop.classList.toggle("open", open);
    };

    document.getElementById("btnOpenSpots").addEventListener("click", () => toggleDrawer(true));
    document.getElementById("btnOpenDrawer2").addEventListener("click", () => toggleDrawer(true));
    document.getElementById("btnCloseDrawer").addEventListener("click", () => toggleDrawer(false));
    backdrop.addEventListener("click", () => toggleDrawer(false));

    document.getElementById("heroFavBtn").addEventListener("click", (e) => {
      this.toggleFavorite(this.currentSpot.id, e);
    });

    document.getElementById("spotSearch").addEventListener("input", (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.renderSpotList();
    });

    document.querySelectorAll(".region-pill").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".region-pill").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this.selectedRegion = btn.dataset.region;
        this.renderSpotList();
      });
    });

    document.getElementById("btnUnits").addEventListener("click", (e) => {
      this.isMetric = !this.isMetric;
      e.target.textContent = this.isMetric ? "M / KM/H / °C" : "FT / MPH / °F";
      this.renderAll();
    });

    document.getElementById("btnRefresh").addEventListener("click", () => {
      this.loadSpot(this.currentSpot, true);
    });

    document.getElementById("btnResetNow").addEventListener("click", () => {
      this.setToLiveNow();
      this.renderAll();
    });
  }

  renderSpotList() {
    const list = document.getElementById("spotList");
    list.innerHTML = "";

    const filtered = this.spots.filter(s => {
      const matchesRegion =
        this.selectedRegion === "ALL" ||
        (this.selectedRegion === "FAV" && this.favorites.includes(s.id)) ||
        s.region === this.selectedRegion;
      const matchesSearch =
        s.name.toLowerCase().includes(this.searchQuery) ||
        s.region.toLowerCase().includes(this.searchQuery) ||
        s.bottomType.toLowerCase().includes(this.searchQuery);
      return matchesRegion && matchesSearch;
    });

    for (const spot of filtered) {
      const row = document.createElement("div");
      row.className = `spot-row ${spot.id === this.currentSpot.id ? "selected" : ""}`;
      const isFav = this.favorites.includes(spot.id);

      row.innerHTML = `
        <div>
          <div class="spot-row-title">${spot.name}</div>
          <div class="spot-row-sub">${spot.region} · ${spot.bottomType}</div>
        </div>
        <button class="fav-btn ${isFav ? "active" : ""}">★</button>
      `;

      row.addEventListener("click", () => {
        this.currentSpot = spot;
        this.renderSpotList();
        this.loadSpot(spot, false);
        document.getElementById("mainDrawer").classList.remove("open");
        document.getElementById("drawerBackdrop").classList.remove("open");
      });

      row.querySelector(".fav-btn").addEventListener("click", (e) => {
        this.toggleFavorite(spot.id, e);
      });

      list.appendChild(row);
    }
  }

  async loadSpot(spot, forceRefresh) {
    document.getElementById("navSpotName").textContent = spot.name;
    document.getElementById("navSpotRegion").textContent = spot.region;
    this.bundle = await MarineApiClient.fetchSpotBundle(spot, forceRefresh);

    const banner = document.getElementById("alertBanner");
    if (this.bundle.isFallback) {
      banner.style.display = "block";
      banner.textContent = `Buoy API offline (${this.bundle.fallbackReason}). Showing modeled forecast for ${spot.name}.`;
      document.getElementById("telemetryStatus").textContent = "Simulated Fallback";
    } else {
      banner.style.display = "none";
      document.getElementById("telemetryStatus").textContent = this.bundle.fromCache ? "Cached (20m TTL)" : "Live NOAA + Open-Meteo";
    }

    this.setToLiveNow();
    this.renderAll();
  }

  setToLiveNow() {
    if (!this.bundle?.hourly?.length) return;
    const nowMs = Date.now();
    let bestIdx = 0;
    let minDiff = Infinity;

    this.bundle.hourly.forEach((h, idx) => {
      const diff = Math.abs(h.timestamp - nowMs);
      if (diff < minDiff) {
        minDiff = diff;
        bestIdx = idx;
      }
    });

    this.activeSlotTimestamp = this.bundle.hourly[bestIdx].timestamp;
    this.selectedDayIndex = Math.min(6, Math.floor(bestIdx / 24));
    document.getElementById("btnResetNow").style.display = "none";
  }

  selectTimestamp(ts, isLive = false) {
    this.activeSlotTimestamp = ts;
    const idx = this.bundle.hourly.findIndex(h => h.timestamp === ts);
    if (idx >= 0) {
      this.selectedDayIndex = Math.min(6, Math.floor(idx / 24));
    }
    document.getElementById("btnResetNow").style.display = isLive ? "none" : "inline-flex";
    this.renderAll();
  }

  renderAll() {
    if (!this.bundle) return;
    const spot = this.currentSpot;
    const slot =
      this.bundle.hourly.find(h => h.timestamp === this.activeSlotTimestamp) ||
      this.bundle.hourly[0];

    const a = SurfAnalyticsEngine.analyzeSlot(slot, spot, this.bundle.hiloPredictions);

    const timeLabel = document.getElementById("btnResetNow").style.display === "none"
      ? "Live Now"
      : new Date(slot.timestamp).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

    // TIER 1: Hero & Amateur Quick Check
    document.getElementById("spotTitle").textContent = spot.name;
    document.getElementById("spotSubtitle").textContent = `${spot.region} · ${spot.bottomType} · ${timeLabel}`;
    document.getElementById("amateurSummary").textContent = a.amateurSummary;
    this.updateHeroFavButton();

    const rangeStr = this.isMetric
      ? `${(a.minFaceFt * 0.3048).toFixed(1)}–${(a.maxFaceFt * 0.3048).toFixed(1)} m`
      : `${a.minFaceFt}–${a.maxFaceFt} ft`;
    document.getElementById("heroSurfRange").textContent = rangeStr;

    const qBadge = document.getElementById("heroQualityBadge");
    qBadge.className = `quality-tag q-${a.qualityClass}`;
    qBadge.textContent = `${a.qualityClass} · ${"★".repeat(a.stars)}`;

    document.getElementById("tileBoardRec").textContent = a.boardRec;
    document.getElementById("tileWaveScale").textContent = a.humanScale;
    document.getElementById("tileSurfaceNote").textContent = `${a.windLabel} surface texture`;

    document.getElementById("tileWindQuality").textContent = a.windLabel;
    const windSpeedStr = this.isMetric
      ? `${Math.round(slot.windSpeedKmh)} km/h`
      : `${Math.round(a.windMph)} mph`;
    const gustSpeedStr = this.isMetric
      ? `${Math.round(slot.windGustKmh)} km/h`
      : `${Math.round(slot.windGustKmh * 0.621371)} mph`;
    document.getElementById("tileWindSimple").textContent = `${windSpeedStr} ${SurfAnalyticsEngine.degToCompass(slot.windDir)}`;
    document.getElementById("tileWindGustSimple").textContent = `Gusts to ${gustSpeedStr}`;

    document.getElementById("tileTideStage").textContent = `${a.tideInfo.stage} Tide`;
    document.getElementById("tileTideHeight").textContent = this.isMetric
      ? `${(a.tideInfo.heightFt * 0.3048).toFixed(1)} m`
      : `${a.tideInfo.heightFt.toFixed(1)} ft`;
    document.getElementById("tileTideNext").textContent = a.tideInfo.shortNext;

    // Crowdedness Card
    document.getElementById("tileCrowdScore").textContent = `${a.crowdScore} / 10`;
    document.getElementById("tileCrowdLabel").textContent = a.crowdLabel;
    document.getElementById("tileCrowdSub").textContent = a.crowdSub;
    const crowdBar = document.getElementById("tileCrowdBar");
    crowdBar.style.width = `${a.crowdScore * 10}%`;
    crowdBar.style.background = a.crowdColor;

    // Kook Meter Card
    document.getElementById("tileKookScore").textContent = `${a.kookScore} / 10`;
    document.getElementById("tileKookLabel").textContent = a.kookLabel;
    document.getElementById("tileKookSub").textContent = a.kookSub;
    const kookBar = document.getElementById("tileKookBar");
    kookBar.style.width = `${a.kookScore * 10}%`;
    kookBar.style.background = a.kookColor;

    // TIER 1B: Weather Strip
    const wxInfo = SurfAnalyticsEngine.weatherCodeInfo(slot.weatherCode);
    document.getElementById("wxConditionIcon").textContent = wxInfo.icon;
    const airVal = this.isMetric
      ? `${Math.round(slot.airTempC)} °C`
      : `${Math.round((slot.airTempC * 9) / 5 + 32)} °F`;
    const feelsVal = this.isMetric
      ? `${Math.round(slot.feelsLikeC)}°C`
      : `${Math.round((slot.feelsLikeC * 9) / 5 + 32)}°F`;
    document.getElementById("wxAirTemp").textContent = airVal;
    document.getElementById("wxSkyDesc").textContent = `${wxInfo.label} · Feels ${feelsVal}`;

    const waterVal = this.isMetric
      ? `${(((slot.waterTempF - 32) * 5) / 9).toFixed(1)} °C`
      : `${Math.round(slot.waterTempF)} °F`;
    document.getElementById("wxWaterTemp").textContent = waterVal;
    document.getElementById("wxWetsuit").textContent = a.wetsuit;

    const uv = Math.round(slot.uvIndex);
    document.getElementById("wxUvVal").textContent = `UV ${uv}`;
    document.getElementById("wxUvLevel").textContent = uv >= 8 ? "Very High" : uv >= 6 ? "High" : uv >= 3 ? "Moderate" : "Low";
    document.getElementById("wxSunscreen").textContent = uv >= 5 ? "Reapply SPF 50+" : "Low UV exposure";

    document.getElementById("wxRainProb").textContent = `${slot.precipProb}% Rain`;
    document.getElementById("wxCloudCover").textContent = `${slot.cloudCover}% Cloud Cover`;

    const sr = this.bundle.sunrise ? new Date(this.bundle.sunrise).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "6:25 AM";
    const ss = this.bundle.sunset ? new Date(this.bundle.sunset).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "7:15 PM";
    document.getElementById("wxSunset").textContent = `Set ${ss}`;
    document.getElementById("wxSunrise").textContent = `Rise ${sr}`;

    // TIER 3: Advanced Swell Trains & Map
    document.getElementById("tideStationLabel").textContent = `NOAA #${spot.noaaStationId}`;
    document.getElementById("mapCoordsLabel").textContent = `${spot.lat.toFixed(2)}°N, ${Math.abs(spot.lon).toFixed(2)}°W`;
    document.getElementById("advAlign").textContent = a.swellAlignLabel;

    const priStr = this.isMetric
      ? `${slot.swellHeightM.toFixed(1)}m @ ${slot.swellPeriodS}s`
      : `${(slot.swellHeightM * 3.28084).toFixed(1)}ft @ ${slot.swellPeriodS}s`;
    document.getElementById("advPrimarySwell").textContent = priStr;
    document.getElementById("advPrimaryDir").textContent = `${slot.swellDir}° ${SurfAnalyticsEngine.degToCompass(slot.swellDir)} · Primary`;

    const secStr = this.isMetric
      ? `${slot.secSwellHeightM.toFixed(1)}m @ ${slot.secSwellPeriodS}s`
      : `${(slot.secSwellHeightM * 3.28084).toFixed(1)}ft @ ${slot.secSwellPeriodS}s`;
    document.getElementById("advSecSwell").textContent = secStr;
    document.getElementById("advSecDir").textContent = `${Math.round(slot.secSwellDir)}° ${SurfAnalyticsEngine.degToCompass(slot.secSwellDir)} · Secondary`;

    document.getElementById("advEnergy").textContent = `${a.energyKj} kJ`;
    document.getElementById("advSpotWindow").textContent = `Ideal: ${spot.idealSwellDeg[0]}°–${spot.idealSwellDeg[1]}° | Offshore: ${spot.offshoreWindDeg}°`;

    this.renderCharts();
    this.renderDaysAndTable();
  }

  renderCharts() {
    const dayStartIdx = this.selectedDayIndex * 24;
    const hourly24 = this.bundle.hourly.slice(dayStartIdx, dayStartIdx + 24);
    const activeSlot =
      this.bundle.hourly.find(h => h.timestamp === this.activeSlotTimestamp) ||
      this.bundle.hourly[0];

    ChartRenderer.renderTideCanvas(
      document.getElementById("tideCanvas"),
      hourly24,
      this.bundle.hiloPredictions,
      this.activeSlotTimestamp,
      this.isMetric,
      (hourOffset) => {
        const slot = hourly24[hourOffset];
        if (slot) this.selectTimestamp(slot.timestamp, false);
      }
    );

    const sampled3Hr = [];
    for (let i = 0; i < this.bundle.hourly.length; i += 3) {
      const slot = this.bundle.hourly[i];
      const analysis = SurfAnalyticsEngine.analyzeSlot(slot, this.currentSpot, this.bundle.hiloPredictions);
      sampled3Hr.push({ slot, analysis });
    }

    ChartRenderer.renderSwellCanvas(
      document.getElementById("swellCanvas"),
      sampled3Hr,
      this.activeSlotTimestamp,
      this.isMetric,
      (ts) => this.selectTimestamp(ts, false)
    );

    ChartRenderer.renderSwellMapCanvas(
      document.getElementById("swellMapCanvas"),
      this.currentSpot,
      activeSlot,
      () => {
        ChartRenderer.renderSwellMapCanvas(
          document.getElementById("swellMapCanvas"),
          this.currentSpot,
          activeSlot,
          () => {}
        );
      }
    );
  }

  renderDaysAndTable() {
    const strip = document.getElementById("dayStrip");
    strip.innerHTML = "";

    for (let d = 0; d < 7; d++) {
      const daySlice = this.bundle.hourly.slice(d * 24, (d + 1) * 24);
      if (!daySlice.length) continue;

      const repSlot = daySlice[9] || daySlice[0];
      const repA = SurfAnalyticsEngine.analyzeSlot(repSlot, this.currentSpot, this.bundle.hiloPredictions);

      const dateObj = new Date(repSlot.timestamp);
      const dayName = d === 0 ? "Today" : dateObj.toLocaleDateString([], { weekday: "short", day: "numeric" });
      const sizeStr = this.isMetric
        ? `${(repA.minFaceFt * 0.3048).toFixed(1)}–${(repA.maxFaceFt * 0.3048).toFixed(1)}m`
        : `${repA.minFaceFt}–${repA.maxFaceFt}ft`;

      const card = document.createElement("div");
      card.className = `day-card ${d === this.selectedDayIndex ? "active" : ""}`;
      card.innerHTML = `
        <div class="day-title">${dayName}</div>
        <div class="day-size">${sizeStr}</div>
        <div class="day-sub">${repA.windLabel}</div>
      `;

      card.addEventListener("click", () => {
        this.selectedDayIndex = d;
        this.selectTimestamp(repSlot.timestamp, false);
      });

      strip.appendChild(card);
    }

    const tbody = document.getElementById("hourlyTableBody");
    tbody.innerHTML = "";
    const daySlice = this.bundle.hourly.slice(this.selectedDayIndex * 24, (this.selectedDayIndex + 1) * 24);

    for (let i = 0; i < daySlice.length; i += 3) {
      const slot = daySlice[i];
      const a = SurfAnalyticsEngine.analyzeSlot(slot, this.currentSpot, this.bundle.hiloPredictions);

      const tr = document.createElement("tr");
      if (slot.timestamp === this.activeSlotTimestamp) {
        tr.style.background = "var(--accent-soft)";
      }

      const timeStr = new Date(slot.timestamp).toLocaleTimeString([], { hour: "numeric" });
      const faceStr = this.isMetric
        ? `${(a.minFaceFt * 0.3048).toFixed(1)}–${(a.maxFaceFt * 0.3048).toFixed(1)}m`
        : `${a.minFaceFt}–${a.maxFaceFt}ft`;
      const swellStr = this.isMetric
        ? `${slot.swellHeightM.toFixed(1)}m @ ${slot.swellPeriodS}s ${SurfAnalyticsEngine.degToCompass(slot.swellDir)}`
        : `${(slot.swellHeightM * 3.28084).toFixed(1)}ft @ ${slot.swellPeriodS}s ${SurfAnalyticsEngine.degToCompass(slot.swellDir)}`;
      const windStr = this.isMetric
        ? `${Math.round(slot.windSpeedKmh)}km/h ${a.windLabel}`
        : `${Math.round(a.windMph)}mph ${a.windLabel}`;

      tr.innerHTML = `
        <td><b>${timeStr}</b></td>
        <td><b>${faceStr}</b></td>
        <td>${swellStr}</td>
        <td>${a.energyKj} kJ</td>
        <td>${windStr}</td>
        <td style="color: ${a.crowdColor}; font-weight: 600;">${a.crowdLabel} (${a.crowdScore})</td>
        <td style="color: ${a.kookColor}; font-weight: 600;">${a.kookLabel} (${a.kookScore})</td>
      `;

      tr.addEventListener("click", () => {
        this.selectTimestamp(slot.timestamp, false);
      });

      tbody.appendChild(tr);
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  new AppController();
});