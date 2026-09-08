/**
 * NSP Dyno - Local Server & API
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { parseLog } = require('./parser');
const { calculateDyno, DYNO_FACTORS } = require('./dynoMath');

const PORT = parseInt(process.env.PORT, 10) || 3300;
const DEFAULT_LOG_DIR = fs.existsSync('//192.168.5.2/media/downloads/MAPS/Haltech/logs')
  ? '//192.168.5.2/media/downloads/MAPS/Haltech/logs'
  : path.join(__dirname, '../logs');
const NETWORK_LOGS_DIR = process.env.LOGS_DIR || DEFAULT_LOG_DIR;
const CARS_FILE = process.env.CARS_FILE || path.join(__dirname, 'cars.json');

// Default car profiles pre-loaded with USDM 2004 STi
const DEFAULT_CARS = [
  {
    id: 'sti_04_usdm',
    name: '2004 Subaru WRX STi [USDM 6MT]',
    make: 'Subaru',
    model: 'STi Sedan',
    year: 2004,
    weightLbs: 3351,
    occupantWeightLbs: 170,
    tireDiameterInches: 24.97,
    finalDrive: 3.900,
    gears: {
      "1": 3.636,
      "2": 2.375,
      "3": 1.761,
      "4": 1.346,
      "5": 0.971,
      "6": 0.756
    },
    defaultGear: 3,
    dragCoefficient: 0.33,
    frontalAreaSqFt: 22.20,
    dynoType: 'dynojet',
    smoothing: 4
  }
];

// Initialize cars file if not exists
if (!fs.existsSync(CARS_FILE)) {
  fs.writeFileSync(CARS_FILE, JSON.stringify(DEFAULT_CARS, null, 2), 'utf8');
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 100 * 1024 * 1024) { // 100MB max
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve(body);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORS headers
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // --- API Endpoints ---
  
  // 1. List files on network share
  if (pathname === '/api/network-logs' && req.method === 'GET') {
    try {
      if (!fs.existsSync(NETWORK_LOGS_DIR)) {
        return sendJson(res, 200, { available: false, error: 'Network share path not found', files: [] });
      }
      const entries = fs.readdirSync(NETWORK_LOGS_DIR);
      const csvFiles = [];
      for (const name of entries) {
        if (name.toLowerCase().endsWith('.csv')) {
          try {
            const stats = fs.statSync(path.join(NETWORK_LOGS_DIR, name));
            csvFiles.push({
              name,
              size: stats.size,
              mtime: stats.mtime,
              gearHint: /3rd/i.test(name) ? 3 : (/4th/i.test(name) ? 4 : null)
            });
          } catch (e) {}
        }
      }
      // Sort newest first
      csvFiles.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
      return sendJson(res, 200, { available: true, path: NETWORK_LOGS_DIR, files: csvFiles });
    } catch (err) {
      return sendJson(res, 500, { available: false, error: err.message, files: [] });
    }
  }

  // 2. Load and parse a file from network share
  if (pathname === '/api/load-network-log' && req.method === 'GET') {
    const fileName = parsedUrl.query.file;
    if (!fileName) return sendJson(res, 400, { error: 'Missing file parameter' });

    const safeName = path.basename(fileName);
    const fullPath = path.join(NETWORK_LOGS_DIR, safeName);

    try {
      if (!fs.existsSync(fullPath)) {
        return sendJson(res, 404, { error: 'File not found on network share' });
      }
      const content = fs.readFileSync(fullPath, 'utf8');
      const parsed = parseLog(content, safeName);
      return sendJson(res, 200, parsed);
    } catch (err) {
      return sendJson(res, 500, { error: 'Failed to read log: ' + err.message });
    }
  }

  // 3. Parse uploaded or pasted log content
  if (pathname === '/api/parse-log' && req.method === 'POST') {
    try {
      const data = await parseBody(req);
      const content = typeof data === 'object' ? data.content : data;
      const filename = (typeof data === 'object' && data.filename) || 'uploaded_log.csv';
      const parsed = parseLog(content, filename);
      return sendJson(res, 200, parsed);
    } catch (err) {
      return sendJson(res, 500, { error: 'Parse failure: ' + err.message });
    }
  }

  // 4. Calculate Dyno Curve
  if (pathname === '/api/calculate-dyno' && req.method === 'POST') {
    try {
      const { pullData, carProfile } = await parseBody(req);
      if (!pullData || !carProfile) {
        return sendJson(res, 400, { error: 'Missing pullData or carProfile' });
      }
      const dynoResult = calculateDyno(pullData, carProfile);
      return sendJson(res, 200, dynoResult);
    } catch (err) {
      return sendJson(res, 500, { error: 'Dyno calculation failure: ' + err.message });
    }
  }

  // 5. Get Saved Car Profiles
  if (pathname === '/api/cars' && req.method === 'GET') {
    try {
      const raw = fs.readFileSync(CARS_FILE, 'utf8');
      return sendJson(res, 200, JSON.parse(raw));
    } catch (e) {
      return sendJson(res, 200, DEFAULT_CARS);
    }
  }

  // 6. Save or Update Car Profile
  if (pathname === '/api/save-car' && req.method === 'POST') {
    try {
      const car = await parseBody(req);
      let list = [];
      try {
        list = JSON.parse(fs.readFileSync(CARS_FILE, 'utf8'));
      } catch (e) {
        list = DEFAULT_CARS;
      }
      const idx = list.findIndex(c => c.id === car.id);
      if (idx >= 0) {
        list[idx] = car;
      } else {
        car.id = car.id || ('car_' + Date.now());
        list.push(car);
      }
      fs.writeFileSync(CARS_FILE, JSON.stringify(list, null, 2), 'utf8');
      return sendJson(res, 200, { success: true, cars: list, currentCar: car });
    } catch (err) {
      return sendJson(res, 500, { error: 'Failed to save car profile: ' + err.message });
    }
  }

  // 7. Delete Car Profile
  if (pathname === '/api/delete-car' && req.method === 'POST') {
    try {
      const { id } = await parseBody(req);
      let list = [];
      try {
        list = JSON.parse(fs.readFileSync(CARS_FILE, 'utf8'));
      } catch (e) {
        list = DEFAULT_CARS;
      }
      list = list.filter(c => c.id !== id);
      fs.writeFileSync(CARS_FILE, JSON.stringify(list, null, 2), 'utf8');
      return sendJson(res, 200, { success: true, cars: list });
    } catch (err) {
      return sendJson(res, 500, { error: 'Failed to delete car profile: ' + err.message });
    }
  }

  // --- Static Files Server ---
  let filePath = path.join(__dirname, '../public', pathname === '/' ? 'index.html' : pathname);
  
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(__dirname, '../public', 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`NSP Dyno server running at http://localhost:${PORT}`);
  console.log(`Network log directory: ${NETWORK_LOGS_DIR}`);
});
