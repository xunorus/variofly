/* ============================================================
   VARIO PWA — Vanilla JS
   • Barometer (DeviceMotion / AmbientPressure API)
   • Audio engine (Web Audio API — variometer beeps)
   • Ethers v6 autocustody — encrypts/decrypts flight log
   ============================================================ */

"use strict";

// ─── STATE ───────────────────────────────────────────────────
const state = {
  running: false,
  muted: false,
  volume: 0.7,
  pressure: null,          // hPa
  pressurePrev: null,
  altitude: null,
  altitudePrev: null,
  temperature: null,
  vario: 0,                // m/s
  varioSmooth: 0,
  flightLog: [],           // { t, alt, vario, pres }
  wallet: null,            // ethers.Wallet
  walletAddress: null,
  sensorType: null,        // 'barometer' | 'pressure' | 'sim'
};

// ─── CONSTANTS ───────────────────────────────────────────────
const SEA_PRESSURE   = 1013.25;   // hPa
const LAPSE_RATE     = 0.0065;    // K/m
const T0             = 288.15;    // K
const G              = 9.80665;
const R              = 287.05;
const SMOOTH_FACTOR  = 0.25;      // IIR low-pass
const LOG_INTERVAL   = 2000;      // ms
const STORAGE_KEY    = 'vario_enc_flight';
const WALLET_KEY     = 'vario_wallet_enc';

// ─── DOM refs ────────────────────────────────────────────────
const appEl       = document.getElementById('app');
const statusDot   = document.getElementById('status-dot');
const statusTxt   = document.getElementById('status-txt');
const baroRawEl   = document.getElementById('baro-raw');
const vmsValue    = document.getElementById('vms-value');
const arrow       = document.getElementById('arrow');
const altVal      = document.getElementById('alt-val');
const presVal     = document.getElementById('pres-val');
const tempVal     = document.getElementById('temp-val');
const arcFill     = document.getElementById('arc-fill');
const needle      = document.getElementById('gauge-needle');
const pulse       = document.getElementById('pulse');
const startBtn    = document.getElementById('start-btn');
const muteBtn     = document.getElementById('mute-btn');
const walletBtn   = document.getElementById('wallet-btn');
const volSlider   = document.getElementById('vol-slider');
const volVal      = document.getElementById('vol-val');

// wallet sheet
const walletOverlay   = document.getElementById('wallet-overlay');
const walletInfoBox   = document.getElementById('wallet-info-box');
const createSection   = document.getElementById('create-section');
const walletActions   = document.getElementById('wallet-actions');
const importSection   = document.getElementById('import-section');
const genWalletBtn    = document.getElementById('gen-wallet-btn');
const importWalletBtn = document.getElementById('import-wallet-btn');
const pkInput         = document.getElementById('pk-input');
const confirmImportBtn= document.getElementById('confirm-import-btn');
const saveFlightBtn   = document.getElementById('save-flight-btn');
const loadFlightBtn   = document.getElementById('load-flight-btn');
const removeWalletBtn = document.getElementById('remove-wallet-btn');
const dataLog         = document.getElementById('data-log');
const closeSheetBtn   = document.getElementById('close-sheet-btn');
const toastEl         = document.getElementById('toast');

// ─── AUDIO ENGINE ────────────────────────────────────────────
let audioCtx = null;
let masterGain = null;
let beepTimer = null;

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = state.volume;
  masterGain.connect(audioCtx.destination);
}

