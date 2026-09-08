/**
 * dynoMath.js - High Precision Vehicle Dynamics & Virtual Dyno Engine
 * Grounded in VirtualDyno physics formulas with SAE / Dynojet / Mustang factors.
 */

const DYNO_FACTORS = {
  dynojet: 1.09,
  mustang: 0.95,
  virtualdyno: 1.00,
  custom: 1.00
};

// Standard constants
const RHO_AIR = 1.225; // kg/m^3 (sea level 15 deg C)
const GRAVITY = 9.80665; // m/s^2
const C_RR = 0.015; // Rolling resistance coefficient
const ROTATIONAL_INERTIA_FACTOR = 1.07; // ~7% for AWD drivetrain + wheel inertia in 3rd/4th
const SQFT_TO_SQM = 0.092903;
const LBS_TO_KG = 0.45359237;
const INCH_TO_METER = 0.0254;
const WATTS_PER_HP = 745.699872;
const KPA_TO_PSI = 0.1450377;

/**
 * Calculate dyno curves from WOT pull data points
 */
function calculateDyno(pullData, carProfile) {
  if (!pullData || pullData.length < 5) {
    return { error: 'Insufficient pull data' };
  }

  const weightLbs = (carProfile.weightLbs || 3351) + 
                    (carProfile.occupantWeightLbs || 0) + 
                    (carProfile.extraWeightLbs || 0);
  const massKg = weightLbs * LBS_TO_KG;

  const gearRatio = parseFloat(carProfile.gearRatio) || 1.346;
  const finalDrive = parseFloat(carProfile.finalDrive) || 3.900;
  const totalRatio = gearRatio * finalDrive;

  const tireDiaInches = parseFloat(carProfile.tireDiameterInches) || 24.97;
  const tireCircMeters = tireDiaInches * INCH_TO_METER * Math.PI;

  const Cd = parseFloat(carProfile.dragCoefficient) || 0.33;
  const frontalAreaM2 = (parseFloat(carProfile.frontalAreaSqFt) || 22.20) * SQFT_TO_SQM;

  const dynoType = (carProfile.dynoType || 'dynojet').toLowerCase();
  const dynoFactor = DYNO_FACTORS[dynoType] || parseFloat(carProfile.customDynoFactor) || 1.00;

  const smoothingLevel = Math.max(0, Math.min(10, parseInt(carProfile.smoothing ?? 4, 10)));

  // Calculate speed v (m/s) for each raw data row from engine RPM
  const rawPoints = pullData.map(pt => {
    const rpm = Math.max(1, pt.rpm);
    const v = (rpm / 60) / totalRatio * tireCircMeters; // m/s
    return {
      t: pt.t,
      rpm: rpm,
      v: v,
      tps: pt.tps,
      mapPsi: pt.mapPsi !== undefined ? pt.mapPsi : (pt.mapKpa ? pt.mapKpa * KPA_TO_PSI : null),
      boostPsi: pt.boostPsi !== undefined ? pt.boostPsi : null,
      lambda: pt.lambda,
      targetLambda: pt.targetLambda,
      ignition: pt.ignition,
      knock: pt.knock,
      vvt: pt.vvt,
      oilPressurePsi: pt.oilPressurePsi,
      iatF: pt.iatF
    };
  });

  // Calculate boost pressure if MAP is present and boostPsi not explicitly set
  // Atmospheric pressure ~ 14.7 psi
  rawPoints.forEach(p => {
    if (p.boostPsi === null && p.mapPsi !== null) {
      p.boostPsi = Math.round((p.mapPsi - 14.7) * 10) / 10;
    }
  });

  // 1. Time-window based smoothing (Physical time in seconds, independent of logger sample rate)
  // Smoothing 0: 0.16s, Smoothing 2: 0.30s, Smoothing 4: 0.44s, Smoothing 6: 0.58s, Smoothing 10: 0.86s
  const windowTimeSec = 0.16 + (smoothingLevel * 0.07);
  const halfWindow = windowTimeSec / 2;
  const sigma = halfWindow / 2;

  // 2. Identify sustained acceleration pull range (trim initial throttle tip-in surge/bogging and end lift)
  const dtSamples = [];
  for (let i = 1; i < Math.min(60, rawPoints.length); i++) {
    const dt = rawPoints[i].t - rawPoints[i - 1].t;
    if (dt > 0.0001) dtSamples.push(dt);
  }
  const avgDt = dtSamples.length > 0 ? (dtSamples.reduce((a, b) => a + b, 0) / dtSamples.length) : 0.01;
  const checkSpan = Math.max(4, Math.round(0.18 / avgDt));

  // Find the stabilization minimum during initial tip-in (first ~1.2s of pull)
  let minRpmIdx = 0;
  let minRpm = 999999;
  for (let i = 0; i < Math.min(Math.round(1.2 / avgDt), rawPoints.length); i++) {
    if (rawPoints[i].rpm < minRpm) {
      minRpm = rawPoints[i].rpm;
      minRpmIdx = i;
    }
  }

  // Ensure startIdx skips initial throttle-hit flutter before the monotonic climb
  let startIdx = minRpmIdx;
  for (let i = minRpmIdx; i < Math.min(Math.round(1.5 / avgDt), rawPoints.length); i++) {
    if (rawPoints[i].rpm <= minRpm + 80) {
      startIdx = i;
    }
  }

  let endIdx = rawPoints.length - 1;
  for (let i = rawPoints.length - 1; i > startIdx + checkSpan; i--) {
    const dRpm = rawPoints[i].rpm - rawPoints[i - checkSpan].rpm;
    if (dRpm > 30) {
      endIdx = i;
      break;
    }
  }

  const cleanPoints = rawPoints.slice(startIdx, endIdx + 1);
  if (cleanPoints.length < 5) {
    return { error: 'Not enough clean acceleration data in pull' };
  }

  // 3. Robust Gaussian-weighted Local Linear Regression for dv/dt and smooth telemetry variables
  const timeSmoothed = [];
  for (let i = 0; i < cleanPoints.length; i++) {
    const t0 = cleanPoints[i].t;
    let sumW = 0, sumWt = 0, sumWv = 0, sumWtt = 0, sumWtv = 0, sumRpm = 0, sumTps = 0;
    let sumBoost = 0, sumLambda = 0, sumTargetLambda = 0, sumIgnition = 0, sumVvt = 0, sumOil = 0, sumIat = 0;
    let countBoost = 0, countLambda = 0, countTargetLambda = 0, countIgnition = 0, countVvt = 0, countOil = 0, countIat = 0;

    for (let j = 0; j < cleanPoints.length; j++) {
      const dt = cleanPoints[j].t - t0;
      if (Math.abs(dt) > halfWindow) continue;

      const w = Math.exp(-0.5 * Math.pow(dt / sigma, 2));
      sumW += w;
      sumWt += w * dt;
      sumWv += w * cleanPoints[j].v;
      sumWtt += w * dt * dt;
      sumWtv += w * dt * cleanPoints[j].v;
      sumRpm += w * cleanPoints[j].rpm;
      sumTps += w * (cleanPoints[j].tps || 0);

      if (cleanPoints[j].boostPsi !== null && cleanPoints[j].boostPsi !== undefined) {
        sumBoost += w * cleanPoints[j].boostPsi; countBoost += w;
      }
      if (cleanPoints[j].lambda !== null && cleanPoints[j].lambda !== undefined) {
        sumLambda += w * cleanPoints[j].lambda; countLambda += w;
      }
      if (cleanPoints[j].targetLambda !== null && cleanPoints[j].targetLambda !== undefined) {
        sumTargetLambda += w * cleanPoints[j].targetLambda; countTargetLambda += w;
      }
      if (cleanPoints[j].ignition !== null && cleanPoints[j].ignition !== undefined) {
        sumIgnition += w * cleanPoints[j].ignition; countIgnition += w;
      }
      if (cleanPoints[j].vvt !== null && cleanPoints[j].vvt !== undefined) {
        sumVvt += w * cleanPoints[j].vvt; countVvt += w;
      }
      if (cleanPoints[j].oilPressurePsi !== null && cleanPoints[j].oilPressurePsi !== undefined) {
        sumOil += w * cleanPoints[j].oilPressurePsi; countOil += w;
      }
      if (cleanPoints[j].iatF !== null && cleanPoints[j].iatF !== undefined) {
        sumIat += w * cleanPoints[j].iatF; countIat += w;
      }
    }

    if (sumW === 0) continue;

    const denom = (sumW * sumWtt - sumWt * sumWt);
    const a = Math.abs(denom) > 1e-9 ? (sumW * sumWtv - sumWt * sumWv) / denom : 0;
    const vSm = sumWv / sumW;
    const rpmSm = sumRpm / sumW;

    timeSmoothed.push({
      t: t0,
      rpm: rpmSm,
      v: vSm,
      a: a,
      tps: sumTps / sumW,
      boostPsi: countBoost > 0 ? sumBoost / countBoost : null,
      lambda: countLambda > 0 ? sumLambda / countLambda : null,
      targetLambda: countTargetLambda > 0 ? sumTargetLambda / countTargetLambda : null,
      ignition: countIgnition > 0 ? sumIgnition / countIgnition : null,
      vvt: countVvt > 0 ? sumVvt / countVvt : null,
      oilPressurePsi: countOil > 0 ? sumOil / countOil : null,
      iatF: countIat > 0 ? sumIat / countIat : null
    });
  }

  if (timeSmoothed.length < 3) {
    return { error: 'Failed to smooth telemetry points' };
  }

  // 4. Uniform Monotonic RPM Grid Normalization
  // Evaluated at clean 25 RPM increments so the curve is strictly monotonic and free of zig-zags
  const minRpmInPull = timeSmoothed[0].rpm;
  const maxRpmInPull = timeSmoothed[timeSmoothed.length - 1].rpm;
  const gridStartRpm = Math.ceil((minRpmInPull + 30) / 25) * 25;
  const gridEndRpm = Math.floor((maxRpmInPull - 30) / 25) * 25;

  const curvePoints = [];
  let peakHp = 0;
  let peakHpRpm = 0;
  let peakTorque = 0;
  let peakTorqueRpm = 0;
  let peakBoost = -999;
  let avgLambda = 0;
  let lambdaCount = 0;

  for (let r = gridStartRpm; r <= gridEndRpm; r += 25) {
    let idx = 0;
    while (idx < timeSmoothed.length - 1 && timeSmoothed[idx + 1].rpm < r) {
      idx++;
    }
    const pA = timeSmoothed[idx];
    const pB = timeSmoothed[Math.min(idx + 1, timeSmoothed.length - 1)];

    let frac = 0;
    if (pB.rpm > pA.rpm) {
      frac = Math.max(0, Math.min(1, (r - pA.rpm) / (pB.rpm - pA.rpm)));
    }

    const interp = (key) => {
      if (pA[key] === null || pB[key] === null) return pA[key] ?? pB[key];
      return pA[key] + frac * (pB[key] - pA[key]);
    };

    const curV = interp('v');
    const curA = interp('a');
    const curBoost = interp('boostPsi');
    const curLambda = interp('lambda');
    const curTargetLambda = interp('targetLambda');
    const curIgnition = interp('ignition');
    const curVvt = interp('vvt');
    const curTps = interp('tps');
    const curOil = interp('oilPressurePsi');
    const curIat = interp('iatF');
    const curT = interp('t');

    // Force calculations (Newtons)
    const F_accel = massKg * ROTATIONAL_INERTIA_FACTOR * Math.max(0, curA);
    const F_aero = 0.5 * RHO_AIR * Cd * frontalAreaM2 * Math.pow(curV, 2);
    const F_roll = C_RR * massKg * GRAVITY;
    const F_total = F_accel + F_aero + F_roll;

    // Power in Watts
    const powerWatts = F_total * curV;
    let whp = (powerWatts / WATTS_PER_HP) * dynoFactor;
    whp = Math.max(0, whp);

    // Torque in lb-ft
    const torqueLbFt = r > 0 ? (whp * 5252) / r : 0;
    const torqueNm = torqueLbFt * 1.355818;
    const powerKw = whp * 0.745699872;

    if (curBoost !== null && curBoost > peakBoost) {
      peakBoost = curBoost;
    }
    if (curLambda !== null && curLambda > 0.4 && curLambda < 1.6) {
      avgLambda += curLambda;
      lambdaCount++;
    }

    // Peak tracking (within valid engine RPM band)
    if (r >= 2200 && r <= 7800) {
      if (whp > peakHp) {
        peakHp = whp;
        peakHpRpm = r;
      }
      if (torqueLbFt > peakTorque) {
        peakTorque = torqueLbFt;
        peakTorqueRpm = r;
      }
    }

    curvePoints.push({
      t: Math.round(curT * 1000) / 1000,
      rpm: r,
      speedMph: Math.round(curV * 2.23694 * 10) / 10,
      hp: Math.round(whp * 10) / 10,
      torque: Math.round(torqueLbFt * 10) / 10,
      torqueNm: Math.round(torqueNm * 10) / 10,
      kw: Math.round(powerKw * 10) / 10,
      boostPsi: curBoost !== null ? Math.round(curBoost * 10) / 10 : null,
      mapPsi: curBoost !== null ? Math.round((curBoost + 14.7) * 10) / 10 : null,
      lambda: curLambda !== null ? Math.round(curLambda * 1000) / 1000 : null,
      targetLambda: curTargetLambda !== null ? Math.round(curTargetLambda * 1000) / 1000 : null,
      ignition: curIgnition !== null ? Math.round(curIgnition * 10) / 10 : null,
      knock: 0,
      vvt: curVvt !== null ? Math.round(curVvt * 10) / 10 : null,
      tps: Math.round(curTps * 10) / 10,
      oilPressurePsi: curOil !== null ? Math.round(curOil * 10) / 10 : null,
      iatF: curIat !== null ? Math.round(curIat) : null
    });
  }

  return {
    curvePoints,
    peakHp: Math.round(peakHp * 10) / 10,
    peakHpRpm,
    peakTorque: Math.round(peakTorque * 10) / 10,
    peakTorqueRpm,
    peakBoostPsi: peakBoost !== -999 ? Math.round(peakBoost * 10) / 10 : null,
    avgLambda: lambdaCount > 0 ? Math.round((avgLambda / lambdaCount) * 1000) / 1000 : null,
    totalWeightLbs: weightLbs,
    dynoType,
    gear: carProfile.gear || 3,
    startRpm: curvePoints[0]?.rpm || 0,
    endRpm: curvePoints[curvePoints.length - 1]?.rpm || 0,
    durationSec: Math.round((cleanPoints[cleanPoints.length - 1].t - cleanPoints[0].t) * 100) / 100
  };
}

module.exports = {
  calculateDyno,
  DYNO_FACTORS
};
