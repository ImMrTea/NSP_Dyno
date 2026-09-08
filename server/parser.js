/**
 * parser.js - Universal Haltech Nexus R3 & Tuning Log Parser
 */

const KPA_TO_PSI = 0.1450377;

function parseLog(fileContent, filename = '') {
  if (!fileContent || typeof fileContent !== 'string') {
    return { error: 'Empty or invalid file content' };
  }

  const lines = fileContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 3) {
    return { error: 'File contains insufficient data' };
  }

  let channels = [];
  let units = [];
  let rawRows = [];
  let format = 'unknown';

  if (lines[0].startsWith('%DataLog%')) {
    format = 'haltech_nsp_raw';
    const parsed = parseHaltechRaw(lines);
    channels = parsed.channels;
    rawRows = parsed.rows;
  } else {
    const line0 = lines[0].split(',').map(s => s.trim().replace(/^"|"$/g, ''));
    const line1 = lines[1].split(',').map(s => s.trim().replace(/^"|"$/g, ''));

    const hasUnitsRow = line1.some(val => 
      /^(s\.|rpm|%|kpa|psi|v|deg|c|f|afr|:1)$/i.test(val) || val.includes('°')
    );

    if (hasUnitsRow) {
      format = 'haltech_flat_csv';
      channels = line0;
      units = line1;
      rawRows = parseStandardRows(lines.slice(2), channels);
    } else {
      format = 'generic_csv';
      channels = line0;
      rawRows = parseStandardRows(lines.slice(1), channels);
    }
  }

  if (rawRows.length === 0) {
    return { error: 'No numeric telemetry rows could be parsed' };
  }

  const mapping = identifyChannels(channels, units);

  let maxTpsSeen = 0;
  const normalizedRows = [];

  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i];
    const t = r[mapping.time];
    const rpm = r[mapping.rpm];
    let tps = r[mapping.tps];
    let map = r[mapping.map];
    let boost = r[mapping.boost];
    let lambda = r[mapping.lambda];
    let targetLambda = r[mapping.targetLambda];
    let ignition = r[mapping.ignition];
    let knock = r[mapping.knock];
    let gear = r[mapping.gear];
    let speed = r[mapping.speed];
    let vvt = r[mapping.vvt];
    let oilPressure = r[mapping.oilPressure];
    let iat = r[mapping.iat];

    if (t === undefined || isNaN(t) || rpm === undefined || isNaN(rpm)) continue;

    if (tps !== undefined && !isNaN(tps)) {
      if (tps > maxTpsSeen) maxTpsSeen = tps;
    } else {
      tps = 100;
    }

    // Imperial pressure normalization (All in PSI)
    let mapPsi = null;
    let boostPsi = null;

    if (boost !== undefined && !isNaN(boost)) {
      boostPsi = boost;
      mapPsi = boostPsi + 14.7;
    } else if (map !== undefined && !isNaN(map)) {
      const mapUnit = mapping.mapUnit ? mapping.mapUnit.toLowerCase() : '';
      if (mapUnit === 'psi') {
        // Haltech exports gauge MAP in psi (0 psi = atmospheric, 21 psi = 21 psi boost)
        boostPsi = map;
        mapPsi = boostPsi + 14.7;
      } else if (mapUnit === 'kpa' || map > 80) {
        mapPsi = map * KPA_TO_PSI;
        boostPsi = (map - 101.325) * KPA_TO_PSI;
      } else if (map <= 45 && map >= -15) {
        boostPsi = map;
        mapPsi = boostPsi + 14.7;
      } else {
        mapPsi = map;
        boostPsi = mapPsi - 14.7;
      }
    }

    // Lambda normalization (ensure Lambda format 0.60 - 1.30)
    if (lambda !== undefined && !isNaN(lambda)) {
      if (lambda > 5.0) {
        lambda = lambda / 14.7;
      }
    } else {
      lambda = null;
    }

    if (targetLambda !== undefined && !isNaN(targetLambda)) {
      if (targetLambda > 5.0) {
        targetLambda = targetLambda / 14.7;
      }
    } else {
      targetLambda = null;
    }

    // Oil pressure in PSI
    let oilPressurePsi = null;
    if (oilPressure !== undefined && !isNaN(oilPressure)) {
      oilPressurePsi = oilPressure > 100 ? oilPressure * KPA_TO_PSI : oilPressure;
    }

    // IAT in Fahrenheit
    let iatF = null;
    if (iat !== undefined && !isNaN(iat)) {
      if (iat > 200) {
        iatF = (iat - 273.15) * 1.8 + 32;
      } else {
        iatF = iat * 1.8 + 32;
      }
    }

    // Speed in MPH
    let speedMph = null;
    if (speed !== undefined && !isNaN(speed)) {
      const spdUnit = mapping.speedUnit ? mapping.speedUnit.toLowerCase() : '';
      if (spdUnit.includes('km') || spdUnit.includes('kph')) {
        speedMph = speed * 0.621371;
      } else if (spdUnit.includes('mph')) {
        speedMph = speed;
      } else {
        // Default telemetry fallback: if top speeds in logs exceed typical mph in 3rd/4th gear
        speedMph = speed > 115 ? speed * 0.621371 : speed;
      }
      speedMph = Math.round(speedMph * 10) / 10;
    }

    normalizedRows.push({
      t,
      rpm,
      tps: Math.round(tps * 10) / 10,
      mapPsi: mapPsi !== null ? Math.round(mapPsi * 10) / 10 : null,
      boostPsi: boostPsi !== null ? Math.round(boostPsi * 10) / 10 : null,
      lambda: lambda !== null ? Math.round(lambda * 1000) / 1000 : null,
      targetLambda: targetLambda !== null ? Math.round(targetLambda * 1000) / 1000 : null,
      ignition: ignition !== undefined && !isNaN(ignition) ? Math.round(ignition * 10) / 10 : null,
      knock: knock !== undefined && !isNaN(knock) ? knock : 0,
      gear: gear !== undefined && !isNaN(gear) ? Math.round(gear) : null,
      speedMph,
      vvt: vvt !== undefined && !isNaN(vvt) ? Math.round(vvt * 10) / 10 : null,
      oilPressurePsi: oilPressurePsi !== null ? Math.round(oilPressurePsi * 10) / 10 : null,
      iatF: iatF !== null ? Math.round(iatF) : null
    });
  }

  // WOT Pull Extraction: requires >= 85% TPS
  const WOT_THRESHOLD = 85.0;
  const pulls = extractWotPulls(normalizedRows, WOT_THRESHOLD);

  let warning = null;
  if (pulls.length === 0) {
    if (maxTpsSeen < WOT_THRESHOLD) {
      warning = `Warning: No 85%+ Throttle Position detected in this log. Peak throttle observed was ${Math.round(maxTpsSeen * 10) / 10}%. Virtual dyno calculations require wide-open throttle (>= 85%).`;
    } else {
      warning = `Warning: 85%+ throttle was observed, but no sustained RPM ascent pull was found.`;
    }
  }

  return {
    filename,
    format,
    totalRows: normalizedRows.length,
    channels,
    mapping,
    maxTpsSeen: Math.round(maxTpsSeen * 10) / 10,
    warning,
    pulls,
    allRows: normalizedRows
  };
}

