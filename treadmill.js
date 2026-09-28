// treadmill.js - JavaScript logic for PitPat Treadmill Control Dashboard

// --- Bluetooth UUIDs ---
const KM_TO_MI = 0.621371;
const SERVICE_UUID = "0000fba0-0000-1000-8000-00805f9b34fb";
const NOTIFY_CHAR_UUID = "0000fba2-0000-1000-8000-00805f9b34fb";
const WRITE_CHAR_UUID = "0000fba1-0000-1000-8000-00805f9b34fb";

// --- UI Elements ---
const connectBtn = document.getElementById('connectBtn');
const statusDiv = document.getElementById('status');
const speedDiv = document.getElementById('speed');
const distanceDiv = document.getElementById('distance');
const caloriesDiv = document.getElementById('calories');
const stepsDiv = document.getElementById('steps');
const durationDiv = document.getElementById('duration');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const speedUpBtn = document.getElementById('speedUpBtn');
const speedDownBtn = document.getElementById('speedDownBtn');
const speedSlider = document.getElementById('speedSlider');
const presetButtons = Array.from(document.querySelectorAll('.preset-btn'));
const sliderValue = document.getElementById('sliderValue');
const statusChip = document.getElementById('statusChip');
const loadingOverlay = document.getElementById('loadingOverlay');
const countdownOverlay = document.getElementById('countdownOverlay');
const countdownNumber = document.getElementById('countdownNumber');
const historyTableBody = document.getElementById('historyTableBody');
const importHistoryBtn = document.getElementById('importHistoryBtn');
const exportHistoryBtn = document.getElementById('exportHistoryBtn');
const importHistoryInput = document.getElementById('importHistoryInput');
const snackbar = document.getElementById('snackbar');

// --- Session History Logic ---
let sessionActive = false;
let sessionStartData = null;
let lastSession = null;

