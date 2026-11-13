/**
 * Computes wave energy (kJ), shoaling surf height, wind alignment, MLLW cosine tide
 * interpolation, wetsuit recommendations, Crowdedness, and Kook Meter heuristics.
 */
export class SurfAnalyticsEngine {
  static degToCompass(deg) {
    const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return dirs[Math.round(((deg % 360) / 22.5)) % 16];
  }

  static angularDiff(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  static weatherCodeInfo(code) {
    if (code === 0) return { label: "Clear Sky", icon: "☀" };
    if (code <= 2) return { label: "Partly Cloudy", icon: "⛅" };
    if (code === 3) return { label: "Overcast", icon: "☁" };
    if (code <= 49) return { label: "Coastal Fog", icon: "🌫" };
    if (code <= 69) return { label: "Light Rain", icon: "🌧" };
    if (code <= 84) return { label: "Passing Showers", icon: "🌦" };
    return { label: "Thunderstorms", icon: "⛈" };
  }

  static evaluateTideAt(timestampMs, hiloList) {
    if (!hiloList || hiloList.length < 2) {
      return { heightFt: 2.2, shortNext: "Mid Tide", stage: "Mid" };
    }

    let prev = hiloList[0];
    let next = hiloList[hiloList.length - 1];

    for (let i = 0; i < hiloList.length - 1; i++) {
      if (timestampMs >= hiloList[i].time && timestampMs <= hiloList[i + 1].time) {
        prev = hiloList[i];
        next = hiloList[i + 1];
        break;
      }
    }

    const span = Math.max(1, next.time - prev.time);
    const frac = Math.max(0, Math.min(1, (timestampMs - prev.time) / span));
    const mu = (1 - Math.cos(frac * Math.PI)) / 2;
    const heightFt = prev.heightFt * (1 - mu) + next.heightFt * mu;

    const isRising = next.type === "H";
    const nextTime = new Date(next.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const stage = heightFt < 1.4 ? "Low" : heightFt > 3.4 ? "High" : "Mid";
    const shortNext = `${isRising ? "Rising" : "Dropping"} · ${next.type} @ ${nextTime}`;

    return { heightFt, shortNext, stage };
  }

  static analyzeSlot(slot, spot, hiloList) {
    const Hs = slot.swellHeightM;
    const Tp = slot.swellPeriodS;
    const energyKj = Math.round(0.49 * Hs * Hs * Tp * 10);

    const [minDeg, maxDeg] = spot.idealSwellDeg;
    let swellFactor = 0.68;
    let swellAlignLabel = "Angled";
    if (slot.swellDir >= minDeg && slot.swellDir <= maxDeg) {
      swellFactor = 1.08;
      swellAlignLabel = "Direct Hit";
    } else {
      const dist = Math.min(
        SurfAnalyticsEngine.angularDiff(slot.swellDir, minDeg),
        SurfAnalyticsEngine.angularDiff(slot.swellDir, maxDeg)
      );
      if (dist <= 28) {
        swellFactor = 0.88;
        swellAlignLabel = "Good Angle";
      } else {
        swellFactor = 0.58;
        swellAlignLabel = "Shadowed";
      }
    }

    const periodAmp = Tp >= 14 ? 1.28 : Tp >= 11 ? 1.14 : Tp >= 8 ? 1.0 : 0.85;
    const rawFaceFt = slot.waveHeightM * 3.28084 * swellFactor * periodAmp;
    const minFaceFt = Math.max(1, Math.floor(rawFaceFt * 0.82));
    const maxFaceFt = Math.max(minFaceFt + 1, Math.ceil(rawFaceFt * 1.12));

    let humanScale = "Knee – Thigh";
    let boardRec = "Longboard / Foamie";
    if (maxFaceFt <= 2) {
      humanScale = "Ankle – Knee";
      boardRec = "Longboard / Log";
    } else if (maxFaceFt === 3) {
      humanScale = "Thigh – Waist";
      boardRec = "Funboard / Fish";
    } else if (maxFaceFt <= 5) {
      humanScale = "Waist – Chest";
      boardRec = "All Boards / Shortboard";
    } else if (maxFaceFt <= 7) {
      humanScale = "Head High+";
      boardRec = "Shortboard / Step-Up";
    } else {
      humanScale = "Overhead+";
      boardRec = "Step-Up / Experienced Only";
    }

    const windMph = slot.windSpeedKmh * 0.621371;
    const angleFromOffshore = SurfAnalyticsEngine.angularDiff(slot.windDir, spot.offshoreWindDeg);
    let windLabel = "Cross-shore";
    let windBonus = 0;

    if (windMph <= 5) {
      windLabel = "Glassy";
      windBonus = 1.6;
    } else if (angleFromOffshore <= 45) {
      windLabel = "Offshore";
      windBonus = 1.4;
    } else if (angleFromOffshore <= 105) {
      windLabel = windMph <= 10 ? "Light Cross" : "Cross Chop";
      windBonus = windMph <= 10 ? 0.3 : -0.6;
    } else {
      windLabel = "Onshore";
      windBonus = windMph <= 8 ? -0.3 : -1.3;
    }

    const tideInfo = SurfAnalyticsEngine.evaluateTideAt(slot.timestamp, hiloList);
    const tideBonus = tideInfo.stage === spot.idealTide ? 0.4 : 0;

    const sizeScore = Math.min(2.8, rawFaceFt / 2.1);
    const stars = Math.max(1, Math.min(5, Math.round(sizeScore + windBonus + tideBonus)));
    const qualityClass = stars >= 5 ? "EPIC" : stars === 4 ? "GOOD" : stars === 3 ? "FAIR" : "POOR";

    const amateurSummary = `${humanScale} waves (${minFaceFt}–${maxFaceFt} ft) with ${windLabel.toLowerCase()} winds. Best on a ${boardRec.toLowerCase()}.`;

    const wt = slot.waterTempF;
    const wetsuit =
      wt >= 74 ? "Boardshorts / Rashguard"
      : wt >= 67 ? "2mm Spring Suit"
      : wt >= 60 ? "3/2mm Fullsuit"
      : wt >= 53 ? "4/3mm + Booties"
      : "5/4mm Hooded";

    const d = new Date(slot.timestamp);
    const hr = d.getHours();
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;

    // 1. Crowdedness Heuristic (1.0 - 10.0)
    let crowdScore = spot.basePopularity * 0.45;
    if (hr < 6 || hr >= 20) {
      crowdScore = 1.0;
    } else {
      if (isWeekend) crowdScore += 2.0;
      if (hr >= 6 && hr <= 9) crowdScore += 1.5;
      else if (hr >= 16 && hr <= 18) crowdScore += 1.1;
      if (stars >= 4) crowdScore += 1.6;
      else if (stars <= 2) crowdScore -= 1.2;
    }

    crowdScore = Math.max(1.0, Math.min(10.0, Number(crowdScore.toFixed(1))));
    let crowdLabel = "Moderate";
    let crowdSub = "Manageable lineup";
    let crowdColor = "#4f46e5";
    if (crowdScore < 3.8) {
      crowdLabel = "Light";
      crowdSub = "Plenty of open peaks";
      crowdColor = "#059669";
    } else if (crowdScore < 6.6) {
      crowdLabel = "Moderate";
      crowdSub = "Share the peak";
      crowdColor = "#4f46e5";
    } else if (crowdScore < 8.4) {
      crowdLabel = "Busy";
      crowdSub = "Competitive takeoff zone";
      crowdColor = "#d97706";
    } else {
      crowdLabel = "Packed";
      crowdSub = "Shoulder-to-shoulder pack";
      crowdColor = "#dc2626";
    }

    // 2. Kook Meter Heuristic (1.0 - 10.0)
    let kookScore = spot.basePopularity * 0.38;
    const kookMagnetIds = [
      "hi_waikiki", "ca_malibu", "ca_santamonica", "ca_venice", "ca_sano",
      "ca_elporto", "ca_manhattan", "ca_hermosa", "ca_topanga", "ca_sunsetpt",
      "ca_bolsa", "nc_pacifica", "fl_cocoa", "fl_nsb", "fl_daytona", "fl_jaxpier", "ec_rockaway"
    ];
    const expertOnlyIds = ["hi_pipeline", "hi_backdoor", "nc_mavericks", "ca_wedge", "ca_blacks"];

    if (hr < 6 || hr >= 20) {
      kookScore = 1.0;
    } else {
      if (kookMagnetIds.includes(spot.id)) kookScore += 2.2;
      if (expertOnlyIds.includes(spot.id)) kookScore -= 2.0;

      if (isWeekend) kookScore += 1.6;

      if (hr >= 10 && hr <= 16) kookScore += 1.5;
      else if (hr >= 6 && hr <= 8) kookScore -= 1.0;

      if (maxFaceFt <= 4) kookScore += 1.3;
      else if (maxFaceFt >= 7) kookScore -= 2.8;

      if (slot.airTempC >= 22 && slot.weatherCode <= 2) kookScore += 0.8;
    }

    kookScore = Math.max(1.0, Math.min(10.0, Number(kookScore.toFixed(1))));
    let kookLabel = "Low Kooks";
    let kookSub = "Mostly experienced locals";
    let kookColor = "#059669";

    if (kookScore >= 8.2) {
      kookLabel = "Full Zoo";
      kookSub = "Dodge flying Wavestorms";
      kookColor = "#dc2626";
    } else if (kookScore >= 6.2) {
      kookLabel = "Party Wave";
      kookSub = "Watch for drop-ins & no-leashes";
      kookColor = "#d97706";
    } else if (kookScore >= 4.0) {
      kookLabel = "Some Foamies";
      kookSub = "Casual learners on the inside";
      kookColor = "#4f46e5";
    }

    return {
      minFaceFt,
      maxFaceFt,
      humanScale,
      boardRec,
      amateurSummary,
      energyKj,
      swellAlignLabel,
      windMph,
      windLabel,
      tideInfo,
      stars,
      qualityClass,
      wetsuit,
      crowdScore,
      crowdLabel,
      crowdSub,
      crowdColor,
      kookScore,
      kookLabel,
      kookSub,
      kookColor
    };
  }
}