function parseHaltechRaw(lines) {
  const channels = [];
  let dataStartIndex = -1;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('Channel : ')) {
      channels.push(line.replace('Channel : ', '').trim());
    } else if (/^\d{2}:\d{2}:\d{2}/.test(line)) {
      dataStartIndex = i;
      break;
    }
  }

  const rows = [];
  let t0 = null;

  for (let i = dataStartIndex; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 2) continue;

    const timeStr = parts[0].trim();
    const timeMatch = timeStr.match(/^(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
    if (!timeMatch) continue;

    const totalSec = parseInt(timeMatch[1], 10) * 3600 + 
                     parseInt(timeMatch[2], 10) * 60 + 
                     parseFloat(timeMatch[3]);
    if (t0 === null) t0 = totalSec;

    const rowObj = { 'Time': Math.round((totalSec - t0) * 1000) / 1000 };

    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      let val = parseFloat(parts[c + 1]);
      if (isNaN(val)) continue;

      if (/throttle|tps/i.test(ch) && val > 100) val /= 10;
      if (/wideband|target lambda|lambda/i.test(ch) && val > 10) val /= 1000;
      if (/manifold pressure|map/i.test(ch) && val > 500) val /= 10; // kPa
      if (/ignition angle/i.test(ch) && Math.abs(val) > 100) val /= 10;
      if (/cam control/i.test(ch) && Math.abs(val) > 100) val /= 10;
      if (/vehicle speed/i.test(ch) && val > 500) val /= 10;
      if (/intake air temperature|iat/i.test(ch) && val > 1000) val /= 10;

      rowObj[ch] = val;
    }

    rows.push(rowObj);
  }

  return { channels: ['Time', ...channels], rows };
}