function resumeAudio() {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

/**
 * Vario beep engine
 * Rising: short pip beeps, freq increases with climb rate
 * Sinking: continuous falling tone
 * Near-zero: silence
 */
function scheduleBeep() {
  clearTimeout(beepTimer);
  if (!state.running || state.muted || !audioCtx) return;
  resumeAudio();

  const v = state.varioSmooth;

  if (v > 0.2) {
    // RISING — beep frequency increases with climb rate
    const freq     = 700 + v * 120;       // 700–1300 Hz
    const interval = Math.max(80, 600 - v * 80);  // 80–600ms gap
    const duration = Math.min(0.18, 0.08 + v * 0.02);
    playTone(freq, duration, 'sine', 0.7);
    beepTimer = setTimeout(scheduleBeep, interval);

  } else if (v < -0.5) {
    // SINKING — continuous descending tone
    const freq = 380 - Math.abs(v) * 25;  // descends with sink
    playTone(freq, 0.22, 'sawtooth', 0.35);
    beepTimer = setTimeout(scheduleBeep, 240);

  } else {
    // Dead band
    beepTimer = setTimeout(scheduleBeep, 400);
  }
}

function playTone(freq, duration, type = 'sine', vol = 0.5) {
  if (!audioCtx || state.muted) return;
  const now = audioCtx.currentTime;
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(vol, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(now);
  osc.stop(now + duration + 0.01);
}

// ─── BAROMETER ───────────────────────────────────────────────
let sensorInterval = null;
let sensorInst     = null;
let lastLogTime    = 0;

function pressureToAltitude(hpa) {
  return (T0 / LAPSE_RATE) * (1 - Math.pow(hpa / SEA_PRESSURE, (R * LAPSE_RATE) / G));
}

function onPressureReading(hpa, tempC) {
  if (!state.running) return;

  state.pressurePrev = state.pressure;
  state.altitudePrev = state.altitude;
  state.pressure = hpa;
  if (tempC !== undefined) state.temperature = tempC;

  const alt = pressureToAltitude(hpa);
  state.altitude = alt;

  if (state.altitudePrev !== null) {
    const raw = state.altitude - state.altitudePrev;
    // clamp noise
    const clamped = Math.abs(raw) > 20 ? 0 : raw;
    state.vario = clamped;
    state.varioSmooth = state.varioSmooth * (1 - SMOOTH_FACTOR) + clamped * SMOOTH_FACTOR;
  }

  updateUI();
  logPoint();
}

function logPoint() {
  const now = Date.now();
  if (now - lastLogTime < LOG_INTERVAL) return;
  lastLogTime = now;
  state.flightLog.push({
    t: now,
    alt: Math.round(state.altitude),
    vario: +state.varioSmooth.toFixed(2),
    pres: +state.pressure.toFixed(2),
  });
  if (state.flightLog.length > 3600) state.flightLog.shift(); // cap at 1h
}

// ─── SENSOR INIT ─────────────────────────────────────────────
async function startSensor() {
  // 1. Try Generic Sensor API (AmbientPressure / AbsoluteOrientationSensor)
  if ('PressureSensor' in window || 'AbsolutePressureSensor' in window) {
    try {
      const SensorClass = window.PressureSensor || window.AbsolutePressureSensor;
      sensorInst = new SensorClass({ frequency: 4 });
      sensorInst.addEventListener('reading', () => {
        onPressureReading(sensorInst.pressure / 100); // Pa→hPa
      });
      sensorInst.addEventListener('error', (e) => console.warn('Sensor err', e));
      sensorInst.start();
      state.sensorType = 'barometer';
      setStatus('active', 'Barómetro activo');
      return;
    } catch (e) { console.warn('PressureSensor fail:', e); }
  }

  // 2. Try Barometer (Samsung/Chrome experimental)
  if ('Barometer' in window) {
    try {
      sensorInst = new window.Barometer({ frequency: 4 });
      sensorInst.addEventListener('reading', () => {
        onPressureReading(sensorInst.pressure / 100);
      });
      sensorInst.start();
      state.sensorType = 'barometer';
      setStatus('active', 'Barómetro activo');
      return;
    } catch (e) { console.warn('Barometer fail:', e); }
  }

  // 3. Try DeviceMotion (some devices expose pressure via this path — rare)
  // 4. Try Geolocation altitude (fallback with degraded precision)
  if ('geolocation' in navigator) {
    try {
      const pos = await new Promise((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 5000 })
      );
      if (pos.coords.altitudeAccuracy !== null && pos.coords.altitude !== null) {
        // Use GPS altitude as rough alt reference — derive pressure inverse
        const gpAlt = pos.coords.altitude;
        const simPres = SEA_PRESSURE * Math.pow(1 - (LAPSE_RATE * gpAlt) / T0, G / (R * LAPSE_RATE));
        state.pressure = simPres;
        state.altitude = gpAlt;
        state.sensorType = 'gps';
        setStatus('active', 'GPS altitud');
        // Poll GPS
        sensorInterval = setInterval(async () => {
          navigator.geolocation.getCurrentPosition(p => {
            if (p.coords.altitude !== null) {
              const a = p.coords.altitude;
              const pr = SEA_PRESSURE * Math.pow(1 - (LAPSE_RATE * a) / T0, G / (R * LAPSE_RATE));
              onPressureReading(pr);
            }
          }, () => {}, { enableHighAccuracy: true, timeout: 2000 });
        }, 1000);
        return;
      }
    } catch (e) { console.warn('Geoloc fail:', e); }
  }

  // 5. Simulation mode (dev/demo)
  activateSimMode();
}

function activateSimMode() {
  state.sensorType = 'sim';
  setStatus('active', 'Modo simulación');
  toast('⚠ Barómetro no detectado — simulando');
  let t = 0;
  sensorInterval = setInterval(() => {
    t += 0.1;
    // Simulate thermals: slow climb, occasional descent
    const thermal = Math.sin(t * 0.3) * 2.5 + Math.sin(t * 1.1) * 0.8;
    const pres = SEA_PRESSURE - (800 + thermal * 3) * 0.12;
    const temp = 15 - (pres - SEA_PRESSURE) * 0.008 + Math.sin(t) * 1.5;
    onPressureReading(pres, temp);
  }, 250);
}

function stopSensor() {
  if (sensorInst) { try { sensorInst.stop(); } catch(e){} sensorInst = null; }
  if (sensorInterval) { clearInterval(sensorInterval); sensorInterval = null; }
  clearTimeout(beepTimer);
}

// ─── UI UPDATE ───────────────────────────────────────────────
function updateUI() {
  const v = state.varioSmooth;
  const absV = Math.abs(v);

  // Numeric display
  vmsValue.textContent = (v >= 0 ? '+' : '') + v.toFixed(1);

  // Color class
  vmsValue.classList.toggle('rising',  v > 0.2);
  vmsValue.classList.toggle('sinking', v < -0.4);
  appEl.classList.toggle('rising',  v > 0.2);
  appEl.classList.toggle('sinking', v < -0.4);

  // Arrow
  arrow.classList.toggle('rising',  v > 0.2);
  arrow.classList.toggle('sinking', v < -0.4);
  arrow.classList.remove(...(v <= 0.2 && v >= -0.4 ? ['rising','sinking'] : []));
  if (v <= 0.2 && v >= -0.4) { arrow.style.opacity = '0.2'; }

  // Pulse on strong climb
  if (v > 1.5) {
    pulse.style.borderColor = 'var(--up)';
    pulse.classList.remove('beat');
    void pulse.offsetWidth;
    pulse.classList.add('beat');
  } else if (v < -1.5) {
    pulse.style.borderColor = 'var(--down)';
    pulse.classList.remove('beat');
    void pulse.offsetWidth;
    pulse.classList.add('beat');
  }

  // Arc gauge — map -5..+5 to 0°..180°
  const angle = ((v + 5) / 10) * 180 - 90; // -90..+90 degrees from center
  const clampedAngle = Math.max(-88, Math.min(88, angle));
  needle.style.transform = `rotate(${clampedAngle}deg)`;

  // Arc fill
  const pct = (v + 5) / 10;
  const arcLen = 440;
  const offset = arcLen * (1 - Math.max(0, Math.min(1, pct)));
  arcFill.style.strokeDashoffset = offset;
  arcFill.style.stroke = v > 0.2 ? 'var(--up)' : v < -0.4 ? 'var(--down)' : 'var(--neutral)';

  // Secondary
  altVal.textContent  = state.altitude  !== null ? Math.round(state.altitude)  : '—';
  presVal.textContent = state.pressure  !== null ? state.pressure.toFixed(1)   : '—';
  tempVal.textContent = state.temperature !== null ? state.temperature.toFixed(1) : '—';
  baroRawEl.textContent = state.pressure !== null ? state.pressure.toFixed(2) + ' hPa' : '— hPa';
}

function setStatus(type, txt) {
  statusDot.className = type;
  statusTxt.textContent = txt;
}

// ─── CONTROLS ────────────────────────────────────────────────
startBtn.addEventListener('click', async () => {
  if (!state.running) {
    initAudio();
    resumeAudio();
    state.running = true;
    state.flightLog = [];
    startBtn.textContent = '⏹ Detener';
    startBtn.classList.add('active-toggle');
    startBtn.classList.remove('primary');
    setStatus('', 'Iniciando…');
    await startSensor();
    scheduleBeep();
    requestFullscreen();
  } else {
    state.running = false;
    stopSensor();
    clearTimeout(beepTimer);
    startBtn.textContent = '▶ Iniciar';
    startBtn.classList.remove('active-toggle');
    startBtn.classList.add('primary');
    setStatus('', 'Detenido');
    state.varioSmooth = 0;
    state.vario = 0;
    updateUI();
    vmsValue.textContent = '0.0';
  }
});

muteBtn.addEventListener('click', () => {
  state.muted = !state.muted;
  muteBtn.textContent = state.muted ? '🔇' : '🔊';
  if (masterGain) masterGain.gain.value = state.muted ? 0 : state.volume;
});

volSlider.addEventListener('input', () => {
  state.volume = parseFloat(volSlider.value);
  volVal.textContent = Math.round(state.volume * 100) + '%';
  if (masterGain && !state.muted) masterGain.gain.value = state.volume;
});

walletBtn.addEventListener('click', () => openWalletSheet());
closeSheetBtn.addEventListener('click', () => closeWalletSheet());
walletOverlay.addEventListener('click', (e) => { if (e.target === walletOverlay) closeWalletSheet(); });

function openWalletSheet() {
  refreshWalletUI();
  walletOverlay.classList.add('open');
}
function closeWalletSheet() {
  walletOverlay.classList.remove('open');
  importSection.style.display = 'none';
}

// ─── FULLSCREEN ──────────────────────────────────────────────
function requestFullscreen() {
  const el = document.documentElement;
  if (el.requestFullscreen) el.requestFullscreen().catch(()=>{});
  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
}

// ─── TOAST ───────────────────────────────────────────────────
let toastTimer;
function toast(msg, duration = 2800) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration);
}