function loadSessions() {
    let sessions = [];
    try {
        sessions = JSON.parse(localStorage.getItem('treadmill_sessions') || '[]');
    } catch {}
    return Array.isArray(sessions) ? sessions : [];
}
function saveSessions(sessions) {
    localStorage.setItem('treadmill_sessions', JSON.stringify(sessions));
}
function addSession(session) {
    const sessions = loadSessions();
    sessions.unshift(session); // newest first
    saveSessions(sessions);
    renderSessionTable();
}
function deleteSession(idx) {
    const sessions = loadSessions();
    sessions.splice(idx, 1);
    saveSessions(sessions);
    renderSessionTable();
}
function renderSessionTable() {
    const sessions = loadSessions();
    historyTableBody.innerHTML = '';
    sessions.forEach((s, i) => {
        let avgSpeedDisplay = '-';
        const avgNumber = typeof s.avgSpeed === 'number' ? s.avgSpeed : parseFloat(s.avgSpeed);
        if (!isNaN(avgNumber)) {
            const mph = s.speedUnit === 'kph' ? avgNumber * KM_TO_MI : avgNumber;
            avgSpeedDisplay = mph.toFixed(2) + ' mph';
        }
        let dateStr = '-';
        if (typeof s.date === 'number' || typeof s.date === 'string') {
            dateStr = dateFns.formatRelative(new Date(s.date), new Date());
        }
        let distanceDisplay = '-';
        const miles = milesFromSession(s);
        if (miles > 0 || s.distance === 0) {
            distanceDisplay = miles.toFixed(2) + ' mi';
        }
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${dateStr}</td>
            <td>${formatDuration(s.duration)}</td>
            <td>${distanceDisplay}</td>
            <td>${s.steps}</td>
            <td>${s.calories}</td>
            <td>${avgSpeedDisplay}</td>
            <td><button class="mdl-button mdl-js-button mdl-button--icon" title="Delete" onclick="window.deleteSessionFromTable(${i})"><i class="material-icons">delete</i></button></td>
        `;
        historyTableBody.appendChild(tr);
    });
    renderPeriodTotals(sessions);
}
function toMiles(value, unit) {
    if (unit === 'km' || unit === 'kph') return value * KM_TO_MI;
    return value;
}
function milesFromSession(session) {
    const value = typeof session.distance === 'number' ? session.distance : parseFloat(session.distance);
    if (isNaN(value)) return 0;
    return toMiles(value, session.distanceUnit);
}
function mphToProtocol(mph) {
    const kph = Math.min(6, Math.max(1, mph / KM_TO_MI));
    return Math.round(kph * 1000);
}
function renderPeriodTotals(sessions) {
    const el = document.getElementById('periodTotals');
    if (!el || typeof dateFns === 'undefined') return;
    const now = new Date();
    const periods = [
        ['Today', dateFns.startOfDay(now)],
        ['This week', dateFns.startOfWeek(now)],
        ['This month', dateFns.startOfMonth(now)],
        ['This year', dateFns.startOfYear(now)]
    ];
    el.innerHTML = periods.map(([label, start]) => {
        let distance = 0;
        sessions.forEach((s) => {
            const when = new Date(s.date);
            if (isNaN(when.getTime()) || when < start || when > now) return;
            distance += milesFromSession(s);
        });
        return '<div class="total-tile"><span>' + label + '</span><strong>' + distance.toFixed(2) + ' mi</strong></div>';
    }).join('');
}
window.deleteSessionFromTable = deleteSession;

// --- State ---
let treadmillData = {};
let connected = false;
let androidListenOnly = false;
let runningState = 3; // 0: Starting, 1: Running, 2: Paused, 3: Stopped
let curTargetSpeed = 1000; // in treadmill units

// --- Helper Functions ---

function setStatus(msg) {
    let displayMsg = msg;
    if (msg.toLowerCase().includes('connecting')) {
        displayMsg = 'Connecting';
    } else if (msg.toLowerCase().includes('not connected') || msg.toLowerCase().includes('disconnect')) {
        displayMsg = 'Disconnected';
    } else if (msg.toLowerCase().includes('paused')) {
        displayMsg = 'Paused';
    } else if (msg.toLowerCase().includes('running')) {
        displayMsg = 'Running';
    } else if (msg.toLowerCase().includes('stopped')) {
        displayMsg = 'Stopped';
    }
    if (statusChip) {
        statusChip.querySelector('.mdl-chip__text').textContent = displayMsg;
        statusChip.classList.remove('chip-connected', 'chip-connecting', 'chip-disconnected', 'chip-paused');
        if (displayMsg === 'Running') {
            statusChip.classList.add('chip-connected');
        } else if (displayMsg === 'Connecting') {
            statusChip.classList.add('chip-connecting');
        } else if (displayMsg === 'Paused') {
            statusChip.classList.add('chip-paused');
        } else {
            statusChip.classList.add('chip-disconnected');
        }
    }
}
function updateDashboard(data) {
    speedDiv.textContent = data.speed || '-';
    distanceDiv.textContent = data.distance || '-';
    caloriesDiv.textContent = data.calories || '-';
    stepsDiv.textContent = (data.steps !== undefined && data.steps !== null) ? data.steps : '-';
    if (data.duration && typeof data.duration === 'number') {
        durationDiv.textContent = formatDuration(data.duration);
    } else if (typeof data.duration === 'string' && !isNaN(parseFloat(data.duration))) {
        durationDiv.textContent = formatDuration(parseFloat(data.duration));
    } else {
        durationDiv.textContent = data.duration || '-';
    }
}
function enableControls(enable) {
    startBtn.disabled = !enable;
    stopBtn.disabled = !enable;
    speedUpBtn.disabled = !enable;
    speedDownBtn.disabled = !enable;
    speedSlider.disabled = !enable;
    presetButtons.forEach((btn) => { btn.disabled = !enable; });
}
function updateRunningState(state) {
    runningState = state;
    if (!connected) {
        enableControls(false);
        startBtn.textContent = "Start";
        setStatus('Disconnected');
    } else {
        switch (state) {
            case 0: // Starting
                enableControls(false);
                startBtn.textContent = "Start";
                break;
            case 1: // Running
                enableControls(!androidListenOnly);
                startBtn.textContent = "Pause";
                setStatus('Running');
                break;
            case 2: // Paused
                enableControls(!androidListenOnly);
                startBtn.textContent = "Start";
                setStatus('Paused');
                break;
            case 3: // Stopped
                enableControls(!androidListenOnly);
                startBtn.textContent = "Start";
                setStatus('Stopped');
                break;
            default:
                enableControls(false);
                startBtn.textContent = "Start";
                setStatus('Disconnected');
        }
    }
    publishWidget();
}
function publishWidget(statusOverride, force) {
    if (!window.PitPatAndroid || !window.PitPatAndroid.setWidgetState) return;
    let status = statusOverride;
    if (!status) {
        if (!connected) status = 'Disconnected';
        else if (runningState === 1) status = 'Running';
        else if (runningState === 2) status = 'Paused';
        else if (runningState === 0) status = 'Starting';
        else status = 'Stopped';
    }
    const now = Date.now();
    const key = String(connected) + '|' + runningState + '|' + status;
    if (!force && key === publishWidget.lastKey && now - (publishWidget.lastAt || 0) < 500) return;
    publishWidget.lastKey = key;
    publishWidget.lastAt = now;
    let speed = '-';
    let time = '-';
    let calories = '-';
    let distance = '-';
    if (connected && treadmillData) {
        if (treadmillData.speed) speed = treadmillData.speed;
        if (treadmillData.distance) distance = treadmillData.distance;
        if (treadmillData.calories) calories = String(treadmillData.calories);
        if (typeof treadmillData.duration === 'number') time = widgetClock(treadmillData.duration);
    }
    const preset = speedSlider ? speedSlider.value : '';
    window.PitPatAndroid.setWidgetState(!!connected, runningState === 1, status, speed, time, calories, distance, preset);
}
function widgetClock(seconds) {
    seconds = Math.max(0, Math.floor(seconds) || 0);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    if (h > 0) return h + ':' + mm + ':' + ss;
    return m + ':' + ss;
}
function formatDuration(seconds) {
    seconds = Math.floor(seconds);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    let parts = [];
    if (h > 0) parts.push(h + 'h');
    if (m > 0 || h > 0) parts.push(m + 'm');
    parts.push(s + 's');
    return parts.join(' ');
}

// --- Send Data Logic (replaces sendCommand) ---
let pendingData = null;
function send_data(packet) {
    pendingData = packet;
}

// --- Transport ---
// Chrome uses Web Bluetooth. A later Android build can replace this object.
function createWebBluetoothTransport() {
    let device = null;
    let notifyChar = null;
    let writeChar = null;
    let onNotification = function () {};
    let onDisconnected = function () {};

    return {
        setHandlers(handlers) {
            onNotification = handlers.onNotification;
            onDisconnected = handlers.onDisconnected;
        },
        canWrite() {
            return !!writeChar;
        },
        async connect() {
            console.log("Requesting Bluetooth device...");
            device = await navigator.bluetooth.requestDevice({
                filters: [{ services: [SERVICE_UUID] }],
                services: [SERVICE_UUID]
            });
            console.log("Device selected:", device);
            device.addEventListener('gattserverdisconnected', () => onDisconnected());
            const server = await device.gatt.connect();
            console.log("GATT server connected:", server);
            let services = await server.getPrimaryServices();
            console.log("Primary services:", services.map(s => s.uuid));
            notifyChar = await server.getPrimaryService(SERVICE_UUID).then(
                service => service.getCharacteristic(NOTIFY_CHAR_UUID)
            ).catch(async () => {
                let services = await server.getPrimaryServices();
                for (let s of services) {
                    try {
                        let c = await s.getCharacteristic(NOTIFY_CHAR_UUID);
                        if (c) return c;
                    } catch {}
                }
                throw new Error("Notify characteristic not found");
            });
            console.log("Notify characteristic:", notifyChar);
            writeChar = await server.getPrimaryService(SERVICE_UUID).then(
                service => service.getCharacteristic(WRITE_CHAR_UUID)
            ).catch(async () => {
                let services = await server.getPrimaryServices();
                for (let s of services) {
                    try {
                        let c = await s.getCharacteristic(WRITE_CHAR_UUID);
                        if (c) return c;
                    } catch {}
                }
                throw new Error("Write characteristic not found");
            });
            console.log("Write characteristic:", writeChar);
            await notifyChar.startNotifications();
            notifyChar.addEventListener('characteristicvaluechanged', (event) => {
                onNotification(event.target.value);
            });
        },
        disconnect() {
            if (device && device.gatt.connected) {
                device.gatt.disconnect();
            }
        },
        write(packet) {
            return writeChar.writeValue(packet);
        }
    };
}

const transport = createWebBluetoothTransport();

const androidWriteResolvers = [];
function onAndroidWriteDone() {
    androidWriteResolvers.splice(0).forEach((item) => item.resolve());
}
function onAndroidWriteFailed() {
    androidWriteResolvers.splice(0).forEach((item) => item.reject(new Error("Android write failed")));
}
const androidTransport = {
    canWrite() {
        return !!(window.PitPatAndroid && connected);
    },
    write(packet) {
        return new Promise((resolve, reject) => {
            androidWriteResolvers.push({ resolve, reject });
            window.PitPatAndroid.writeHex(packetHex(packet));
        });
    }
};
function beltTransport() {
    if (window.PitPatAndroid && connected) return androidTransport;
    return transport;
}
window.onAndroidWriteDone = onAndroidWriteDone;
window.onAndroidWriteFailed = onAndroidWriteFailed;

// --- Bluetooth Logic ---
async function connectBluetooth() {
    setStatus('Connecting');
    if (loadingOverlay) loadingOverlay.style.display = 'flex';
    try {
        transport.setHandlers({
            onNotification: handleNotification,
            onDisconnected: onDisconnected
        });
        setStatus('Connecting');
        await transport.connect();
        connected = true;
        setStatus('Stopped');
        connectBtn.textContent = "Disconnect";
        updateRunningState(3);
        // No heartbeat loop, just send heartbeat or data on notification
        if (loadingOverlay) loadingOverlay.style.display = 'none';
    } catch (err) {
        console.error("Bluetooth connection error:", err);
        showToast("Bluetooth error: " + err);
        setStatus('Disconnected');
        connected = false;
        connectBtn.textContent = "Connect";
        if (loadingOverlay) loadingOverlay.style.display = 'none';
        // stopHeartbeatLoop();
    }
}

function disconnectBluetooth() {
    transport.disconnect();
    if (loadingOverlay) loadingOverlay.style.display = 'none';
    setStatus('Disconnected');
}

function onDisconnected() {
    connected = false;
    setStatus('Disconnected');
    connectBtn.textContent = "Connect";
    updateRunningState(3);
    if (sessionActive && sessionStartData) {
        finishSession('Disconnected');
    }
}

const PACKET_CAPTURE_KEY = 'treadmill_packet_capture';
let captureFrozen = false;

function packetHex(bytes) {
    const out = [];
    const len = typeof bytes.getUint8 === 'function' ? bytes.byteLength : bytes.length;
    for (let i = 0; i < len; i++) {
        const b = typeof bytes.getUint8 === 'function' ? bytes.getUint8(i) : bytes[i];
        out.push(b.toString(16).padStart(2, '0'));
    }
    return out.join(' ');
}

function dataViewFromHex(hex) {
    const bytes = hex.trim().split(/\s+/).map(h => parseInt(h, 16));
    return new DataView(new Uint8Array(bytes).buffer);
}

function loadPacketCapture() {
    try {
        return JSON.parse(localStorage.getItem(PACKET_CAPTURE_KEY)) || {};
    } catch {
        return {};
    }
}

function decodeStatusPacket(value) {
    function u16(offset) {
        return (value.getUint8(offset) << 8) | value.getUint8(offset + 1);
    }
    function u32(offset) {
        return (value.getUint8(offset) << 24) | (value.getUint8(offset + 1) << 16) | (value.getUint8(offset + 2) << 8) | value.getUint8(offset + 3);
    }
    const current_speed = u16(3);
    const distance = u32(7);
    const calories = (value.getUint8(18) << 8) | value.getUint8(19);
    const steps = u32(14);
    const duration = u32(20);
    const flags = value.getUint8(26);
    const unit_mode = (flags & 128) === 128 ? 1 : 0;
    const running_state_bits = flags & 24;
    let running_state = 3;
    if (running_state_bits === 24) running_state = 0;
    else if (running_state_bits === 8) running_state = 1;
    else if (running_state_bits === 16) running_state = 2;
    else running_state = 3;
    const statusArr = ["Starting", "Running", "Paused", "Stopped"];
    const speed_unit = unit_mode === 1 ? "mph" : "kph";
    const distance_unit = unit_mode === 1 ? "mi" : "km";
    return {
        current_speed,
        distance,
        calories,
        steps,
        duration,
        running_state,
        speed_unit,
        distance_unit,
        status: statusArr[running_state] || "Unknown"
    };
}

function renderPacketCapture() {
    const decodedEl = document.getElementById('captureDecoded');
    const statusEl = document.getElementById('captureStatusHex');
    const startEl = document.getElementById('captureStartHex');
    if (!decodedEl || !statusEl || !startEl) return;
    const capture = loadPacketCapture();
    if (!capture.statusHex) {
        decodedEl.textContent = 'No status packet saved yet. Start the belt from this page, then stop and open History.';
    } else {
        const parsed = decodeStatusPacket(dataViewFromHex(capture.statusHex));
        decodedEl.textContent = [
            'Speed ' + toMiles(parsed.current_speed / 1000, parsed.speed_unit).toFixed(2) + ' mph',
            'Distance ' + toMiles(parsed.distance / 1000, parsed.distance_unit).toFixed(2) + ' mi',
            'Steps ' + parsed.steps,
            'Time ' + formatDuration(Math.round(parsed.duration / 1000))
        ].join(' · ');
    }
    statusEl.textContent = capture.statusHex ? ('Status ' + capture.statusHex) : '';
    startEl.textContent = capture.startHex ? ('Start ' + capture.startHex) : 'No start command saved yet.';
}

function savePacketCapture(capture) {
    localStorage.setItem(PACKET_CAPTURE_KEY, JSON.stringify(capture));
    renderPacketCapture();
}

function noteStatusPacket(value) {
    if (captureFrozen) return;
    const capture = loadPacketCapture();
    if (!capture.startHex) return;
    capture.statusHex = packetHex(value);
    savePacketCapture(capture);
}

function noteStartCommand(packet) {
    if (!packet || packet.length !== 23 || packet[0] !== 0x6A || packet[8] !== 1 || packet[12] !== 4 || packet[22] !== 0x43) return;
    captureFrozen = false;
    savePacketCapture({ startHex: packetHex(packet) });
}

function freezePacketCapture() {
    captureFrozen = true;
}

function handleNotification(value) {
    // Logging for debugging
    console.log("Received notification, byteLength:", value.byteLength);
    let hexStr = [];
    for (let i = 0; i < value.byteLength; ++i) {
        hexStr.push(value.getUint8(i).toString(16).padStart(2, "0"));
    }
    console.log("Payload (hex):", hexStr.join(" "));
    // Parse treadmill data from value (see treadmill_data.py for structure)
    if (value.byteLength < 31) {
        treadmillData = {
            speed: "-",
            distance: "-",
            calories: "-",
            steps: "-",
            duration: "-",
            status: "Invalid"
        };
        updateDashboard(treadmillData);
        updateRunningState(3);
        // If session was active, save it as ended due to disconnect/invalid
        if (sessionActive && sessionStartData) {
            finishSession('Disconnected');
        }
        return;
    }
    const parsed = decodeStatusPacket(value);
    const current_speed = parsed.current_speed;
    const distance = parsed.distance;
    const calories = parsed.calories;
    const steps = parsed.steps;
    const duration = parsed.duration;
    const running_state = parsed.running_state;
    const speed_unit = parsed.speed_unit;
    const distance_unit = parsed.distance_unit;
    treadmillData = {
        speed: toMiles(current_speed / 1000, speed_unit).toFixed(2) + " mph",
        distance: toMiles(distance / 1000, distance_unit).toFixed(2) + " mi",
        calories: calories + " kcal",
        steps: steps,
        duration: Math.round(duration / 1000),
        status: parsed.status,
        _raw: { current_speed, distance, calories, steps, duration, speed_unit }
    };
    // Log parsed fields
    console.log("Parsed treadmill data:", treadmillData);
    updateDashboard(treadmillData);
    updateRunningState(running_state);

    // --- Session tracking logic ---
    if (running_state === 1 && !sessionActive) {
        noteStatusPacket(value);
        // Session started
        sessionActive = true;
        sessionStartData = {
            date: Date.now(),
            steps: steps,
            calories: calories,
            distance: distance,
            duration: Math.round(duration / 1000),
            speedSum: current_speed,
            speedCount: 1,
            speedUnit: speed_unit,
            distanceUnit: distance_unit
        };
        upsertLiveSession(currentSessionRecord());
    } else if (running_state === 1 && sessionActive && sessionStartData) {
        noteStatusPacket(value);
        // Update session stats
        sessionStartData.steps = steps;
        sessionStartData.calories = calories;
        sessionStartData.distance = distance;
        sessionStartData.duration = Math.round(duration / 1000);
        sessionStartData.speedSum += current_speed;
        sessionStartData.speedCount += 1;
        sessionStartData.distanceUnit = distance_unit;
        upsertLiveSession(currentSessionRecord());
    } else if ((running_state === 3 || running_state === 2) && sessionActive && sessionStartData) {
        noteStatusPacket(value);
        sessionStartData.steps = steps;
        sessionStartData.calories = calories;
        sessionStartData.distance = distance;
        sessionStartData.duration = Math.round(duration / 1000);
        sessionStartData.distanceUnit = distance_unit;
        upsertLiveSession(currentSessionRecord());
        freezePacketCapture();
        // Session ended (Stopped or Paused)
        finishSession(running_state === 3 ? 'Stopped' : 'Paused');
    }

    // --- Heartbeat/data send logic, like _notification_handler ---
    const link = beltTransport();
    if (link.canWrite()) {
        if (pendingData) {
            const packet = pendingData;
            console.log("Sending pending data packet:", Array.from(packet).map(b => b.toString(16).padStart(2, "0")).join(" "));
            link.write(packet).then(() => {
                console.log("Pending data sent.");
                noteStartCommand(packet);
                pendingData = null;
            }).catch(err => {
                console.error("Failed to send pending data:", err);
            });
        } else {
            // Heartbeat packet: 6a05fdf843
            const heartbeat = new Uint8Array([0x6a, 0x05, 0xfd, 0xf8, 0x43]);
            console.log("Sending heartbeat packet:", Array.from(heartbeat).map(b => b.toString(16).padStart(2, "0")).join(" "));
            link.write(heartbeat).catch(err => {
                console.error("Failed to send heartbeat:", err);
            });
        }
    }
}

async function sendCommand(packet) {
    const link = beltTransport();
    if (!link.canWrite()) return;
    try {
        console.log("Sending command packet:", Array.from(packet).map(b => b.toString(16).padStart(2, "0")).join(" "));
        await link.write(packet);
    } catch (err) {
        console.error("Failed to send command:", err);
        showToast("Failed to send command: " + err);
    }
}

// --- Command Packet Generators (see treadmill_controller.py) ---
/**
 * Constructs a treadmill command packet.
 * @param {string} type - Command type: "start", "pause", "stop", or "set_speed".
 * @param {number} [speed=1000] - Target speed in treadmill units (integer, 1000 = 1.00 kph, range: 1000 to 6000).
 * @returns {Uint8Array} The command packet.
 */
function makePacket(type, speed = 1000) {
    // type: "start", "pause", "stop", "set_speed"
    // Implements the protocol from treadmill_controller.py
    let arr = new Uint8Array(23);
    arr[0] = 0x6A; // START_BYTE
    arr[1] = 0x17; // LENGTH
    // arr[2-5] = 0 (reserved)
    arr[6] = (speed >> 8) & 0xFF;
    arr[7] = speed & 0xFF;
    arr[8] = type === "set_speed" ? 5 : 1; // magical_i11: 5 for set_speed, 1 for others
    arr[9] = 0; // incline
    arr[10] = 80; // weight (default)
    arr[11] = 0; // reserved
    // Command byte (kph): 4=start/set, 2=pause, 0=stop
    let cmd = type === "pause" ? 2 : type === "stop" ? 0 : 4;
    arr[12] = cmd & 0xF7; // kph mode (bit 3 = 0)
    // User ID (8 bytes, default 58965456623)
    let userId = 58965456623n;
    for (let i = 0; i < 8; ++i) {
        arr[13 + i] = Number((userId >> BigInt(56 - i * 8)) & 0xFFn);
    }
    // Checksum: XOR of bytes 1 to 20
    let checksum = 0;
    for (let i = 1; i <= 20; ++i) {
        checksum ^= arr[i];
    }
    arr[21] = checksum;
    arr[22] = 0x43; // END_BYTE
    return arr;
}

// --- UI Event Handlers ---
function showAndroidScanStatus(message) {
    const box = document.getElementById('scanResults');
    if (!box) return;
    box.style.display = 'block';
    let status = document.getElementById('scanStatus');
    if (!status) {
        status = document.createElement('div');
        status.id = 'scanStatus';
        box.prepend(status);
    }
    status.textContent = message;
    if (!connected) publishWidget(message);
}
function showAndroidScanResult(name, address) {
    const box = document.getElementById('scanResults');
    if (!box || !name || !address) return;
    box.style.display = 'block';
    showAndroidScanStatus('Tap a pad to listen');
    const items = box.querySelectorAll('[data-device]');
    for (const item of items) {
        if (item.dataset.device === address) return;
    }
    const line = document.createElement('div');
    line.dataset.device = address;
    line.textContent = name;
    line.style.fontSize = '1.2em';
    line.style.marginTop = '0.4em';
    line.style.textDecoration = 'underline';
    line.addEventListener('click', () => {
        showAndroidScanStatus('Connecting to ' + name + '…');
        window.PitPatAndroid.connect(address);
    });
    box.appendChild(line);
}
function onAndroidConnected() {
    connected = true;
    androidListenOnly = false;
    connectBtn.textContent = "Disconnect";
    updateRunningState(3);
}
function onAndroidDisconnected() {
    const hadSession = sessionActive && sessionStartData;
    connected = false;
    androidListenOnly = false;
    connectBtn.textContent = "Connect";
    updateRunningState(3);
    if (hadSession) finishSession('Disconnected');
}
function onAndroidNotification(bytes) {
    const data = new Uint8Array(bytes);
    handleNotification(new DataView(data.buffer));
}
window.showAndroidScanStatus = showAndroidScanStatus;
window.showAndroidScanResult = showAndroidScanResult;
window.onAndroidConnected = onAndroidConnected;
window.onAndroidDisconnected = onAndroidDisconnected;
window.onAndroidNotification = onAndroidNotification;

connectBtn.addEventListener('click', () => {
    if (window.PitPatAndroid) {
        if (!connected) {
            const box = document.getElementById('scanResults');
            if (box) {
                box.style.display = 'block';
                box.innerHTML = '';
            }
            showAndroidScanStatus('Connecting…');
            if (window.PitPatAndroid.connectLast) window.PitPatAndroid.connectLast();
            else window.PitPatAndroid.startScan();
        } else {
            window.PitPatAndroid.disconnect();
        }
        return;
    }
    if (!connected) connectBluetooth();
    else disconnectBluetooth();
});

function startWalk() {
    if (countdownOverlay && countdownNumber) {
        countdownOverlay.style.display = 'flex';
        countdownOverlay.style.opacity = '1';
        let count = 3;
        countdownNumber.textContent = count;
        countdownNumber.style.opacity = '1';
        countdownNumber.style.transform = 'scale(1)';
        (async () => {
            for (let i = 0; i < 3; i++) {
                await new Promise(res => setTimeout(res, 700));
                countdownNumber.style.transform = 'scale(1.3)';
                countdownNumber.style.opacity = '0.5';
                await new Promise(res => setTimeout(res, 200));
                count--;
                if (count > 0) {
                    countdownNumber.textContent = count;
                    countdownNumber.style.opacity = '1';
                    countdownNumber.style.transform = 'scale(1)';
                }
            }
            await new Promise(res => setTimeout(res, 400));
            countdownOverlay.style.opacity = '0';
            await new Promise(res => setTimeout(res, 500));
            countdownOverlay.style.display = 'none';
            countdownOverlay.style.opacity = '1';
        })();
    }
    send_data(makePacket("start", curTargetSpeed));
}
startBtn.addEventListener('click', () => {
    if (!connected) return;
    if (runningState === 1) {
        send_data(makePacket("pause"));
    } else {
        startWalk();
    }
});

stopBtn.addEventListener('click', () => {
    if (!connected) return;
    send_data(makePacket("stop"));
});

function setSliderMph(mph) {
    const clamped = Math.min(3.7, Math.max(0.6, Math.round(mph * 10) / 10));
    const label = clamped.toFixed(1);
    speedSlider.value = label;
    sliderValue.textContent = label;
    if (speedSlider.MaterialSlider) speedSlider.MaterialSlider.change(clamped);
    curTargetSpeed = mphToProtocol(clamped);
    presetButtons.forEach((btn) => {
        btn.classList.toggle('is-selected', parseFloat(btn.dataset.mph).toFixed(1) === label);
    });
}
speedUpBtn.addEventListener('click', () => {
    if (!connected) return;
    setSliderMph(parseFloat(speedSlider.value) + 0.1);
    send_data(makePacket("set_speed", curTargetSpeed));
});

speedDownBtn.addEventListener('click', () => {
    if (!connected) return;
    setSliderMph(parseFloat(speedSlider.value) - 0.1);
    send_data(makePacket("set_speed", curTargetSpeed));
});

speedSlider.addEventListener('input', () => {
    sliderValue.textContent = speedSlider.value;
});
speedSlider.addEventListener('change', () => {
    setSliderMph(parseFloat(speedSlider.value));
    if (!connected) return;
    send_data(makePacket("set_speed", curTargetSpeed));
});
function usePresetMph(mph, startIfConnected) {
    setSliderMph(mph);
    if (!connected) return false;
    if (!startIfConnected) return true;
    if (runningState === 1) {
        send_data(makePacket("set_speed", curTargetSpeed));
    } else if (runningState !== 0) {
        startWalk();
    }
    publishWidget(null, true);
    return true;
}
presetButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
        if (!connected || btn.disabled) return;
        usePresetMph(parseFloat(btn.dataset.mph), true);
    });
});
window.applyWidgetAction = function (action) {
    if (action === 'connect') {
        if (connected && window.PitPatAndroid) {
            window.PitPatAndroid.disconnect();
        } else if (window.PitPatAndroid && window.PitPatAndroid.connectLast) {
            window.PitPatAndroid.connectLast();
        } else {
            connectBtn.click();
        }
        return;
    }
    const mph = parseFloat(action);
    if (!isNaN(mph)) {
        if (!connected) {
            setSliderMph(mph);
            publishWidget('Connect first', true);
            return;
        }
        usePresetMph(mph, true);
        return;
    }
    if (!connected) {
        showToast('Connect to the pad first.');
        publishWidget('Connect first', true);
        return;
    }
    if (runningState === 1) {
        send_data(makePacket('pause'));
    } else if (runningState !== 0) {
        startWalk();
    }
};

// --- Initialize ---
updateDashboard({});
updateRunningState(3);
setSliderMph(parseFloat(speedSlider.value));
renderSessionTable();
renderPacketCapture();

function saveCurrentSession(session) {
    localStorage.setItem('treadmill_current_session', JSON.stringify(session));
}
function loadCurrentSession() {
    try {
        return JSON.parse(localStorage.getItem('treadmill_current_session')) || null;
    } catch { return null; }
}
function clearCurrentSession() {
    localStorage.removeItem('treadmill_current_session');
}

function currentSessionRecord() {
    const rawAvg = (sessionStartData.speedSum / sessionStartData.speedCount) / 1000;
    return {
        date: sessionStartData.date,
        duration: sessionStartData.duration,
        steps: sessionStartData.steps,
        calories: sessionStartData.calories + ' kcal',
        avgSpeed: toMiles(rawAvg, sessionStartData.speedUnit),
        speedUnit: 'mph',
        distance: toMiles(sessionStartData.distance / 1000, sessionStartData.distanceUnit),
        distanceUnit: 'mi'
    };
}
function upsertLiveSession(session) {
    let sessions = loadSessions();
    if (sessions.length > 0 && sessions[0] && sessions[0].date === session.date) {
        sessions[0] = session;
    } else {
        sessions.unshift(session);
    }
    saveSessions(sessions);
    renderSessionTable();
}

function finishSession(reason) {
    sessionActive = false;
    sessionStartData = null;
    // No need to do anything else, as the session is already up-to-date in treadmill_sessions
}

// On page load, check for an unfinished session and restore it if present
const restored = loadCurrentSession();
if (restored && !sessionActive) {
    sessionActive = true;
    sessionStartData = restored;
}

// --- Import/Export History ---
if (exportHistoryBtn) {
    exportHistoryBtn.addEventListener('click', () => {
        const sessions = loadSessions();
        const blob = new Blob([JSON.stringify(sessions, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'treadmill_sessions.json';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
        showToast('History exported.');
    });
}

if (importHistoryBtn && importHistoryInput) {
    importHistoryBtn.addEventListener('click', () => {
        importHistoryInput.value = '';
        importHistoryInput.click();
    });
    importHistoryInput.addEventListener('change', (e) => {
        const file = importHistoryInput.files && importHistoryInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(event) {
            try {
                const imported = JSON.parse(event.target.result);
                if (Array.isArray(imported)) {
                    saveSessions(imported);
                    renderSessionTable();
                    showToast('History imported successfully.');
                } else {
                    showToast('Invalid file format.');
                }
            } catch (err) {
                showToast('Failed to import: ' + err);
            }
        };
        reader.readAsText(file);
    });
}

function showToast(message, timeout = 4000) {
    if (snackbar && snackbar.MaterialSnackbar) {
        snackbar.MaterialSnackbar.showSnackbar({ message, timeout });
    } else if (snackbar) {
        // fallback for late upgrade
        snackbar.querySelector('.mdl-snackbar__text').textContent = message;
        snackbar.classList.add('mdl-snackbar--active');
        setTimeout(() => snackbar.classList.remove('mdl-snackbar--active'), timeout);
    } else {
        alert(message); // fallback
    }
}
