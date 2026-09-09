/**
 * dynoCanvas.js - High-DPI Interactive Dyno & Split Telemetry Renderer
 * Features live in-line callout data badges directly at each line intersection!
 */

class DynoCanvas {
  constructor(dynoCanvasId, telemCanvasId, onRpmChange) {
    this.dynoCanvas = document.getElementById(dynoCanvasId);
    this.telemCanvas = document.getElementById(telemCanvasId);
    this.onRpmChange = onRpmChange || (() => {});

    this.dynoCtx = this.dynoCanvas.getContext('2d');
    this.telemCtx = this.telemCanvas.getContext('2d');

    this.runA = null; // { dynoResult, filename, ethanol, notes }
    this.runB = null; // { dynoResult, filename, ethanol, notes }

    this.dynoMode = 'both'; // 'both', 'torque_only', 'power_only'
    this.boostUnit = 'psi'; // 'psi', 'kpa'
    this.fuelUnit = 'lambda'; // 'lambda', 'afr'
    this.telemChannels = {
      boost: true,
      lambda: true,
      ignition: true,
      tps: false
    };

    this.cursorRpm = null;
    this.isDragging = false;

    this.padding = { top: 25, right: 65, bottom: 25, left: 65 };
    this.telemPadding = { top: 15, right: 65, bottom: 25, left: 65 };

    this.setupEvents();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setupEvents() {
    const handlePointer = (canvas, e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const bounds = this.getBounds();
      const plotW = this.width - this.padding.left - this.padding.right;
      const rpm = bounds.minRpm + ((x - this.padding.left) / plotW) * (bounds.maxRpm - bounds.minRpm);
      
      const clampedRpm = Math.max(bounds.minRpm, Math.min(bounds.maxRpm, rpm));
      this.cursorRpm = clampedRpm;
      this.onRpmChange(clampedRpm);
      this.render();
    };

    [this.dynoCanvas, this.telemCanvas].forEach(c => {
      c.addEventListener('mousemove', (e) => {
        handlePointer(c, e);
      });

      c.addEventListener('mousedown', (e) => {
        this.isDragging = true;
        handlePointer(c, e);
      });

      c.addEventListener('mouseleave', () => {
        this.isDragging = false;
      });
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });
  }

  resize() {
    this.dpr = window.devicePixelRatio || 1;

    // Upper canvas
    const dRect = this.dynoCanvas.parentElement.getBoundingClientRect();
    this.width = dRect.width;
    this.dynoHeight = dRect.height;
    this.dynoCanvas.width = this.width * this.dpr;
    this.dynoCanvas.height = this.dynoHeight * this.dpr;
    this.dynoCanvas.style.width = `${this.width}px`;
    this.dynoCanvas.style.height = `${this.dynoHeight}px`;

    // Lower canvas
    const tRect = this.telemCanvas.parentElement.getBoundingClientRect();
    this.telemHeight = tRect.height;
    this.telemCanvas.width = this.width * this.dpr;
    this.telemCanvas.height = this.telemHeight * this.dpr;
    this.telemCanvas.style.width = `${this.width}px`;
    this.telemCanvas.style.height = `${this.telemHeight}px`;

    this.render();
  }

  setRuns(runA, runB) {
    this.runA = runA;
    this.runB = runB;
    this.render();
  }

  setCursorRpm(rpm) {
    this.cursorRpm = rpm;
    this.render();
  }

  setDynoMode(mode) {
    this.dynoMode = mode;
    this.render();
  }

  toggleTelemChannel(key, active) {
    this.telemChannels[key] = active;
    this.render();
  }

  setUnits(boostUnit, fuelUnit) {
    if (boostUnit) this.boostUnit = boostUnit;
    if (fuelUnit) this.fuelUnit = fuelUnit;
    this.render();
  }

  getBounds() {
    let minRpm = 99999;
    let maxRpm = 0;
    let maxPowerTq = 0;

    let maxBoost = 20;
    let maxTiming = 35;

    const examine = (pts) => {
      if (!pts || pts.length === 0) return;
      pts.forEach(p => {
        if (p.rpm < minRpm && p.rpm > 1000) minRpm = p.rpm;
        if (p.rpm > maxRpm && p.rpm < 9500) maxRpm = p.rpm;
        if (p.hp > maxPowerTq) maxPowerTq = p.hp;
        if (p.torque > maxPowerTq) maxPowerTq = p.torque;
        if (p.boostPsi && p.boostPsi > maxBoost) maxBoost = p.boostPsi;
        if (p.ignition && p.ignition > maxTiming) maxTiming = p.ignition;
      });
    };

    if (this.runA?.dynoResult?.curvePoints) examine(this.runA.dynoResult.curvePoints);
    if (this.runB?.dynoResult?.curvePoints) examine(this.runB.dynoResult.curvePoints);

    if (minRpm === 99999) minRpm = 2500;
    if (maxRpm === 0) maxRpm = 7000;

    // Tight bounds to stretch curve from left to right with ~60 RPM margin
    minRpm = Math.max(1000, Math.floor((minRpm - 60) / 100) * 100);
    maxRpm = Math.min(9500, Math.ceil((maxRpm + 60) / 100) * 100);

    maxPowerTq = Math.ceil((maxPowerTq * 1.08) / 50) * 50;
    if (maxPowerTq < 200) maxPowerTq = 400;

    if (this.boostUnit === 'kpa') {
      let maxBoostKpa = maxBoost * 6.89476;
      maxBoostKpa = Math.ceil((maxBoostKpa * 1.15) / 25) * 25;
      if (maxBoostKpa < 100) maxBoostKpa = 150;
      maxBoost = maxBoostKpa;
    } else {
      maxBoost = Math.ceil((maxBoost * 1.15) / 5) * 5;
      if (maxBoost < 15) maxBoost = 25;
    }

    return { minRpm, maxRpm, minPowerTq: 0, maxPowerTq, maxBoost, maxTiming };
  }

  render() {
    this.renderDynoGraph();
    this.renderTelemGraph();
  }

  // --- 1. Upper Dyno Graph ---
  renderDynoGraph() {
    const ctx = this.dynoCtx;
    const w = this.width;
    const h = this.dynoHeight;
    const p = this.padding;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, w, h);

    const bounds = this.getBounds();
    const plotW = w - p.left - p.right;
    const plotH = h - p.top - p.bottom;

    const rpmToX = (rpm) => p.left + ((rpm - bounds.minRpm) / (bounds.maxRpm - bounds.minRpm)) * plotW;
    const powerToY = (val) => p.top + plotH - ((val - bounds.minPowerTq) / (bounds.maxPowerTq - bounds.minPowerTq)) * plotH;

    // Horizontal Grid (Power / Torque)
    ctx.lineWidth = 1;
    const yStep = bounds.maxPowerTq > 600 ? 100 : 50;
    for (let val = bounds.minPowerTq; val <= bounds.maxPowerTq; val += yStep) {
      const y = powerToY(val);
      ctx.strokeStyle = val === 0 ? '#232f42' : 'rgba(35, 47, 66, 0.45)';
      ctx.beginPath();
      ctx.moveTo(p.left, y);
      ctx.lineTo(w - p.right, y);
      ctx.stroke();

      ctx.fillStyle = '#8899a6';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(val.toString(), p.left - 8, y);
    }

    // Vertical Grid (RPM)
    const rpmSpan = bounds.maxRpm - bounds.minRpm;
    const rpmStep = rpmSpan > 3500 ? 500 : 250;
    const firstTick = Math.ceil(bounds.minRpm / rpmStep) * rpmStep;

    for (let rpm = firstTick; rpm <= bounds.maxRpm; rpm += rpmStep) {
      const x = rpmToX(rpm);
      ctx.strokeStyle = 'rgba(35, 47, 66, 0.45)';
      ctx.beginPath();
      ctx.moveTo(x, p.top);
      ctx.lineTo(x, p.top + plotH);
      ctx.stroke();

      ctx.fillStyle = '#8899a6';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(rpm.toString(), x, p.top + plotH + 6);
    }

    // Y Axis Title
    ctx.save();
    ctx.translate(16, p.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#8899a6';
    ctx.font = 'bold 10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Power (WHP) / Torque (lb-ft)', 0, 0);
    ctx.restore();

    // Draw Run A Curves
    if (this.runA?.dynoResult?.curvePoints) {
      this.drawDynoCurves(this.runA.dynoResult.curvePoints, '#00e5ff', rpmToX, powerToY);
      if (this.runA.dynoResult.peakHpRpm) {
        this.drawPeakMarker(this.runA.dynoResult.peakHpRpm, this.runA.dynoResult.peakHp, '#00e5ff', 'WHP', rpmToX, powerToY);
        this.drawPeakMarker(this.runA.dynoResult.peakTorqueRpm, this.runA.dynoResult.peakTorque, '#00e5ff', 'lb-ft', rpmToX, powerToY);
      }
    }

    // Draw Run B Curves
    if (this.runB?.dynoResult?.curvePoints) {
      this.drawDynoCurves(this.runB.dynoResult.curvePoints, '#ff9100', rpmToX, powerToY);
      if (this.runB.dynoResult.peakHpRpm) {
        this.drawPeakMarker(this.runB.dynoResult.peakHpRpm, this.runB.dynoResult.peakHp, '#ff9100', 'WHP', rpmToX, powerToY);
        this.drawPeakMarker(this.runB.dynoResult.peakTorqueRpm, this.runB.dynoResult.peakTorque, '#ff9100', 'lb-ft', rpmToX, powerToY);
      }
    }

    // Live In-Line Callouts at Cursor Intersections!
    if (this.cursorRpm && this.cursorRpm >= bounds.minRpm && this.cursorRpm <= bounds.maxRpm) {
      const cx = rpmToX(this.cursorRpm);

      // Vertical cursor line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cx, p.top);
      ctx.lineTo(cx, p.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw callouts on each active curve!
      const callouts = [];

      if (this.runA?.dynoResult?.curvePoints) {
        const ptA = this.interpolatePoint(this.runA.dynoResult.curvePoints, this.cursorRpm);
        if (ptA) {
          if (this.dynoMode === 'both' || this.dynoMode === 'power_only') {
            callouts.push({ y: powerToY(ptA.hp), text: `${Math.round(ptA.hp)} WHP`, color: '#00e5ff', label: 'Run A' });
          }
          if (this.dynoMode === 'both' || this.dynoMode === 'torque_only') {
            callouts.push({ y: powerToY(ptA.torque), text: `${Math.round(ptA.torque)} lb-ft`, color: '#00e5ff', label: 'Run A' });
          }
        }
      }

      if (this.runB?.dynoResult?.curvePoints) {
        const ptB = this.interpolatePoint(this.runB.dynoResult.curvePoints, this.cursorRpm);
        if (ptB) {
          if (this.dynoMode === 'both' || this.dynoMode === 'power_only') {
            callouts.push({ y: powerToY(ptB.hp), text: `${Math.round(ptB.hp)} WHP`, color: '#ff9100', label: 'Run B' });
          }
          if (this.dynoMode === 'both' || this.dynoMode === 'torque_only') {
            callouts.push({ y: powerToY(ptB.torque), text: `${Math.round(ptB.torque)} lb-ft`, color: '#ff9100', label: 'Run B' });
          }
        }
      }

      this.renderCallouts(cx, callouts, w, p.right);
    }

    ctx.restore();
  }

  drawDynoCurves(pts, color, rpmToX, powerToY) {
    const ctx = this.dynoCtx;

    // WHP (Solid)
    if (this.dynoMode === 'both' || this.dynoMode === 'power_only') {
      ctx.beginPath();
      ctx.lineWidth = 3;
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      let started = false;
      for (const pt of pts) {
        const x = rpmToX(pt.rpm);
        const y = powerToY(pt.hp);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else { ctx.lineTo(x, y); }
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Torque (Dashed)
    if (this.dynoMode === 'both' || this.dynoMode === 'torque_only') {
      ctx.beginPath();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = color;
      ctx.setLineDash([6, 3]);
      let started = false;
      for (const pt of pts) {
        const x = rpmToX(pt.rpm);
        const y = powerToY(pt.torque);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else { ctx.lineTo(x, y); }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  drawPeakMarker(rpm, val, color, unit, rpmToX, powerToY) {
    const ctx = this.dynoCtx;
    const x = rpmToX(rpm);
    const y = powerToY(val);

    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const tagText = `${Math.round(val)} ${unit}`;
    ctx.font = 'bold 9px monospace';
    const textW = ctx.measureText(tagText).width;

    ctx.fillStyle = 'rgba(18, 24, 36, 0.9)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - textW / 2 - 4, y - 20, textW + 8, 14, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tagText, x, y - 13);
  }

  // --- 2. Lower Telemetry Graph ---
  renderTelemGraph() {
    const ctx = this.telemCtx;
    const w = this.width;
    const h = this.telemHeight;
    const p = this.telemPadding;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, w, h);

    const bounds = this.getBounds();
    const plotW = w - p.left - p.right;
    const plotH = h - p.top - p.bottom;

    const rpmToX = (rpm) => p.left + ((rpm - bounds.minRpm) / (bounds.maxRpm - bounds.minRpm)) * plotW;
    const boostToY = (b) => p.top + plotH - (b / bounds.maxBoost) * plotH;
    const fuelToY = (l) => p.top + plotH - ((l - 0.65) / 0.50) * plotH; // 0.65 to 1.15 lambda

    // Horizontal Grid Lines & Left Axis (Boost)
    ctx.lineWidth = 1;
    const boostStep = this.boostUnit === 'kpa' ? (bounds.maxBoost >= 250 ? 50 : 25) : 5;
    for (let b = 0; b <= bounds.maxBoost; b += boostStep) {
      const y = boostToY(b);
      ctx.strokeStyle = 'rgba(35, 47, 66, 0.45)';
      ctx.beginPath();
      ctx.moveTo(p.left, y);
      ctx.lineTo(w - p.right, y);
      ctx.stroke();

      ctx.fillStyle = '#00e676';
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const bLabel = this.boostUnit === 'kpa' ? `${b} kPa` : `${b} psi`;
      ctx.fillText(bLabel, p.left - 6, y);
    }

    // Right Axis (Fuel: Lambda or AFR)
    if (this.fuelUnit === 'afr') {
      for (let afr = 10.0; afr <= 16.0; afr += 1.0) {
        const y = fuelToY(afr / 14.7);
        ctx.fillStyle = '#ffaa00';
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${afr.toFixed(1)} AFR`, w - p.right + 6, y);
      }
    } else {
      for (let l = 0.70; l <= 1.10; l += 0.10) {
        const y = fuelToY(l);
        ctx.fillStyle = '#ffaa00';
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${l.toFixed(2)}λ`, w - p.right + 6, y);
      }
    }

    // Vertical RPM Grid Lines
    const rpmSpan = bounds.maxRpm - bounds.minRpm;
    const rpmStep = rpmSpan > 3500 ? 500 : 250;
    const firstTick = Math.ceil(bounds.minRpm / rpmStep) * rpmStep;

    for (let rpm = firstTick; rpm <= bounds.maxRpm; rpm += rpmStep) {
      const x = rpmToX(rpm);
      ctx.strokeStyle = 'rgba(35, 47, 66, 0.45)';
      ctx.beginPath();
      ctx.moveTo(x, p.top);
      ctx.lineTo(x, p.top + plotH);
      ctx.stroke();

      ctx.fillStyle = '#8899a6';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(rpm.toString(), x, p.top + plotH + 5);
    }

    // Draw Traces
    const drawTelemRun = (pts, isRunB = false) => {
      const lineDash = isRunB ? [4, 3] : [];

      // Boost
      if (this.telemChannels.boost) {
        ctx.beginPath();
        ctx.lineWidth = 2;
        ctx.strokeStyle = isRunB ? 'rgba(0, 230, 118, 0.6)' : '#00e676';
        ctx.setLineDash(lineDash);
        let started = false;
        pts.forEach(pt => {
          if (pt.boostPsi === null) return;
          const bVal = this.boostUnit === 'kpa' ? pt.boostPsi * 6.89476 : pt.boostPsi;
          const x = rpmToX(pt.rpm);
          const y = boostToY(bVal);
          if (!started) { ctx.moveTo(x, y); started = true; }
          else { ctx.lineTo(x, y); }
        });
        ctx.stroke();
      }

      // Lambda / Fuel
      if (this.telemChannels.lambda) {
        ctx.beginPath();
        ctx.lineWidth = 2;
        ctx.strokeStyle = isRunB ? 'rgba(255, 170, 0, 0.6)' : '#ffaa00';
        ctx.setLineDash(lineDash);
        let started = false;
        pts.forEach(pt => {
          if (pt.lambda === null) return;
          const x = rpmToX(pt.rpm);
          const y = fuelToY(pt.lambda);
          if (!started) { ctx.moveTo(x, y); started = true; }
          else { ctx.lineTo(x, y); }
        });
        ctx.stroke();
      }

      // Timing
      if (this.telemChannels.ignition) {
        ctx.beginPath();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = isRunB ? 'rgba(179, 136, 255, 0.6)' : '#b388ff';
        ctx.setLineDash(lineDash);
        let started = false;
        pts.forEach(pt => {
          if (pt.ignition === null) return;
          const y = p.top + plotH - (pt.ignition / 40) * plotH;
          const x = rpmToX(pt.rpm);
          if (!started) { ctx.moveTo(x, y); started = true; }
          else { ctx.lineTo(x, y); }
        });
        ctx.stroke();
      }

      // Throttle %
      if (this.telemChannels.tps) {
        ctx.beginPath();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = isRunB ? 'rgba(0, 229, 255, 0.6)' : '#00e5ff';
        ctx.setLineDash(lineDash);
        let started = false;
        pts.forEach(pt => {
          if (pt.tps === null) return;
          const y = p.top + plotH - (pt.tps / 100) * plotH;
          const x = rpmToX(pt.rpm);
          if (!started) { ctx.moveTo(x, y); started = true; }
          else { ctx.lineTo(x, y); }
        });
        ctx.stroke();
      }

      ctx.setLineDash([]);
    };

    if (this.runA?.dynoResult?.curvePoints) drawTelemRun(this.runA.dynoResult.curvePoints, false);
    if (this.runB?.dynoResult?.curvePoints) drawTelemRun(this.runB.dynoResult.curvePoints, true);

    // Live In-Line Callouts on Lower Telemetry Graph!
    if (this.cursorRpm && this.cursorRpm >= bounds.minRpm && this.cursorRpm <= bounds.maxRpm) {
      const cx = rpmToX(this.cursorRpm);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cx, p.top);
      ctx.lineTo(cx, p.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      const telemCallouts = [];
      const hasBoth = !!(this.runA?.dynoResult?.curvePoints && this.runB?.dynoResult?.curvePoints);

      const ptA = this.runA?.dynoResult?.curvePoints ? this.interpolatePoint(this.runA.dynoResult.curvePoints, this.cursorRpm) : null;
      if (ptA) {
        const pA = hasBoth ? 'A: ' : '';
        if (this.telemChannels.boost && ptA.boostPsi !== null) {
          const bVal = this.boostUnit === 'kpa' ? ptA.boostPsi * 6.89476 : ptA.boostPsi;
          const bText = this.boostUnit === 'kpa' ? `${bVal.toFixed(1)} kPa` : `${ptA.boostPsi} psi`;
          telemCallouts.push({ y: boostToY(bVal), text: `${pA}${bText}`, color: '#00e676' });
        }
        if (this.telemChannels.lambda && ptA.lambda !== null) {
          const fText = this.fuelUnit === 'afr' ? `${(ptA.lambda * 14.7).toFixed(2)} AFR` : `${ptA.lambda}λ`;
          telemCallouts.push({ y: fuelToY(ptA.lambda), text: `${pA}${fText}`, color: '#ffaa00' });
        }
        if (this.telemChannels.ignition && ptA.ignition !== null) {
          telemCallouts.push({ y: p.top + plotH - (ptA.ignition / 40) * plotH, text: `${pA}${ptA.ignition}°`, color: '#b388ff' });
        }
        if (this.telemChannels.tps && ptA.tps !== null) {
          telemCallouts.push({ y: p.top + plotH - (ptA.tps / 100) * plotH, text: `${pA}${ptA.tps}%`, color: '#00e5ff' });
        }
      }

      const ptB = this.runB?.dynoResult?.curvePoints ? this.interpolatePoint(this.runB.dynoResult.curvePoints, this.cursorRpm) : null;
      if (ptB) {
        const pB = hasBoth ? 'B: ' : '';
        if (this.telemChannels.boost && ptB.boostPsi !== null) {
          const bVal = this.boostUnit === 'kpa' ? ptB.boostPsi * 6.89476 : ptB.boostPsi;
          const bText = this.boostUnit === 'kpa' ? `${bVal.toFixed(1)} kPa` : `${ptB.boostPsi} psi`;
          telemCallouts.push({ y: boostToY(bVal), text: `${pB}${bText}`, color: 'rgba(0, 230, 118, 0.85)' });
        }
        if (this.telemChannels.lambda && ptB.lambda !== null) {
          const fText = this.fuelUnit === 'afr' ? `${(ptB.lambda * 14.7).toFixed(2)} AFR` : `${ptB.lambda}λ`;
          telemCallouts.push({ y: fuelToY(ptB.lambda), text: `${pB}${fText}`, color: 'rgba(255, 170, 0, 0.85)' });
        }
        if (this.telemChannels.ignition && ptB.ignition !== null) {
          telemCallouts.push({ y: p.top + plotH - (ptB.ignition / 40) * plotH, text: `${pB}${ptB.ignition}°`, color: 'rgba(179, 136, 255, 0.85)' });
        }
        if (this.telemChannels.tps && ptB.tps !== null) {
          telemCallouts.push({ y: p.top + plotH - (ptB.tps / 100) * plotH, text: `${pB}${ptB.tps}%`, color: 'rgba(0, 229, 255, 0.85)' });
        }
      }

      this.renderTelemCallouts(cx, telemCallouts, w, p.right);
    }

    ctx.restore();
  }

  // Draw floating callout badges directly on curves (Upper Graph)
  renderCallouts(cx, callouts, canvasW, rightPadding) {
    if (callouts.length === 0) return;
    const ctx = this.dynoCtx;

    // Sort by y ascending and separate close collisions
    callouts.sort((a, b) => a.y - b.y);
    for (let i = 1; i < callouts.length; i++) {
      if (callouts[i].y - callouts[i - 1].y < 16) {
        callouts[i].y = callouts[i - 1].y + 16;
      }
    }

    const placeOnLeft = (cx + 80 > canvasW - rightPadding);

    callouts.forEach(c => {
      // Intersection dot
      ctx.beginPath();
      ctx.arc(cx, c.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = c.color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // In-line callout badge
      ctx.font = 'bold 10px monospace';
      const textW = ctx.measureText(c.text).width;
      const badgeW = textW + 10;
      const badgeH = 16;
      const bx = placeOnLeft ? (cx - badgeW - 8) : (cx + 8);
      const by = c.y - badgeH / 2;

      ctx.fillStyle = 'rgba(14, 20, 32, 0.94)';
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(bx, by, badgeW, badgeH, 3);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.text, bx + badgeW / 2, by + badgeH / 2);
    });
  }

  // Draw floating callout badges directly on curves (Lower Graph)
  renderTelemCallouts(cx, callouts, canvasW, rightPadding) {
    if (callouts.length === 0) return;
    const ctx = this.telemCtx;

    callouts.sort((a, b) => a.y - b.y);
    for (let i = 1; i < callouts.length; i++) {
      if (callouts[i].y - callouts[i - 1].y < 15) {
        callouts[i].y = callouts[i - 1].y + 15;
      }
    }

    const placeOnLeft = (cx + 70 > canvasW - rightPadding);

    callouts.forEach(c => {
      ctx.beginPath();
      ctx.arc(cx, c.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = c.color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = 'bold 9px monospace';
      const textW = ctx.measureText(c.text).width;
      const badgeW = textW + 8;
      const badgeH = 14;
      const bx = placeOnLeft ? (cx - badgeW - 7) : (cx + 7);
      const by = c.y - badgeH / 2;

      ctx.fillStyle = 'rgba(14, 20, 32, 0.94)';
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(bx, by, badgeW, badgeH, 3);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.text, bx + badgeW / 2, by + badgeH / 2);
    });
  }

  interpolatePoint(pts, targetRpm) {
    if (!pts || pts.length === 0) return null;
    let closest = pts[0];
    let minDiff = Math.abs(pts[0].rpm - targetRpm);
    for (let i = 1; i < pts.length; i++) {
      const diff = Math.abs(pts[i].rpm - targetRpm);
      if (diff < minDiff) {
        minDiff = diff;
        closest = pts[i];
      }
    }
    return closest;
  }

  exportDynoSheet(carProfile) {
    const expCanvas = document.createElement('canvas');
    expCanvas.width = 1920;
    expCanvas.height = 1080;
    const eCtx = expCanvas.getContext('2d');

    eCtx.fillStyle = '#0a0e17';
    eCtx.fillRect(0, 0, 1920, 1080);

    eCtx.fillStyle = '#121824';
    eCtx.fillRect(0, 0, 1920, 100);

    eCtx.fillStyle = '#00e5ff';
    eCtx.font = 'bold 30px system-ui, sans-serif';
    eCtx.fillText('NSP Dyno - Virtual Dyno & Telemetry Analysis', 50, 45);

    eCtx.fillStyle = '#8899a6';
    eCtx.font = '15px monospace';
    const dateStr = new Date().toLocaleString();
    let headerSubtitle = `Date: ${dateStr}`;
    if (this.runA?.carProfile) {
      const aWt = (this.runA.carProfile.weightLbs || 0) + (this.runA.carProfile.occupantWeightLbs || 0) + (this.runA.carProfile.extraWeightLbs || 0);
      headerSubtitle += ` | RUN A: ${this.runA.carProfile.name} [Gear ${this.runA.gear || 3} • ${aWt} lbs]`;
    }
    if (this.runB?.carProfile) {
      const bWt = (this.runB.carProfile.weightLbs || 0) + (this.runB.carProfile.occupantWeightLbs || 0) + (this.runB.carProfile.extraWeightLbs || 0);
      headerSubtitle += ` | RUN B: ${this.runB.carProfile.name} [Gear ${this.runB.gear || 4} • ${bWt} lbs]`;
    }
    eCtx.fillText(headerSubtitle, 50, 80);

    eCtx.drawImage(this.dynoCanvas, 50, 120, 1820, 580);
    eCtx.drawImage(this.telemCanvas, 50, 720, 1820, 260);

    eCtx.fillStyle = '#121824';
    eCtx.fillRect(0, 995, 1920, 85);

    if (this.runA?.dynoResult) {
      const peakBoostVal = this.runA.dynoResult.peakBoostPsi;
      const boostStr = peakBoostVal !== null && peakBoostVal !== undefined
        ? (this.boostUnit === 'kpa' ? `${(peakBoostVal * 6.89476).toFixed(1)} kPa` : `${peakBoostVal} psi`)
        : 'N/A';
      const avgLambdaVal = this.runA.dynoResult.avgLambda;
      const fuelStr = avgLambdaVal !== null && avgLambdaVal !== undefined
        ? (this.fuelUnit === 'afr' ? `${(avgLambdaVal * 14.7).toFixed(2)} AFR` : `${avgLambdaVal}λ`)
        : 'N/A';

      eCtx.fillStyle = '#00e5ff';
      eCtx.font = 'bold 18px system-ui';
      eCtx.fillText(`RUN A: ${this.runA.filename} ${this.runA.ethanol ? '[' + this.runA.ethanol + ']' : ''} -> Peak: ${this.runA.dynoResult.peakHp} WHP @ ${this.runA.dynoResult.peakHpRpm} RPM | ${this.runA.dynoResult.peakTorque} lb-ft | Boost: ${boostStr} | Fuel: ${fuelStr}`, 50, 1045);
    }

    if (this.runB?.dynoResult) {
      const peakBoostVal = this.runB.dynoResult.peakBoostPsi;
      const boostStr = peakBoostVal !== null && peakBoostVal !== undefined
        ? (this.boostUnit === 'kpa' ? `${(peakBoostVal * 6.89476).toFixed(1)} kPa` : `${peakBoostVal} psi`)
        : 'N/A';
      const avgLambdaVal = this.runB.dynoResult.avgLambda;
      const fuelStr = avgLambdaVal !== null && avgLambdaVal !== undefined
        ? (this.fuelUnit === 'afr' ? `${(avgLambdaVal * 14.7).toFixed(2)} AFR` : `${avgLambdaVal}λ`)
        : 'N/A';

      eCtx.fillStyle = '#ff9100';
      eCtx.font = 'bold 18px system-ui';
      eCtx.fillText(`RUN B: ${this.runB.filename} ${this.runB.ethanol ? '[' + this.runB.ethanol + ']' : ''} -> Peak: ${this.runB.dynoResult.peakHp} WHP @ ${this.runB.dynoResult.peakHpRpm} RPM | ${this.runB.dynoResult.peakTorque} lb-ft | Boost: ${boostStr} | Fuel: ${fuelStr}`, 980, 1045);
    }

    return expCanvas.toDataURL('image/png');
  }
}

window.DynoCanvas = DynoCanvas;