// ─── ETHERS v6 WALLET ────────────────────────────────────────

/** Derives a 32-byte encryption key from wallet private key via SHA-256 */
async function deriveKey(privateKeyHex) {
  const raw = ethers.getBytes(privateKeyHex);
  const hash = await crypto.subtle.digest('SHA-256', raw);
  return new Uint8Array(hash);
}

/** AES-GCM encrypt */
async function encryptData(data, privateKeyHex) {
  const keyBytes = await deriveKey(privateKeyHex);
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, encoded);
  // Store iv + cipher as base64
  const combined = new Uint8Array(iv.length + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipher), iv.length);
  return btoa(String.fromCharCode(...combined));
}

/** AES-GCM decrypt */
async function decryptData(b64, privateKeyHex) {
  const keyBytes = await deriveKey(privateKeyHex);
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const combined = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const cipher = combined.slice(12);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, cipher);
  return JSON.parse(new TextDecoder().decode(plain));
}

/** Sign a message with the wallet (proves ownership) */
async function signMessage(msg) {
  if (!state.wallet) throw new Error('Sin wallet');
  return await state.wallet.signMessage(msg);
}

/** Persist wallet — we store the private key encrypted with a PIN derived KDF
    For this demo we encrypt with a deterministic self-signed message as "password" */