function parseStandardRows(dataLines, channels) {
  const rows = [];
  let t0 = null;

  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i];
    if (!line) continue;
    const parts = line.split(',');
    if (parts.length < 2) continue;

    const rowObj = {};
    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      const valStr = parts[c]?.trim();
      if (!valStr) continue;

      if (/time/i.test(ch) && /^\d{2}:\d{2}:\d{2}/.test(valStr)) {
        const m = valStr.match(/^(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
        if (m) {
          const sec = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
          if (t0 === null) t0 = sec;
          rowObj[ch] = Math.round((sec - t0) * 1000) / 1000;
        }
      } else {
        const num = parseFloat(valStr);
        if (!isNaN(num)) {
          rowObj[ch] = num;
        }
      }
    }

    const timeKey = channels.find(c => /time/i.test(c));
    if (timeKey && rowObj[timeKey] !== undefined) {
      if (rowObj[timeKey] > 10000 && i > 0 && (rowObj[timeKey] - rows[0]?.[timeKey]) > 1000) {
        rowObj[timeKey] /= 1000;
      }
    }

    rows.push(rowObj);
  }

  return rows;
}

function identifyChannels(channels, units = []) {
  const find = (regex) => channels.find(c => regex.test(c.toLowerCase()));
  const findIdx = (regex) => channels.findIndex(c => regex.test(c.toLowerCase()));

  const mapIdx = findIdx(/^(manifold pressure|map|manifold absolute pressure)/i);
  let mapUnit = mapIdx >= 0 && units[mapIdx] ? units[mapIdx] : '';

  const speedIdx = findIdx(/^(vehicle speed|speed)/i);
  let speedUnit = speedIdx >= 0 && units[speedIdx] ? units[speedIdx] : '';

  return {
    time: find(/^time/i) || channels[0],
    rpm: find(/^(rpm|engine speed)/i),
    tps: find(/^(tps|throttle position|throttle opening)/i),
    map: channels[mapIdx],
    mapUnit: mapUnit,
    boost: find(/^(boost pressure|manifold relative pressure|relative pressure|boost(?!.*(?:duty|solenoid|target|temp|air)))/i),
    lambda: find(/^(wideband|wideband o2|lambda|afr|a\/f sensor)/i),
    targetLambda: find(/^(target lambda|final fueling base|target afr)/i),
    ignition: find(/^(ignition angle|ignition total timing|base ignition)/i),
    knock: find(/^(knock|feedback knock|fine learning knock)/i),
    gear: find(/^gear/i),
    speed: channels[speedIdx],
    speedUnit: speedUnit,
    vvt: find(/^(cam control|vvt|intake vvt)/i),
    oilPressure: find(/^oil pressure/i),
    iat: find(/^(intake air temperature|iat)/i)
  };
}

function extractWotPulls(rows, thresholdTps = 85.0) {
  const pulls = [];
  let inWot = false;
  let currentPull = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const isWot = (r.tps >= thresholdTps);

    if (isWot) {
      if (!inWot) {
        inWot = true;
        currentPull = [r];
      } else {
        currentPull.push(r);
      }
    } else {
      if (inWot) {
        inWot = false;
        if (currentPull.length >= 20) {
          validateAndAddPull(currentPull, pulls);
        }
        currentPull = [];
      }
    }
  }

  if (inWot && currentPull.length >= 20) {
    validateAndAddPull(currentPull, pulls);
  }

  return pulls;
}

function validateAndAddPull(pullRows, pulls) {
  const minRpm = Math.min(...pullRows.map(p => p.rpm));
  const maxRpm = Math.max(...pullRows.map(p => p.rpm));
  const duration = pullRows[pullRows.length - 1].t - pullRows[0].t;

  if ((maxRpm - minRpm) >= 1200 && duration >= 0.8) {
    const gearCounts = {};
    pullRows.forEach(r => {
      if (r.gear) gearCounts[r.gear] = (gearCounts[r.gear] || 0) + 1;
    });
    let dominantGear = 3;
    let maxCount = 0;
    Object.entries(gearCounts).forEach(([g, count]) => {
      if (count > maxCount) {
        maxCount = count;
        dominantGear = parseInt(g, 10);
      }
    });

    pulls.push({
      pullIndex: pulls.length + 1,
      gear: dominantGear,
      startRpm: Math.round(minRpm),
      endRpm: Math.round(maxRpm),
      durationSec: Math.round(duration * 100) / 100,
      pointsCount: pullRows.length,
      data: pullRows
    });
  }
}

module.exports = {
  parseLog,
  identifyChannels,
  extractWotPulls
};
