/**
 * Fetches live Open-Meteo Marine + Open-Meteo Weather + NOAA CO-OPS Tide & Buoy Temp
 * with a 20-minute localStorage cache and automatic offline fallback synthesizer.
 */
export class MarineApiClient {
  static CACHE_TTL_MS = 20 * 60 * 1000;

  static async fetchSpotBundle(spot, forceRefresh = false) {
    const cacheKey = `swell_v4_${spot.id}`;
    if (!forceRefresh) {
      try {
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Date.now() - parsed.timestamp < MarineApiClient.CACHE_TTL_MS) {
            return { ...parsed.data, fromCache: true };
          }
        }
      } catch (e) {}
    }

    const marineUrl =
      `https://marine-api.open-meteo.com/v1/marine?latitude=${spot.lat}&longitude=${spot.lon}` +
      `&hourly=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,wind_wave_height,wind_wave_direction,wind_wave_period,sea_surface_temperature` +
      `&timezone=auto&forecast_days=7`;

    const weatherUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${spot.lat}&longitude=${spot.lon}` +
      `&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index` +
      `&daily=sunrise,sunset&timezone=auto&forecast_days=7`;

    const todayStr = MarineApiClient.formatYMD(new Date());
    const endStr = MarineApiClient.formatYMD(new Date(Date.now() + 48 * 3600 * 1000));

    const noaaTideUrl =
      `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=${todayStr}&end_date=${endStr}` +
      `&station=${spot.noaaStationId}&product=predictions&datum=MLLW&time_zone=lst_ldt&interval=hilo&units=english&format=json`;

    const noaaTempUrl =
      `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?date=latest` +
      `&station=${spot.noaaStationId}&product=water_temperature&units=english&time_zone=lst_ldt&format=json`;

    try {
      const [marineRes, weatherRes, tideRes, tempRes] = await Promise.allSettled([
        fetch(marineUrl).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
        fetch(weatherUrl).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
        fetch(noaaTideUrl).then(r => r.ok ? r.json() : null),
        fetch(noaaTempUrl).then(r => r.ok ? r.json() : null)
      ]);

      if (marineRes.status !== "fulfilled" || weatherRes.status !== "fulfilled") {
        throw new Error("Live marine endpoint offline");
      }

      const marine = marineRes.value.hourly;
      const weather = weatherRes.value.hourly;
      const daily = weatherRes.value.daily;

      let hiloPredictions = [];
      if (tideRes.status === "fulfilled" && tideRes.value?.predictions?.length) {
        hiloPredictions = tideRes.value.predictions.map(p => ({
          time: new Date(p.t.replace(" ", "T")).getTime(),
          heightFt: parseFloat(p.v),
          type: p.type
        }));
      } else {
        hiloPredictions = MarineApiClient.generateSyntheticHilo(spot);
      }

      let noaaWaterTempF = null;
      if (tempRes.status === "fulfilled" && tempRes.value?.data?.[0]?.v) {
        const parsedTemp = parseFloat(tempRes.value.data[0].v);
        if (!isNaN(parsedTemp)) noaaWaterTempF = parsedTemp;
      }

      const bundle = {
        spotId: spot.id,
        isFallback: false,
        sunrise: daily?.sunrise?.[0] || null,
        sunset: daily?.sunset?.[0] || null,
        hourly: MarineApiClient.mergeHourlyStreams(marine, weather, noaaWaterTempF),
        hiloPredictions
      };

      try {
        localStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), data: bundle }));
      } catch (e) {}

      return bundle;
    } catch (err) {
      return MarineApiClient.generateFallbackBundle(spot, err.message);
    }
  }

  static mergeHourlyStreams(marine, weather, noaaWaterTempF) {
    const count = Math.min(marine.time.length, weather.time.length);
    const rows = [];
    for (let i = 0; i < count; i++) {
      const sstC = marine.sea_surface_temperature?.[i] ?? 22.0;
      const sstF = noaaWaterTempF !== null ? noaaWaterTempF : (sstC * 9) / 5 + 32;

      rows.push({
        timestamp: new Date(marine.time[i]).getTime(),
        waveHeightM: marine.wave_height?.[i] ?? 1.1,
        waveDir: marine.wave_direction?.[i] ?? 85,
        wavePeriodS: marine.wave_period?.[i] ?? 10,
        swellHeightM: marine.swell_wave_height?.[i] ?? marine.wave_height?.[i] ?? 1.0,
        swellDir: marine.swell_wave_direction?.[i] ?? 80,
        swellPeriodS: marine.swell_wave_period?.[i] ?? 11,
        secSwellHeightM: marine.wind_wave_height?.[i] ?? (marine.wave_height?.[i] ?? 1.0) * 0.45,
        secSwellDir: marine.wind_wave_direction?.[i] ?? ((marine.swell_wave_direction?.[i] ?? 80) + 32) % 360,
        secSwellPeriodS: marine.wind_wave_period?.[i] ?? 7,
        waterTempF: sstF,
        airTempC: weather.temperature_2m?.[i] ?? 24,
        feelsLikeC: weather.apparent_temperature?.[i] ?? weather.temperature_2m?.[i] ?? 24,
        precipProb: weather.precipitation_probability?.[i] ?? 10,
        weatherCode: weather.weather_code?.[i] ?? 1,
        cloudCover: weather.cloud_cover?.[i] ?? 20,
        windSpeedKmh: weather.wind_speed_10m?.[i] ?? 12,
        windGustKmh: weather.wind_gusts_10m?.[i] ?? 16,
        windDir: weather.wind_direction_10m?.[i] ?? 255,
        uvIndex: weather.uv_index?.[i] ?? 6
      });
    }
    return rows;
  }

  static generateSyntheticHilo(spot) {
    const baseMs = new Date().setHours(0, 0, 0, 0);
    const phaseSeed = (spot.id.charCodeAt(3) % 6) * 3600 * 1000;
    const lunarHalfPeriodMs = 6.21 * 3600 * 1000;
    const list = [];
    for (let i = -1; i < 9; i++) {
      const isHigh = i % 2 === 0;
      list.push({
        time: baseMs + phaseSeed + i * lunarHalfPeriodMs,
        heightFt: isHigh ? 4.1 + (i % 3) * 0.3 : 0.4 - (i % 2) * 0.3,
        type: isHigh ? "H" : "L"
      });
    }
    return list;
  }

  static generateFallbackBundle(spot, errorReason) {
    const startHour = new Date();
    startHour.setMinutes(0, 0, 0);
    const startMs = startHour.getTime() - 12 * 3600 * 1000;
    const hourly = [];
    const midSwell = Math.round((spot.idealSwellDeg[0] + spot.idealSwellDeg[1]) / 2);

    for (let i = 0; i < 168; i++) {
      const ts = startMs + i * 3600 * 1000;
      const d = new Date(ts);
      const hour = d.getHours();
      const pulse = Math.sin(i / 15) * 0.42 + 1.12;
      const isMorning = hour >= 6 && hour <= 10;

      hourly.push({
        timestamp: ts,
        waveHeightM: Number((pulse + 0.15).toFixed(2)),
        waveDir: midSwell,
        wavePeriodS: 11,
        swellHeightM: Number(pulse.toFixed(2)),
        swellDir: midSwell,
        swellPeriodS: 12,
        secSwellHeightM: Number((pulse * 0.48).toFixed(2)),
        secSwellDir: (midSwell + 35) % 360,
        secSwellPeriodS: 7,
        waterTempF: spot.region === "Florida" || spot.region === "Hawaii" ? 76 : 63,
        airTempC: isMorning ? 21 : 26,
        feelsLikeC: isMorning ? 21 : 27,
        precipProb: 15,
        weatherCode: 1,
        cloudCover: 25,
        windSpeedKmh: isMorning ? 8 : 17,
        windGustKmh: isMorning ? 12 : 23,
        windDir: isMorning ? spot.offshoreWindDeg : (spot.offshoreWindDeg + 150) % 360,
        uvIndex: 7
      });
    }

    return {
      spotId: spot.id,
      isFallback: true,
      fallbackReason: errorReason,
      sunrise: null,
      sunset: null,
      hourly,
      hiloPredictions: MarineApiClient.generateSyntheticHilo(spot)
    };
  }

  static formatYMD(date) {
    return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  }
}