async function persistWallet(wallet) {
  // Use a signature over a known message as storage key (self-custodial pattern)
  const sig = await wallet.signMessage('vario-pwa-v1');
  const keyMat = ethers.keccak256(ethers.toUtf8Bytes(sig)).slice(2); // 32 bytes hex
  const enc = await encryptData({ pk: wallet.privateKey }, keyMat);
  localStorage.setItem(WALLET_KEY, enc + '|' + wallet.address);
}

async function loadPersistedWallet() {
  const stored = localStorage.getItem(WALLET_KEY);
  if (!stored) return null;
  const [enc, addr] = stored.split('|');
  // Reconstruct: we need the PK to sign — bootstrap problem resolved by trying
  // For self-custody apps the user must re-enter or we store an IV-less version
  // Here we do a simpler approach: encrypt PK with address-derived key
  try {
    const keyMat = ethers.keccak256(ethers.toUtf8Bytes('vario-bootstrap-' + addr)).slice(2);
    const data = await decryptData(enc, keyMat.padEnd(64, '0'));
    const wallet = new ethers.Wallet(data.pk);
    return wallet;
  } catch(e) {
    return null;
  }
}

async function saveWalletSimple(wallet) {
  // Bootstrap store: encrypt PK with address-derived key (accessible without prior PK)
  const keyMat = ethers.keccak256(ethers.toUtf8Bytes('vario-bootstrap-' + wallet.address)).slice(2).padEnd(64, '0');
  const enc = await encryptData({ pk: wallet.privateKey }, keyMat);
  localStorage.setItem(WALLET_KEY, enc + '|' + wallet.address);
}

// ─── WALLET UI ───────────────────────────────────────────────
genWalletBtn.addEventListener('click', async () => {
  const wallet = ethers.Wallet.createRandom();
  state.wallet = wallet;
  state.walletAddress = wallet.address;
  await saveWalletSimple(wallet);
  toast('✅ Wallet generada');
  refreshWalletUI();
});

importWalletBtn.addEventListener('click', () => {
  importSection.style.display = importSection.style.display === 'none' ? 'block' : 'none';
});

