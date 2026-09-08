# ⚡ NSP Dyno

**Lightweight Virtual Dyno & Telemetry Analysis Tool for Haltech ECU Datalogs (Nexus / NSP)**

NSP Dyno is a zero-friction, web-based virtual dyno and telemetry comparison tool built specifically for Haltech datalogs. It parses raw exported Haltech `.csv` files directly—no manual log trimming, no Excel editing, and no intermediate software required.

---

## 🏎️ Why NSP Dyno?

If you tune or analyze Haltech logs, the traditional virtual dyno workflow is tedious:
1. Open raw log in MegaLogViewer
2. Extract the pull data
3. Open CSV in Excel to delete top header metadata lines
4. Save and load into legacy Virtual Dyno software

**NSP Dyno eliminates all of that.** Just drag and drop your raw, unedited Haltech `.csv` log (designed for logs with 85%+ TPS) directly into your browser.

---

## ✨ Key Features

- **Direct Haltech CSV Parser**: Drag & drop raw Haltech NSP `.csv` exports. Automatically detects WOT pulls (85%+ TPS) and calculates Wheel Horsepower (WHP) and Torque (lb-ft).
- **Side-by-Side Pull Comparison**: Compare two pulls (Run A vs Run B) with live power deltas (`+15.2 WHP`, `+12.8 lb-ft`), curve overlays, and synchronized telemetry.
- **Live Hover Callouts**: Move your cursor across the graph to inspect instant inline readout badges for HP, torque, boost, lambda, ignition timing, and throttle position.
- **Custom Vehicle Profiles**: Save profiles for curb weight, occupant weight, gear ratios, tire dimensions, final drive ratio, and aerodynamic drag.
- **High-Res Export**: One-click **Print Screen** button generates clean, high-resolution PNG dyno sheets with vehicle parameters and peak stats.
- **Flexible Access**: Run it locally on your tuning laptop or host it on a home server (TrueNAS, Unraid, Docker) to access it from any browser on your network.

---

## 🚀 Quick Start Guide

### Option 1: Docker & Docker Compose (Self-Hosted / Home Server)

Ideal for TrueNAS, Unraid, Synology, or any Docker host:

```yaml
services:
  nspdyno:
    build: .
    container_name: nspdyno
    restart: unless-stopped
    ports:
      - "3300:3300"
    volumes:
      - ./data:/app/data
    environment:
      - PORT=3300
```

**Run with Docker Compose:**
```bash
docker compose up -d
```
Access the web app in your browser at `http://<your-server-ip>:3300`.

---

### Option 2: Local Run (Windows / Mac / Linux)

Ideal for standalone tuning laptops:

1. **Prerequisites**: Install [Node.js](https://nodejs.org/) (v18 or newer).
2. **Download / Clone** this repository.
3. **Start the app**:
   - **Windows**: Double-click `start.bat`
   - **Terminal (Mac / Linux / Windows)**: Run `npm start`
4. Open your browser to `http://localhost:3300`.

---

## 🛠️ How to Use

1. Export your log from **Haltech NSP** as a `.csv` file.
2. Drag and drop the `.csv` file anywhere onto the NSP Dyno webpage (or click **📂 Drop / Open CSV**).
3. Select your vehicle profile and transmission gear.
4. Move your mouse across the graph to inspect live horsepower, torque, boost, and AFR callouts!

