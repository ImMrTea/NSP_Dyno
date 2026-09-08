/**
 * tachometer.js - Animated Tachometer & Shift Light Gauge
 * Styled to match DirtyHabit's real-time tachometer widget
 */

class Tachometer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.currentRpm = 0;
    this.targetRpm = 0;
    this.gear = 3;
    this.maxRpm = 9000;
    this.redlineRpm = 6800;
    this.boostPsi = 0;
    this.animId = null;

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.render();
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.size = Math.min(rect.width, rect.height) || 170;
    this.canvas.width = this.size * dpr;
    this.canvas.height = this.size * dpr;
    this.canvas.style.width = `${this.size}px`;
    this.canvas.style.height = `${this.size}px`;
    this.ctx.scale(dpr, dpr);
  }

  setRpm(rpm, gear = null, boostPsi = null) {
    this.targetRpm = Math.max(0, Math.min(this.maxRpm, rpm));
    if (gear !== null) this.gear = gear;
    if (boostPsi !== null) this.boostPsi = boostPsi;

    // Smooth interpolation
    this.currentRpm += (this.targetRpm - this.currentRpm) * 0.45;
    this.render();
  }

  render() {
    const ctx = this.ctx;
    const s = this.size;
    const cx = s / 2;
    const cy = s / 2;
    const r = (s / 2) - 8;

    ctx.clearRect(0, 0, s, s);

    // Gauge background
    const bgGrad = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
    bgGrad.addColorStop(0, '#1c2333');
    bgGrad.addColorStop(0.85, '#0e131d');
    bgGrad.addColorStop(1, '#05080e');

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = bgGrad;
    ctx.fill();

    // Outer bezel
    ctx.strokeStyle = '#2b384e';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Inner glow
    ctx.beginPath();
    ctx.arc(cx, cy, r - 3, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.15)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Sweep Angles: -220 deg to +40 deg
    const startAngle = Math.PI * 0.75; // ~135 deg (bottom left)
    const endAngle = Math.PI * 2.25;   // ~405 deg (bottom right)
    const totalSweep = endAngle - startAngle;

    // Redline arc
    const redlineFrac = (this.redlineRpm / this.maxRpm);
    const redlineStart = startAngle + totalSweep * redlineFrac;

    ctx.beginPath();
    ctx.arc(cx, cy, r - 12, redlineStart, endAngle);
    ctx.strokeStyle = '#ff3d71';
    ctx.lineWidth = 6;
    ctx.stroke();

    // Amber warning zone (6000 - 6800)
    const amberStart = startAngle + totalSweep * (6000 / this.maxRpm);
    ctx.beginPath();
    ctx.arc(cx, cy, r - 12, amberStart, redlineStart);
    ctx.strokeStyle = '#ffaa00';
    ctx.lineWidth = 6;
    ctx.stroke();

    // Active RPM sweep band
    const currentFrac = Math.max(0, Math.min(1, this.currentRpm / this.maxRpm));
    const currentAngle = startAngle + totalSweep * currentFrac;

    const activeGrad = ctx.createConicGradient(startAngle, cx, cy);
    activeGrad.addColorStop(0, '#00e5ff');
    activeGrad.addColorStop(0.7, '#ffaa00');
    activeGrad.addColorStop(0.9, '#ff3d71');

    ctx.beginPath();
    ctx.arc(cx, cy, r - 12, startAngle, currentAngle);
    ctx.strokeStyle = activeGrad;
    ctx.lineWidth = 6;
    ctx.stroke();

    // Tick marks & Numbers (0 to 9)
    for (let i = 0; i <= 9; i++) {
      const frac = i / 9;
      const angle = startAngle + totalSweep * frac;
      const isRedline = (i * 1000 >= this.redlineRpm);

      const x1 = cx + Math.cos(angle) * (r - 18);
      const y1 = cy + Math.sin(angle) * (r - 18);
      const x2 = cx + Math.cos(angle) * (r - 8);
      const y2 = cy + Math.sin(angle) * (r - 8);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = isRedline ? '#ff3d71' : (i * 1000 >= 6000 ? '#ffaa00' : '#8899a6');
      ctx.lineWidth = 2;
      ctx.stroke();

      // Number text
      const tx = cx + Math.cos(angle) * (r - 28);
      const ty = cy + Math.sin(angle) * (r - 28);

      ctx.fillStyle = isRedline ? '#ff3d71' : '#f0f4f8';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(i.toString(), tx, ty);
    }

    // Needle
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(currentAngle);

    // Needle glow
    ctx.shadowColor = this.currentRpm >= this.redlineRpm ? '#ff3d71' : '#00e5ff';
    ctx.shadowBlur = 10;

    // Needle blade
    ctx.beginPath();
    ctx.moveTo(-10, -2);
    ctx.lineTo(r - 16, 0);
    ctx.lineTo(-10, 2);
    ctx.closePath();
    ctx.fillStyle = this.currentRpm >= this.redlineRpm ? '#ff3d71' : '#ff9100';
    ctx.fill();

    ctx.restore();

    // Center Cap with Gear & Digital RPM
    ctx.beginPath();
    ctx.arc(cx, cy, 26, 0, Math.PI * 2);
    ctx.fillStyle = '#101726';
    ctx.fill();
    ctx.strokeStyle = '#2b384e';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Gear indicator
    ctx.fillStyle = '#00e5ff';
    ctx.font = '800 13px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`G${this.gear}`, cx, cy - 7);

    // Digital RPM
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 9px monospace';
    ctx.fillText(`${Math.round(this.currentRpm)}`, cx, cy + 9);
  }
}

window.Tachometer = Tachometer;