confirmImportBtn.addEventListener('click', async () => {
  const pk = pkInput.value.trim();
  try {
    const wallet = new ethers.Wallet(pk);
    state.wallet = wallet;
    state.walletAddress = wallet.address;
    await saveWalletSimple(wallet);
    pkInput.value = '';
    importSection.style.display = 'none';
    toast('✅ Wallet importada');
    refreshWalletUI();
  } catch(e) {
    toast('❌ Clave privada inválida');
  }
});

saveFlightBtn.addEventListener('click', async () => {
  if (!state.wallet) { toast('⚠ Sin wallet'); return; }
  if (!state.flightLog.length) { toast('⚠ Sin datos de vuelo'); return; }
  try {
    const payload = {
      address: state.walletAddress,
      ts: Date.now(),
      log: state.flightLog,
    };
    // Sign manifest
    const manifest = JSON.stringify({ address: payload.address, ts: payload.ts, points: payload.log.length });
    const sig = await signMessage(manifest);
    payload.sig = sig;
    // Encrypt with wallet PK
    const enc = await encryptData(payload, state.wallet.privateKey);
    localStorage.setItem(STORAGE_KEY, enc);
    toast(`💾 ${state.flightLog.length} puntos guardados`);
    renderLog(`Vuelo guardado: ${state.flightLog.length} pts`);
  } catch(e) {
    toast('❌ Error al guardar: ' + e.message);
  }
});

loadFlightBtn.addEventListener('click', async () => {
  if (!state.wallet) { toast('⚠ Sin wallet'); return; }
  const enc = localStorage.getItem(STORAGE_KEY);
  if (!enc) { toast('⚠ Sin datos guardados'); return; }
  try {
    const data = await decryptData(enc, state.wallet.privateKey);
    // Verify signature
    const manifest = JSON.stringify({ address: data.address, ts: data.ts, points: data.log.length });
    const signer = ethers.verifyMessage(manifest, data.sig);
    if (signer.toLowerCase() !== state.walletAddress.toLowerCase()) {
      toast('❌ Firma inválida — datos corruptos'); return;
    }
    state.flightLog = data.log;
    const date = new Date(data.ts).toLocaleString('es-AR');
    renderLog(`Vuelo cargado: ${data.log.length} pts · ${date}`);
    toast(`📂 Vuelo cargado: ${data.log.length} puntos`);
  } catch(e) {
    toast('❌ Error al descifrar: ' + e.message);
  }
});

removeWalletBtn.addEventListener('click', () => {
  if (!confirm('¿Eliminar wallet? Esta acción es irreversible.')) return;
  localStorage.removeItem(WALLET_KEY);
  localStorage.removeItem(STORAGE_KEY);
  state.wallet = null;
  state.walletAddress = null;
  toast('🗑 Wallet eliminada');
  refreshWalletUI();
});

function refreshWalletUI() {
  const hasWallet = !!state.wallet;
  walletInfoBox.style.display = hasWallet ? 'block' : 'none';
  createSection.style.display = hasWallet ? 'none' : 'block';
  walletActions.style.display = hasWallet ? 'block' : 'none';

  if (hasWallet) {
    const short = state.walletAddress.slice(0,8) + '…' + state.walletAddress.slice(-6);
    walletInfoBox.innerHTML = `
      <div>Dirección <span class="addr">${short}</span></div>
      <div style="font-size:9px;margin-top:4px;color:rgba(255,255,255,0.25)">
        ${state.walletAddress}
      </div>
      <div style="margin-top:8px;font-size:10px;">
        🔒 Datos cifrados con AES-GCM · clave derivada de tu wallet
      </div>
    `;
  }
  dataLog.innerHTML = '';
}

function renderLog(msg) {
  const el = document.createElement('div');
  el.className = 'log-entry';
  el.textContent = `[${new Date().toLocaleTimeString('es-AR')}] ${msg}`;
  dataLog.prepend(el);
}

// ─── INIT ────────────────────────────────────────────────────
(async () => {
  // Try to restore wallet on load
  try {
    const w = await loadPersistedWallet();
    if (w) {
      state.wallet = w;
      state.walletAddress = w.address;
      toast('🔓 Wallet restaurada');
    }
  } catch(e) { /* no wallet */ }

  // Initial UI
  updateUI();

  // Volume slider
  volSlider.value = state.volume;
  volVal.textContent = Math.round(state.volume * 100) + '%';

  // Wake lock (keep screen on)
  if ('wakeLock' in navigator) {
    try {
      await navigator.wakeLock.request('screen');
    } catch(e){}
  }
})();
