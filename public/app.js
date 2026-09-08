/**
 * app.js - Main NSP Dyno Controller
 */

document.addEventListener('DOMContentLoaded', () => {
  let tachometer = new Tachometer('tachometerCanvas');

  function onGraphRpmChange(rpm) {
    const activePoints = runA?.dynoResult?.curvePoints || runB?.dynoResult?.curvePoints;
    const activeGear = runA?.gear || runB?.gear || 3;
    if (activePoints && activePoints.length > 1) {
      const pt = activePoints.find(p => p.rpm >= rpm) || activePoints[activePoints.length - 1];
      tachometer.setRpm(rpm, activeGear, pt?.boostPsi);
    } else {
      tachometer.setRpm(rpm, activeGear);
    }
  }

  let dynoCanvas = new DynoCanvas('dynoCanvas', 'telemCanvas', onGraphRpmChange);

  // App State
  let loadedLogs = [];
  let availableCars = [];
  let runA = null;
  let runB = null;

  let runASettings = {
    carId: 'sti_04_usdm',
    gear: 3,
    extraWeightLbs: 0
  };

  let runBSettings = {
    carId: 'sti_04_usdm',
    gear: 4,
    extraWeightLbs: 0
  };

  let globalDynoType = 'dynojet';
  let globalSmoothing = 4;

  let isPlaying = false;
  let playbackSpeed = 1;
  let playbackIndex = 0;
  let playbackTimer = null;

  // DOM Elements - Run Cards
  const comparisonContainer = document.getElementById('comparisonContainer');
  const runBCard = document.getElementById('runBCard');
  const warningBanner = document.getElementById('warningBanner');
  const warningText = document.getElementById('warningText');
  const warningDismiss = document.getElementById('warningDismiss');

  // Run A Elements
  const runASelect = document.getElementById('runASelect');
  const runACloseBtn = document.getElementById('runACloseBtn');
  const runARemoveBtn = document.getElementById('runARemoveBtn');
  const runACarSelect = document.getElementById('runACarSelect');
  const runAGearSelect = document.getElementById('runAGearSelect');
  const runAExtraWeight = document.getElementById('runAExtraWeight');
  const runAEthanol = document.getElementById('runAEthanol');
  const runANotes = document.getElementById('runANotes');

  const runAHp = document.getElementById('runAHp');
  const runATq = document.getElementById('runATq');
  const runABoost = document.getElementById('runABoost');
  const runALambda = document.getElementById('runALambda');

  // Run B Elements
  const runBSelect = document.getElementById('runBSelect');
  const runBCloseBtn = document.getElementById('runBCloseBtn');
  const runBRemoveBtn = document.getElementById('runBRemoveBtn');
  const runBCarSelect = document.getElementById('runBCarSelect');
  const runBGearSelect = document.getElementById('runBGearSelect');
  const runBExtraWeight = document.getElementById('runBExtraWeight');
  const runBEthanol = document.getElementById('runBEthanol');
  const runBNotes = document.getElementById('runBNotes');

  const runBHp = document.getElementById('runBHp');
  const runBTq = document.getElementById('runBTq');
  const runBBoost = document.getElementById('runBBoost');
  const runBLambda = document.getElementById('runBLambda');

  const deltaHp = document.getElementById('deltaHp');
  const deltaTq = document.getElementById('deltaTq');

  // Top Bar Controls
  const dynoTypeSelect = document.getElementById('dynoTypeSelect');
  const smoothingSlider = document.getElementById('smoothingSlider');
  const smoothingVal = document.getElementById('smoothingVal');

  // Splitter Elements
  const upperWrapper = document.getElementById('upperWrapper');
  const lowerWrapper = document.getElementById('lowerWrapper');
  const splitDivider = document.getElementById('splitDivider');
  const splitGraphsContainer = document.getElementById('splitGraphsContainer');

  const preset7030 = document.getElementById('preset7030');
  const preset5050 = document.getElementById('preset5050');
  const presetMaxDyno = document.getElementById('presetMaxDyno');

  // Network Share Modal Elements
  const networkModal = document.getElementById('networkModal');
  const openNetworkBtn = document.getElementById('openNetworkBtn');
  const closeNetworkBtn = document.getElementById('closeNetworkBtn');
  const networkFileList = document.getElementById('networkFileList');
  const networkSearchInput = document.getElementById('networkSearchInput');
  let networkFiles = [];

  // Car Profile Modal Elements
  const carProfileModal = document.getElementById('carProfileModal');
  const openCarBtn = document.getElementById('openCarBtn');
  const closeCarBtn = document.getElementById('closeCarBtn');
  const saveCarBtn = document.getElementById('saveCarBtn');
  const deleteCarBtn = document.getElementById('deleteCarBtn');
  const newCarBtn = document.getElementById('newCarBtn');
  const carModalProfileSelect = document.getElementById('carModalProfileSelect');

  // Print Screen Button
  const printScreenBtn = document.getElementById('printScreenBtn');
  const fileInput = document.getElementById('fileInput');
  const dropzoneOverlay = document.getElementById('dropzoneOverlay');

  // --- Resizable Graph Divider Logic ---
  let isResizing = false;

  splitDivider.addEventListener('mousedown', (e) => {
    isResizing = true;
    splitDivider.classList.add('dragging');
    document.body.style.cursor = 'row-resize';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const containerRect = splitGraphsContainer.getBoundingClientRect();
    const offsetY = e.clientY - containerRect.top;
    const totalH = containerRect.height;
    
    // Bounds: minimum 100px for each
    const clampedY = Math.max(120, Math.min(totalH - 100, offsetY));
    const upperRatio = clampedY / totalH;
    const lowerRatio = 1 - upperRatio;

    upperWrapper.style.flex = upperRatio * 10;
    lowerWrapper.style.flex = lowerRatio * 10;
    lowerWrapper.style.display = 'block';

    document.querySelectorAll('.split-presets .channel-btn').forEach(b => b.classList.remove('active'));
    dynoCanvas.resize();
  });

  window.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      splitDivider.classList.remove('dragging');
      document.body.style.cursor = '';
      dynoCanvas.resize();
    }
  });

  // Size Presets
  preset7030.addEventListener('click', () => {
    document.querySelectorAll('.split-presets .channel-btn').forEach(b => b.classList.remove('active'));
    preset7030.classList.add('active');
    upperWrapper.style.flex = 7;
    lowerWrapper.style.flex = 3;
    lowerWrapper.style.display = 'block';
    splitDivider.style.display = 'flex';
    dynoCanvas.resize();
  });

  preset5050.addEventListener('click', () => {
    document.querySelectorAll('.split-presets .channel-btn').forEach(b => b.classList.remove('active'));
    preset5050.classList.add('active');
    upperWrapper.style.flex = 5;
    lowerWrapper.style.flex = 5;
    lowerWrapper.style.display = 'block';
    splitDivider.style.display = 'flex';
    dynoCanvas.resize();
  });

  presetMaxDyno.addEventListener('click', () => {
    document.querySelectorAll('.split-presets .channel-btn').forEach(b => b.classList.remove('active'));
    presetMaxDyno.classList.add('active');
    upperWrapper.style.flex = 10;
    lowerWrapper.style.display = 'none';
    splitDivider.style.display = 'none';
    dynoCanvas.resize();
  });

  // Load Car Profiles from Backend
  function loadCars(selectIdToActivate = null) {
    return fetch('/api/cars')
      .then(r => r.json())
      .then(cars => {
        if (cars && cars.length > 0) {
          availableCars = cars;
          if (!runASettings.carId || !availableCars.some(c => c.id === runASettings.carId)) {
            runASettings.carId = availableCars[0].id;
          }
          if (!runBSettings.carId || !availableCars.some(c => c.id === runBSettings.carId)) {
            runBSettings.carId = availableCars[0].id;
          }
          populateCarSelects(selectIdToActivate);
        }
      })
      .catch(console.error);
  }

  function populateCarSelects(activeModalId = null) {
    [runACarSelect, runBCarSelect, carModalProfileSelect].forEach(sel => {
      const prevVal = sel.value;
      sel.innerHTML = '';
      availableCars.forEach(car => {
        const opt = document.createElement('option');
        opt.value = car.id;
        opt.textContent = car.name || car.id;
        sel.appendChild(opt);
      });
      if (prevVal && availableCars.some(c => c.id === prevVal)) {
        sel.value = prevVal;
      }
    });

    if (runASettings.carId) runACarSelect.value = runASettings.carId;
    if (runBSettings.carId) runBCarSelect.value = runBSettings.carId;

    if (activeModalId && availableCars.some(c => c.id === activeModalId)) {
      carModalProfileSelect.value = activeModalId;
    } else if (availableCars.length > 0) {
      carModalProfileSelect.value = availableCars[0].id;
    }

    populateGearSelect(runAGearSelect, runASettings.carId, runASettings.gear);
    populateGearSelect(runBGearSelect, runBSettings.carId, runBSettings.gear);
  }

  function populateGearSelect(selectElem, carId, selectedGear) {
    const car = availableCars.find(c => c.id === carId) || availableCars[0];
    selectElem.innerHTML = '';
    if (car && car.gears && Object.keys(car.gears).length > 0) {
      Object.keys(car.gears).sort((a, b) => Number(a) - Number(b)).forEach(gNum => {
        const ratio = car.gears[gNum];
        const ord = gNum === '1' ? '1st' : gNum === '2' ? '2nd' : gNum === '3' ? '3rd' : `${gNum}th`;
        const opt = document.createElement('option');
        opt.value = gNum;
        opt.textContent = `${ord} (${ratio})`;
        selectElem.appendChild(opt);
      });
    } else {
      selectElem.innerHTML = `
        <option value="3">3rd (1.761)</option>
        <option value="4">4th (1.346)</option>
      `;
    }

    if (selectedGear && selectElem.querySelector(`option[value="${selectedGear}"]`)) {
      selectElem.value = String(selectedGear);
    } else if (selectElem.options.length > 0) {
      selectElem.selectedIndex = 0;
    }
  }

  function getRunProfile(target) {
    const settings = target === 'A' ? runASettings : runBSettings;
    const car = availableCars.find(c => c.id === settings.carId) || availableCars[0] || {
      id: 'sti_04_usdm',
      name: '2004 Subaru WRX STi [USDM 6MT]',
      weightLbs: 3351,
      occupantWeightLbs: 170,
      tireDiameterInches: 24.97,
      finalDrive: 3.900,
      gears: { "3": 1.761, "4": 1.346 },
      dragCoefficient: 0.33,
      frontalAreaSqFt: 22.20
    };

    const gearStr = String(settings.gear);
    let gearRatio = 1.761;
    if (car.gears && car.gears[gearStr]) {
      gearRatio = parseFloat(car.gears[gearStr]);
    } else if (settings.gear === 4) {
      gearRatio = 1.346;
    }

    return {
      ...car,
      gear: settings.gear,
      gearRatio: gearRatio,
      extraWeightLbs: settings.extraWeightLbs || 0,
      dynoType: globalDynoType,
      smoothing: globalSmoothing
    };
  }

  // Upper Dyno Channel Toggles
  document.querySelectorAll('.channel-btn[data-group="dyno"]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.channel-btn[data-group="dyno"]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const ch = btn.dataset.channel;
      if (ch === 'dyno_both') dynoCanvas.setDynoMode('both');
      else if (ch === 'torque_only') dynoCanvas.setDynoMode('torque_only');
      else if (ch === 'power_only') dynoCanvas.setDynoMode('power_only');
    });
  });

  // Lower Telemetry Channel Toggles
  document.querySelectorAll('.channel-btn[data-telem]').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      const ch = btn.dataset.telem;
      dynoCanvas.toggleTelemChannel(ch, btn.classList.contains('active'));
    });
  });

  // Top Bar Listeners
  dynoTypeSelect.addEventListener('change', () => {
    globalDynoType = dynoTypeSelect.value;
    recalculateAllRuns();
  });

  smoothingSlider.addEventListener('input', () => {
    globalSmoothing = parseInt(smoothingSlider.value, 10);
    smoothingVal.textContent = globalSmoothing;
    recalculateAllRuns();
  });

  // Run A Parameter Listeners
  runACarSelect.addEventListener('change', () => {
    runASettings.carId = runACarSelect.value;
    populateGearSelect(runAGearSelect, runASettings.carId, runASettings.gear);
    runASettings.gear = parseInt(runAGearSelect.value, 10) || 3;
    if (runA) recalculateRun('A');
  });

  runAGearSelect.addEventListener('change', () => {
    runASettings.gear = parseInt(runAGearSelect.value, 10) || 3;
    if (runA) recalculateRun('A');
  });

  runAExtraWeight.addEventListener('input', () => {
    runASettings.extraWeightLbs = parseFloat(runAExtraWeight.value) || 0;
    if (runA) recalculateRun('A');
  });

  // Run B Parameter Listeners
  runBCarSelect.addEventListener('change', () => {
    runBSettings.carId = runBCarSelect.value;
    populateGearSelect(runBGearSelect, runBSettings.carId, runBSettings.gear);
    runBSettings.gear = parseInt(runBGearSelect.value, 10) || 4;
    if (runB) recalculateRun('B');
  });

  runBGearSelect.addEventListener('change', () => {
    runBSettings.gear = parseInt(runBGearSelect.value, 10) || 4;
    if (runB) recalculateRun('B');
  });

  runBExtraWeight.addEventListener('input', () => {
    runBSettings.extraWeightLbs = parseFloat(runBExtraWeight.value) || 0;
    if (runB) recalculateRun('B');
  });

  // Ethanol & Notes Inputs
  runAEthanol.addEventListener('input', () => {
    if (runA) runA.ethanol = runAEthanol.value;
    dynoCanvas.setRuns(runA, runB);
  });
  runBEthanol.addEventListener('input', () => {
    if (runB) runB.ethanol = runBEthanol.value;
    dynoCanvas.setRuns(runA, runB);
  });
  runANotes.addEventListener('input', () => {
    if (runA) runA.notes = runANotes.value;
  });
  runBNotes.addEventListener('input', () => {
    if (runB) runB.notes = runBNotes.value;
  });

  function detectGearFromPull(pull, filename) {
    if (pull && pull.gear) return parseInt(pull.gear, 10);
    if (filename) {
      if (/4th/i.test(filename)) return 4;
      if (/3rd/i.test(filename)) return 3;
      if (/2nd/i.test(filename)) return 2;
      if (/5th/i.test(filename)) return 5;
    }
    return null;
  }

  // Run Dropdown Selection & Removal Handlers
  runASelect.addEventListener('change', () => {
    const val = runASelect.value;
    if (!val) {
      clearRun('A');
    } else if (val === '__remove__') {
      removeSelectedLog('A');
    } else {
      const [logIdx, pullIdx] = val.split(':').map(Number);
      const log = loadedLogs[logIdx];
      if (!log) return;
      const pull = log.pulls[pullIdx] || log.pulls[0];

      const detected = detectGearFromPull(pull, log.filename);
      if (detected) {
        runASettings.gear = detected;
        populateGearSelect(runAGearSelect, runASettings.carId, detected);
      }

      runA = {
        log: log,
        pullIndex: pullIdx,
        filename: log.filename,
        ethanol: runAEthanol.value || 'E85',
        notes: runANotes.value
      };
      recalculateRun('A');
    }
  });

  runBSelect.addEventListener('change', () => {
    const val = runBSelect.value;
    if (!val) {
      clearRun('B');
    } else if (val === '__remove__') {
      removeSelectedLog('B');
    } else {
      comparisonContainer.classList.remove('single-mode');
      runBCard.classList.remove('inactive');
      const [logIdx, pullIdx] = val.split(':').map(Number);
      const log = loadedLogs[logIdx];
      if (!log) return;
      const pull = log.pulls[pullIdx] || log.pulls[0];

      const detected = detectGearFromPull(pull, log.filename);
      if (detected) {
        runBSettings.gear = detected;
        populateGearSelect(runBGearSelect, runBSettings.carId, detected);
      }

      runB = {
        log: log,
        pullIndex: pullIdx,
        filename: log.filename,
        ethanol: runBEthanol.value,
        notes: runBNotes.value
      };
      recalculateRun('B');
    }
  });

  // Run Close / Remove Buttons
  runACloseBtn.addEventListener('click', () => clearRun('A'));
  runBCloseBtn.addEventListener('click', () => clearRun('B'));
  runARemoveBtn.addEventListener('click', () => removeSelectedLog('A'));
  runBRemoveBtn.addEventListener('click', () => removeSelectedLog('B'));

  function clearRun(target) {
    if (target === 'A') {
      runA = null;
      runASelect.value = '';
      updateRunDisplay('A', null);
      dynoCanvas.setRuns(null, runB);
      updateDeltas();
    } else {
      runB = null;
      runBSelect.value = '';
      comparisonContainer.classList.add('single-mode');
      runBCard.classList.add('inactive');
      updateRunDisplay('B', null);
      dynoCanvas.setRuns(runA, null);
      updateDeltas();
    }
  }

  function removeSelectedLog(target) {
    const selectElem = target === 'A' ? runASelect : runBSelect;
    const val = selectElem.value;
    if (!val || val === '__remove__') {
      alert('Please select a run first in order to remove it.');
      return;
    }
    const [logIdx] = val.split(':').map(Number);
    const removedLog = loadedLogs[logIdx];
    if (!removedLog) return;

    if (runA && runA.log === removedLog) clearRun('A');
    if (runB && runB.log === removedLog) clearRun('B');

    loadedLogs.splice(logIdx, 1);
    populateRunDropdowns();

    // Re-sync any remaining runs to their updated logIdx
    if (runA && runA.log) {
      const newIdx = loadedLogs.indexOf(runA.log);
      if (newIdx >= 0) runASelect.value = `${newIdx}:${runA.pullIndex}`;
    }
    if (runB && runB.log) {
      const newIdx = loadedLogs.indexOf(runB.log);
      if (newIdx >= 0) runBSelect.value = `${newIdx}:${runB.pullIndex}`;
    }
  }

  function calcSingleRun(runObj, target) {
    if (!runObj || !runObj.log) return Promise.resolve(null);
    const pull = runObj.log.pulls[runObj.pullIndex] || runObj.log.pulls[0];
    if (!pull) return Promise.resolve(null);

    const profile = getRunProfile(target);
    runObj.carProfile = profile;
    runObj.gear = profile.gear;

    return fetch('/api/calculate-dyno', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pullData: pull.data,
        carProfile: profile
      })
    }).then(r => r.json());
  }

  function recalculateRun(target) {
    if (target === 'A') {
      if (!runA) return Promise.resolve();
      return calcSingleRun(runA, 'A').then(res => {
        runA.dynoResult = res;
        updateRunDisplay('A', runA);
        dynoCanvas.setRuns(runA, runB);
        updateDeltas();
      });
    } else {
      if (!runB) return Promise.resolve();
      return calcSingleRun(runB, 'B').then(res => {
        runB.dynoResult = res;
        updateRunDisplay('B', runB);
        dynoCanvas.setRuns(runA, runB);
        updateDeltas();
      });
    }
  }

  function recalculateAllRuns() {
    const promises = [];
    if (runA) promises.push(recalculateRun('A'));
    if (runB) promises.push(recalculateRun('B'));
    return Promise.all(promises);
  }

  function updateRunDisplay(target, runObj) {
    const dyno = runObj?.dynoResult;
    if (target === 'A') {
      runAHp.textContent = dyno ? `${dyno.peakHp}` : '--';
      runATq.textContent = dyno ? `${dyno.peakTorque}` : '--';
      runABoost.textContent = dyno && dyno.peakBoostPsi ? `${dyno.peakBoostPsi}` : '--';
      runALambda.textContent = dyno && dyno.avgLambda ? `${dyno.avgLambda}` : '--';
    } else {
      runBHp.textContent = dyno ? `${dyno.peakHp}` : '--';
      runBTq.textContent = dyno ? `${dyno.peakTorque}` : '--';
      runBBoost.textContent = dyno && dyno.peakBoostPsi ? `${dyno.peakBoostPsi}` : '--';
      runBLambda.textContent = dyno && dyno.avgLambda ? `${dyno.avgLambda}` : '--';
    }
  }

  function updateDeltas() {
    if (runA?.dynoResult && runB?.dynoResult) {
      const dHp = Math.round((runA.dynoResult.peakHp - runB.dynoResult.peakHp) * 10) / 10;
      const dTq = Math.round((runA.dynoResult.peakTorque - runB.dynoResult.peakTorque) * 10) / 10;

      deltaHp.textContent = `${dHp >= 0 ? '+' : ''}${dHp} WHP`;
      deltaHp.className = `delta-val ${dHp >= 0 ? 'pos' : 'neg'}`;

      deltaTq.textContent = `${dTq >= 0 ? '+' : ''}${dTq} lb-ft`;
      deltaTq.className = `delta-val ${dTq >= 0 ? 'pos' : 'neg'}`;
    } else {
      deltaHp.textContent = '--';
      deltaTq.textContent = '--';
    }
  }

  function populateRunDropdowns() {
    runASelect.innerHTML = '<option value="">Select Run A...</option>';
    runBSelect.innerHTML = '<option value="">None (Single Run)</option>';

    loadedLogs.forEach((log, logIdx) => {
      log.pulls.forEach((p, pullIdx) => {
        const text = `${log.filename} (Pull ${p.pullIndex}: Gear ${p.gear}, ${p.startRpm}-${p.endRpm} RPM)`;
        const optA = document.createElement('option');
        optA.value = `${logIdx}:${pullIdx}`;
        optA.textContent = text;
        runASelect.appendChild(optA);

        const optB = document.createElement('option');
        optB.value = `${logIdx}:${pullIdx}`;
        optB.textContent = text;
        runBSelect.appendChild(optB);
      });
    });

    if (loadedLogs.length > 0) {
      const remA = document.createElement('option');
      remA.value = '__remove__';
      remA.textContent = '🗑️ Remove selected run from list...';
      runASelect.appendChild(remA);

      const remB = document.createElement('option');
      remB.value = '__remove__';
      remB.textContent = '🗑️ Remove selected run from list...';
      runBSelect.appendChild(remB);
    }
  }

  function ingestParsedLog(parsed, autoSelect = true) {
    if (parsed.error) {
      alert('Error parsing log: ' + parsed.error);
      return;
    }

    if (parsed.warning) {
      warningText.textContent = parsed.warning;
      warningBanner.classList.remove('hidden');
    } else {
      warningBanner.classList.add('hidden');
    }

    if (parsed.pulls.length === 0) return;

    const logIdx = loadedLogs.length;
    loadedLogs.push(parsed);
    populateRunDropdowns();

    if (autoSelect) {
      if (!runA) {
        runASelect.value = `${logIdx}:0`;
        runASelect.dispatchEvent(new Event('change'));
      } else if (!runB) {
        runBSelect.value = `${logIdx}:0`;
        runBSelect.dispatchEvent(new Event('change'));
      }
    }
  }

  warningDismiss.addEventListener('click', () => warningBanner.classList.add('hidden'));

  warningDismiss.addEventListener('click', () => warningBanner.classList.add('hidden'));

  // Robust Drag & Drop Handling
  let dragCounter = 0;

  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    dropzoneOverlay.classList.remove('hidden');
  });

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dropzoneOverlay.classList.add('hidden');
    }
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropzoneOverlay.classList.add('hidden');

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      for (const file of files) {
        if (file.name.toLowerCase().endsWith('.csv')) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            fetch('/api/parse-log', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: evt.target.result, filename: file.name })
            })
            .then(r => r.json())
            .then(parsed => ingestParsedLog(parsed, true))
            .catch(err => alert('Upload error: ' + err.message));
          };
          reader.readAsText(file);
        }
      }
    }
  });

  document.getElementById('fileUploadBtn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      const file = fileInput.files[0];
      const reader = new FileReader();
      reader.onload = (evt) => {
        fetch('/api/parse-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: evt.target.result, filename: file.name })
        })
        .then(r => r.json())
        .then(parsed => ingestParsedLog(parsed, true))
        .catch(err => alert('Upload error: ' + err.message));
      };
      reader.readAsText(file);
    }
  });

  // Print Screen
  printScreenBtn.addEventListener('click', () => {
    const dataUrl = dynoCanvas.exportDynoSheet();
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    link.download = `NSP_Dyno_Sheet_${timestamp}.png`;
    link.href = dataUrl;
    link.click();
  });

  // Car Profile Modal Management
  function loadCarIntoModal(car) {
    if (!car) return;
    document.getElementById('carNameInput').value = car.name || '';
    document.getElementById('carWeightInput').value = car.weightLbs || 3351;
    document.getElementById('occupantWeightInput').value = car.occupantWeightLbs !== undefined ? car.occupantWeightLbs : 170;
    document.getElementById('finalDriveInput').value = car.finalDrive || 3.900;
    document.getElementById('cdInput').value = car.dragCoefficient || 0.33;
    document.getElementById('frontalAreaInput').value = car.frontalAreaSqFt || 22.20;
    document.getElementById('tireHeightInput').value = car.tireDiameterInches || 24.97;

    const g = car.gears || {};
    document.getElementById('gear1Input').value = g['1'] || 3.636;
    document.getElementById('gear2Input').value = g['2'] || 2.375;
    document.getElementById('gear3Input').value = g['3'] || 1.761;
    document.getElementById('gear4Input').value = g['4'] || 1.346;
    document.getElementById('gear5Input').value = g['5'] || 0.971;
    document.getElementById('gear6Input').value = g['6'] || 0.756;
  }

  openCarBtn.addEventListener('click', () => {
    carProfileModal.classList.add('active');
    populateCarSelects(runASettings.carId);
    const selCar = availableCars.find(c => c.id === carModalProfileSelect.value) || availableCars[0];
    loadCarIntoModal(selCar);
  });

  carModalProfileSelect.addEventListener('change', () => {
    const selCar = availableCars.find(c => c.id === carModalProfileSelect.value);
    loadCarIntoModal(selCar);
  });

  newCarBtn.addEventListener('click', () => {
    document.getElementById('carNameInput').value = 'New Custom Vehicle';
    document.getElementById('carWeightInput').value = 3300;
    document.getElementById('occupantWeightInput').value = 170;
    document.getElementById('finalDriveInput').value = 3.900;
    document.getElementById('cdInput').value = 0.33;
    document.getElementById('frontalAreaInput').value = 22.00;
    document.getElementById('tireHeightInput').value = 25.00;
    document.getElementById('gear1Input').value = 3.636;
    document.getElementById('gear2Input').value = 2.375;
    document.getElementById('gear3Input').value = 1.761;
    document.getElementById('gear4Input').value = 1.346;
    document.getElementById('gear5Input').value = 0.971;
    document.getElementById('gear6Input').value = 0.756;
    carModalProfileSelect.value = '';
  });

  closeCarBtn.addEventListener('click', () => carProfileModal.classList.remove('active'));

  saveCarBtn.addEventListener('click', () => {
    const activeId = carModalProfileSelect.value || ('car_' + Date.now());
    const updatedCar = {
      id: activeId,
      name: document.getElementById('carNameInput').value.trim() || 'Custom Vehicle',
      weightLbs: parseFloat(document.getElementById('carWeightInput').value) || 3351,
      occupantWeightLbs: parseFloat(document.getElementById('occupantWeightInput').value) || 170,
      finalDrive: parseFloat(document.getElementById('finalDriveInput').value) || 3.900,
      dragCoefficient: parseFloat(document.getElementById('cdInput').value) || 0.33,
      frontalAreaSqFt: parseFloat(document.getElementById('frontalAreaInput').value) || 22.20,
      tireDiameterInches: parseFloat(document.getElementById('tireHeightInput').value) || 24.97,
      gears: {
        "1": parseFloat(document.getElementById('gear1Input').value) || 3.636,
        "2": parseFloat(document.getElementById('gear2Input').value) || 2.375,
        "3": parseFloat(document.getElementById('gear3Input').value) || 1.761,
        "4": parseFloat(document.getElementById('gear4Input').value) || 1.346,
        "5": parseFloat(document.getElementById('gear5Input').value) || 0.971,
        "6": parseFloat(document.getElementById('gear6Input').value) || 0.756
      }
    };

    fetch('/api/save-car', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedCar)
    })
    .then(r => r.json())
    .then(() => loadCars(updatedCar.id))
    .then(() => {
      carProfileModal.classList.remove('active');
      recalculateAllRuns();
    })
    .catch(err => alert('Failed to save profile: ' + err.message));
  });

  deleteCarBtn.addEventListener('click', () => {
    const activeId = carModalProfileSelect.value;
    if (!activeId) return;
    if (availableCars.length <= 1) {
      alert('Cannot delete the only remaining vehicle profile.');
      return;
    }
    if (!confirm('Are you sure you want to delete this vehicle profile?')) return;

    fetch('/api/delete-car', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: activeId })
    })
    .then(r => r.json())
    .then(() => loadCars())
    .then(() => {
      const first = availableCars[0];
      loadCarIntoModal(first);
      recalculateAllRuns();
    })
    .catch(err => alert('Failed to delete profile: ' + err.message));
  });

  document.getElementById('calcTireBtn').addEventListener('click', () => {
    const w = parseFloat(document.getElementById('tireWidth').value) || 225;
    const a = parseFloat(document.getElementById('tireAspect').value) || 45;
    const r = parseFloat(document.getElementById('tireRim').value) || 17;
    const dia = (2 * (w * a / 100)) / 25.4 + r;
    document.getElementById('tireHeightInput').value = Math.round(dia * 100) / 100;
  });

  // Initial Load: Cars first, then auto-load latest network log
  loadCars().then(() => {
    fetch('/api/network-logs')
      .then(r => r.json())
      .then(data => {
        if (data.available && data.files.length > 0) {
          const thirdPull = data.files.find(f => /3rd/i.test(f.name)) || data.files[0];
          if (thirdPull) {
            fetch(`/api/load-network-log?file=${encodeURIComponent(thirdPull.name)}`)
              .then(r => r.json())
              .then(parsed => {
                ingestParsedLog(parsed, true);
                runAEthanol.value = 'E85';
                runANotes.value = 'Rotated Arashi 21psi';
                if (runA) {
                  runA.ethanol = 'E85';
                  runA.notes = 'Rotated Arashi 21psi';
                }
              })
              .catch(console.error);
          }
        }
      })
      .catch(console.error);
  });
});
