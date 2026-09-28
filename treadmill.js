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
const snackbar = document.getElementById('snackbar');

function toMiles(value, unit) {
    if (unit === 'km' || unit === 'kph') return value * KM_TO_MI;
    return value;
}
function mphToProtocol(mph) {
    const kph = Math.min(6, Math.max(1, mph / KM_TO_MI));
    return Math.round(kph * 1000);
}

// --- State ---
let treadmillData = {};
let connected = false;
let runningState = 3; // 0: Starting, 1: Running, 2: Paused, 3: Stopped
let curTargetSpeed = 1000; // in treadmill units
let sessionActive = false;
let sessionLive = false;
let sessionStartData = null;
let selectedDate = startOfDay(new Date());
let statsRange = 'month';

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
                enableControls(true);
                startBtn.textContent = "Pause";
                setStatus('Running');
                break;
            case 2: // Paused
                enableControls(true);
                startBtn.textContent = "Start";
                setStatus('Paused');
                break;
            case 3: // Stopped
                enableControls(true);
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
    const goalProgress = goalWidgetProgress();
    const key = String(connected) + '|' + runningState + '|' + status + '|' + goalProgress;
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
    window.PitPatAndroid.setWidgetState(!!connected, runningState === 1, status, speed, time, calories, distance, preset, goalProgress);
}
function periodSnapshot(range, anchor, grouped) {
    const totals = collectRange(range, anchor, grouped);
    const goal = periodGoal(range, anchor);
    return {
        title: statsHeading(range, anchor),
        seconds: totals.seconds,
        miles: Math.round(totals.miles * 100) / 100,
        goal: Math.round(goal * 10) / 10,
        level: goalLevel(totals.miles, goal),
        calories: Math.round(totals.calories),
        days: totals.days,
        sessions: totals.sessions,
        bars: statsBuckets(range, anchor, grouped).map((bucket) => ({
            label: bucket.label,
            seconds: bucket.seconds,
            miles: Math.round(bucket.miles * 100) / 100,
            goal: Math.round((bucket.goal || 0) * 100) / 100,
            selected: bucket.selected,
            level: bucket.level
        }))
    };
}
function publishStatsSnapshot() {
    if (!window.PitPatAndroid || !window.PitPatAndroid.setStatsSnapshot) return;
    const grouped = groupSessions();
    const today = startOfDay(new Date());
    const payload = JSON.stringify({
        week: periodSnapshot('week', today, grouped)
    });
    if (payload === publishStatsSnapshot.last) return;
    publishStatsSnapshot.last = payload;
    window.PitPatAndroid.setStatsSnapshot(payload);
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

function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}
function addMonths(date, delta) {
    const first = new Date(date.getFullYear(), date.getMonth() + delta, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    return new Date(first.getFullYear(), first.getMonth(), Math.min(date.getDate(), last));
}
function startOfWeek(date) {
    const day = date.getDay();
    const delta = day === 0 ? -6 : 1 - day;
    return addDays(date, delta);
}
function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function dateKey(date) {
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return date.getFullYear() + '-' + m + '-' + d;
}
function parseDateKey(key) {
    const parts = String(key).split('-').map(Number);
    return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
}
function esc(text) {
    return String(text).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}
function loadSessions() {
    try {
        const sessions = JSON.parse(localStorage.getItem('treadmill_sessions') || '[]');
        return Array.isArray(sessions) ? sessions.filter((s) => s && s.date) : [];
    } catch {
        return [];
    }
}
function saveSessions(sessions) {
    localStorage.setItem('treadmill_sessions', JSON.stringify(sessions));
}
function bakeImportedWalk(row) {
    const miles = Math.round(Number(row.m) * 100) / 100;
    const estimate = estimateWalk(miles);
    return {
        date: row.d,
        duration: estimate.seconds,
        steps: estimate.steps,
        calories: estimate.calories + ' kcal',
        avgSpeed: WALK_MPH,
        speedUnit: 'mph',
        distance: miles,
        distanceUnit: 'mi',
        imported: true
    };
}
function importMonthHistory() {
    if (importMonthHistory.started || localStorage.getItem('treadmill_month_import_v1')) return Promise.resolve();
    importMonthHistory.started = true;
    return fetch('sessions.json').then((res) => {
        if (!res.ok) throw new Error('missing import');
        return res.json();
    }).then((rows) => {
        if (!Array.isArray(rows) || !rows.length) return;
        const added = rows.filter((row) => row && row.d && row.m > 0).map(bakeImportedWalk);
        saveSessions(loadSessions().concat(added));
        localStorage.setItem('treadmill_month_import_v1', '1');
    }).catch(() => {
        importMonthHistory.started = false;
    });
}
function saveCurrentSession(session) {
    localStorage.setItem('treadmill_current_session', JSON.stringify(session));
}
function loadCurrentSession() {
    try {
        return JSON.parse(localStorage.getItem('treadmill_current_session')) || null;
    } catch {
        return null;
    }
}
function clearCurrentSession() {
    localStorage.removeItem('treadmill_current_session');
}
function sessionMiles(session) {
    const value = typeof session.distance === 'number' ? session.distance : parseFloat(session.distance);
    if (isNaN(value)) return 0;
    return toMiles(value, session.distanceUnit);
}
function sessionSeconds(session) {
    return typeof session.duration === 'number' && isFinite(session.duration) ? session.duration : 0;
}
function sessionCalories(session) {
    const value = typeof session.calories === 'number' ? session.calories : parseFloat(session.calories);
    return isNaN(value) ? 0 : value;
}
function sessionSteps(session) {
    const value = typeof session.steps === 'number' ? session.steps : parseInt(session.steps, 10);
    return isNaN(value) ? 0 : value;
}
function sessionWhen(session) {
    const t = typeof session.date === 'number' ? session.date : Date.parse(session.date);
    return t && !isNaN(t) ? new Date(t) : null;
}
function formatPace(seconds, miles) {
    if (!(miles > 0.01) || !(seconds > 0)) return '';
    const total = Math.round(seconds / miles);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ':' + String(s).padStart(2, '0') + ' /mi';
}
function groupSessions() {
    const map = new Map();
    loadSessions().forEach((session) => {
        const when = sessionWhen(session);
        if (!when) return;
        const key = dateKey(when);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(session);
    });
    map.forEach((list) => list.sort((a, b) => b.date - a.date));
    return map;
}
function currentSessionRecord() {
    const count = sessionStartData.speedCount || 1;
    const rawAvg = (sessionStartData.speedSum || 0) / count / 1000;
    return {
        date: sessionStartData.date,
        duration: sessionStartData.duration || 0,
        steps: sessionStartData.steps || 0,
        calories: (sessionStartData.calories || 0) + ' kcal',
        avgSpeed: toMiles(rawAvg, sessionStartData.speedUnit),
        speedUnit: 'mph',
        distance: toMiles((sessionStartData.distance || 0) / 1000, sessionStartData.distanceUnit),
        distanceUnit: 'mi'
    };
}
function upsertSession(session) {
    const sessions = loadSessions();
    const idx = sessions.findIndex((s) => s.date === session.date);
    if (idx >= 0) sessions[idx] = session;
    else sessions.unshift(session);
    saveSessions(sessions);
}
function absorbWalk(sample, countSpeed) {
    const durationSec = Math.round((sample.durationMs || 0) / 1000);
    sessionStartData.steps = Math.max(sessionStartData.steps || 0, sample.steps || 0);
    sessionStartData.calories = Math.max(sessionStartData.calories || 0, sample.calories || 0);
    sessionStartData.distance = Math.max(sessionStartData.distance || 0, sample.distance || 0);
    sessionStartData.duration = Math.max(sessionStartData.duration || 0, durationSec);
    if (sample.distance_unit) sessionStartData.distanceUnit = sample.distance_unit;
    if (countSpeed) {
        sessionStartData.speedSum = (sessionStartData.speedSum || 0) + (sample.current_speed || 0);
        sessionStartData.speedCount = (sessionStartData.speedCount || 0) + 1;
        sessionStartData.speedUnit = sample.speed_unit;
    }
    sessionStartData.updatedAt = Date.now();
}
function commitWalk(force) {
    if (!sessionStartData) return;
    const now = Date.now();
    if (!force && now - (commitWalk.lastAt || 0) < 2000) return;
    commitWalk.lastAt = now;
    upsertSession(currentSessionRecord());
    renderHistory();
}
function finishWalk() {
    if (!sessionActive || !sessionStartData) return;
    const record = currentSessionRecord();
    sessionActive = false;
    sessionLive = false;
    sessionStartData = null;
    clearCurrentSession();
    const keep = (record.duration || 0) >= 1 || sessionMiles(record) >= 0.001;
    if (keep) upsertSession(record);
    else saveSessions(loadSessions().filter((s) => s.date !== record.date));
    renderHistory();
}
function suspendWalk() {
    if (!sessionActive || !sessionStartData) return;
    sessionLive = false;
    saveCurrentSession(sessionStartData);
    commitWalk(true);
}
function trackWalk(sample) {
    const state = sample.running_state;
    const durationSec = Math.round((sample.durationMs || 0) / 1000);
    if (sessionActive && sessionStartData && state === 1 && durationSec + 2 < (sessionStartData.duration || 0)) {
        finishWalk();
    }
    if (state === 1 && !sessionActive) {
        sessionActive = true;
        sessionLive = true;
        sessionStartData = {
            date: Date.now(),
            steps: sample.steps || 0,
            calories: sample.calories || 0,
            distance: sample.distance || 0,
            duration: durationSec,
            speedSum: sample.current_speed || 0,
            speedCount: 1,
            speedUnit: sample.speed_unit,
            distanceUnit: sample.distance_unit,
            updatedAt: Date.now()
        };
        saveCurrentSession(sessionStartData);
        commitWalk(true);
        return;
    }
    if (!sessionActive || !sessionStartData) return;
    if (state === 1 || state === 2) {
        sessionLive = true;
        absorbWalk(sample, state === 1);
        saveCurrentSession(sessionStartData);
        commitWalk(false);
        return;
    }
    if (state === 3) {
        absorbWalk(sample, false);
        finishWalk();
    }
}
function loadDayMiles() {
    try {
        const data = JSON.parse(localStorage.getItem('treadmill_day_miles') || '{}');
        return data && typeof data === 'object' ? data : {};
    } catch {
        return {};
    }
}
function goalWidgetProgress() {
    const goal = loadDailyGoal();
    if (!(goal > 0)) return 0;
    const today = dateKey(new Date());
    const sessions = loadSessions().filter((session) => {
        const when = sessionWhen(session);
        return when && dateKey(when) === today;
    });
    if (sessionActive && sessionStartData && dateKey(new Date(sessionStartData.date)) === today) {
        const live = currentSessionRecord();
        const idx = sessions.findIndex((session) => session.date === live.date);
        if (idx >= 0) sessions[idx] = live;
        else sessions.push(live);
    }
    const miles = milesForDay(today, sumSessions(sessions).miles);
    return Math.max(0, Math.min(1000, Math.round((miles / goal) * 1000)));
}
function milesForDay(key, recorded) {
    const stored = loadDayMiles()[key];
    const value = typeof stored === 'number' ? stored : parseFloat(stored);
    return isFinite(value) && value >= 0 ? value : recorded;
}
function setDayMiles(key, miles) {
    const map = loadDayMiles();
    if (miles === null) delete map[key];
    else map[key] = miles;
    localStorage.setItem('treadmill_day_miles', JSON.stringify(map));
}
const WALK_MPH = 2.5;
const WALK_MET = 3;
const STEPS_PER_MILE = 2200;
const LB_TO_KG = 0.45359237;

function loadWeightLb() {
    const value = parseFloat(localStorage.getItem('treadmill_weight_lb'));
    return isFinite(value) && value > 0 ? value : 176;
}
function estimateWalk(miles) {
    const hours = (miles || 0) / WALK_MPH;
    const kg = loadWeightLb() * LB_TO_KG;
    return {
        seconds: Math.round(hours * 3600),
        calories: Math.round(WALK_MET * kg * hours),
        steps: Math.round((miles || 0) * STEPS_PER_MILE)
    };
}
function dayFigures(key, part) {
    const miles = milesForDay(key, part.miles);
    const overridden = Object.prototype.hasOwnProperty.call(loadDayMiles(), key);
    if (!overridden) return { miles, seconds: part.seconds, calories: part.calories, steps: part.steps, estimated: false };
    const estimate = estimateWalk(miles);
    return { miles, seconds: estimate.seconds, calories: estimate.calories, steps: estimate.steps, estimated: true };
}
function loadDailyGoal() {
    const value = parseFloat(localStorage.getItem('treadmill_daily_goal_mi'));
    return isFinite(value) && value > 0 ? value : 2;
}
function goalLevel(miles, goal) {
    if (!(goal > 0) || !(miles >= goal / 2)) return '';
    return miles >= goal ? 'met' : 'half';
}
function ringHtml(level) {
    const cls = 'ring' + (level ? ' is-' + level : '');
    return '<svg class="' + cls + '" viewBox="0 0 36 36" aria-hidden="true"><circle class="track" cx="18" cy="18" r="14"></circle><circle class="fill" cx="18" cy="18" r="14"></circle></svg>';
}
function sumSessions(list) {
    return list.reduce((acc, session) => {
        acc.miles += sessionMiles(session);
        acc.seconds += sessionSeconds(session);
        acc.calories += sessionCalories(session);
        acc.steps += sessionSteps(session);
        return acc;
    }, { miles: 0, seconds: 0, calories: 0, steps: 0 });
}
function renderHistory() {
    const grouped = groupSessions();
    const period = collectRange(statsRange, selectedDate, grouped);
    const target = periodGoal(statsRange, selectedDate);
    const periodLevel = goalLevel(period.miles, target);
    const dayCard = document.getElementById('dayCard');
    if (dayCard) dayCard.hidden = false;
    const dayList = grouped.get(dateKey(selectedDate)) || [];
    const figures = dayFigures(dateKey(selectedDate), sumSessions(dayList));
    const dayDateInput = document.getElementById('dayDateInput');
    const dayMilesInput = document.getElementById('dayMilesInput');
    const dayTime = document.getElementById('dayTime');
    const dayCalories = document.getElementById('dayCalories');
    const daySteps = document.getElementById('daySteps');
    if (dayDateInput && document.activeElement !== dayDateInput) dayDateInput.value = dateKey(selectedDate);
    if (dayMilesInput && document.activeElement !== dayMilesInput) dayMilesInput.value = figures.miles.toFixed(2);
    if (dayTime) dayTime.textContent = widgetClock(figures.seconds);
    if (dayCalories) dayCalories.textContent = Math.round(figures.calories).toLocaleString();
    if (daySteps) daySteps.textContent = Math.round(figures.steps).toLocaleString();
    const dayEstimate = document.getElementById('dayEstimate');
    if (dayEstimate) dayEstimate.hidden = !figures.estimated;
    const life = statsRange === 'total';
    const goalNames = { week: 'Week goal', month: 'Month goal', year: 'Year goal' };
    const goalLabel = document.getElementById('goalLabel');
    const goalProgress = document.getElementById('goalProgress');
    const goalInput = document.getElementById('goalInput');
    const goalTrack = document.getElementById('goalTrack');
    if (goalLabel) goalLabel.textContent = life ? 'All time' : (goalNames[statsRange] || 'Goal');
    if (goalProgress) {
        goalProgress.textContent = life ? period.miles.toFixed(2) + ' mi' : period.miles.toFixed(2) + ' / ' + target.toFixed(1) + ' mi';
        goalProgress.classList.toggle('is-half', !life && periodLevel === 'half');
        goalProgress.classList.toggle('is-met', !life && periodLevel === 'met');
    }
    if (goalTrack) goalTrack.hidden = life;
    if (goalInput && document.activeElement !== goalInput) goalInput.value = loadDailyGoal().toFixed(1);
    const weightInput = document.getElementById('weightInput');
    if (weightInput && document.activeElement !== weightInput) weightInput.value = String(loadWeightLb());
    const goalFill = document.getElementById('goalFill');
    if (goalFill) {
        const pct = !life && target > 0 ? Math.max(0, Math.min(100, (period.miles / target) * 100)) : 0;
        goalFill.style.width = pct + '%';
        goalFill.classList.toggle('is-half', periodLevel === 'half');
        goalFill.classList.toggle('is-met', periodLevel === 'met');
    }
    publishWidget();
    publishStatsSnapshot();
    renderStats(grouped);
}
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEK_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function dateInStatsRange(date, range, anchor) {
    if (range === 'total') return true;
    if (range === 'day') return sameDay(date, anchor);
    if (range === 'week') {
        const start = startOfWeek(anchor);
        return date >= start && date < addDays(start, 7);
    }
    if (range === 'month') return date.getFullYear() === anchor.getFullYear() && date.getMonth() === anchor.getMonth();
    return date.getFullYear() === anchor.getFullYear();
}
function clampDay(year, month, day) {
    const last = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(day, last));
}
function collectRange(range, anchor, grouped) {
    const keys = new Set([...grouped.keys(), ...Object.keys(loadDayMiles())]);
    const totals = { miles: 0, seconds: 0, calories: 0, steps: 0, sessions: 0, days: 0 };
    keys.forEach((key) => {
        const date = parseDateKey(key);
        if (!dateInStatsRange(date, range, anchor)) return;
        const list = grouped.get(key) || [];
        const part = sumSessions(list);
        const figures = dayFigures(key, part);
        totals.miles += figures.miles;
        totals.seconds += figures.seconds;
        totals.calories += figures.calories;
        totals.steps += figures.steps;
        totals.sessions += list.length;
        if (figures.miles > 0 || list.length > 0) totals.days += 1;
    });
    return totals;
}
function formatClockLong(seconds) {
    seconds = Math.max(0, Math.floor(seconds) || 0);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}
function daysInMonthDate(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}
function daysInYearDate(date) {
    const year = date.getFullYear();
    return new Date(year, 1, 29).getDate() === 29 ? 366 : 365;
}
function periodGoal(range, anchor) {
    const daily = loadDailyGoal();
    if (range === 'week') return daily * 7;
    if (range === 'month') return daily * daysInMonthDate(anchor);
    if (range === 'year') return daily * daysInYearDate(anchor);
    return daily;
}
function sumDayList(dates, grouped) {
    const totals = { miles: 0, seconds: 0, calories: 0, steps: 0, sessions: 0, days: 0 };
    dates.forEach((date) => {
        const key = dateKey(date);
        const list = grouped.get(key) || [];
        const figures = dayFigures(key, sumSessions(list));
        totals.miles += figures.miles;
        totals.seconds += figures.seconds;
        totals.calories += figures.calories;
        totals.steps += figures.steps;
        totals.sessions += list.length;
        if (figures.miles > 0 || list.length > 0) totals.days += 1;
    });
    return totals;
}
function chartBar(date, label, selected, totals, goal) {
    return {
        date,
        label,
        selected,
        seconds: totals.seconds,
        miles: totals.miles,
        goal,
        level: goalLevel(totals.miles, goal)
    };
}
function statsBuckets(range, anchor, grouped) {
    const daily = loadDailyGoal();
    if (range === 'week') {
        const start = startOfWeek(anchor);
        return Array.from({ length: 7 }, (_, i) => {
            const date = addDays(start, i);
            return chartBar(date, WEEK_LABELS[i], sameDay(date, anchor), collectRange('day', date, grouped), daily);
        });
    }
    if (range === 'month') {
        const year = anchor.getFullYear();
        const month = anchor.getMonth();
        const monthEnd = new Date(year, month + 1, 1);
        const selectedWeek = startOfWeek(anchor);
        const bars = [];
        let cursor = startOfWeek(new Date(year, month, 1));
        while (cursor < monthEnd) {
            const days = [];
            for (let i = 0; i < 7; i++) {
                const date = addDays(cursor, i);
                if (date.getFullYear() === year && date.getMonth() === month) days.push(date);
            }
            bars.push(chartBar(days[0], String(days[0].getDate()), sameDay(cursor, selectedWeek), sumDayList(days, grouped), daily * days.length));
            cursor = addDays(cursor, 7);
        }
        return bars;
    }
    const year = anchor.getFullYear();
    return MONTH_LABELS.map((label, month) => {
        const date = new Date(year, month, 1);
        return chartBar(date, label, month === anchor.getMonth(), collectRange('month', date, grouped), daily * daysInMonthDate(date));
    });
}
function statsHeading(range, anchor) {
    if (range === 'total') return 'All time';
    if (range === 'year') return String(anchor.getFullYear());
    if (range === 'month') return anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    if (range === 'day') return anchor.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const start = startOfWeek(anchor);
    const end = addDays(start, 6);
    const left = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const right = end.toLocaleDateString(undefined, start.getMonth() === end.getMonth() ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
    return left + ' – ' + right;
}
function renderStats(grouped) {
    const grid = document.getElementById('statsGrid');
    const chart = document.getElementById('statsChart');
    const title = document.getElementById('statsTitle');
    if (!grid || !chart || !title) return;
    if (!grouped) grouped = groupSessions();
    document.querySelectorAll('.range-tab').forEach((tab) => {
        tab.classList.toggle('is-selected', tab.dataset.range === statsRange);
    });
    document.querySelectorAll('[data-stats]').forEach((btn) => { btn.hidden = statsRange === 'total'; });
    title.textContent = statsHeading(statsRange, selectedDate);
    const totals = collectRange(statsRange, selectedDate, grouped);
    grid.innerHTML = [
        ['Duration', formatClockLong(totals.seconds)],
        ['Distance', totals.miles.toFixed(2) + ' mi'],
        ['Calories', Math.round(totals.calories).toLocaleString() + ' kcal'],
        ['Days', String(totals.days)],
        ['Sessions', String(totals.sessions)]
    ].map(([label, value]) => '<div><span class="metric-label">' + label + '</span><span class="stats-value">' + esc(value) + '</span></div>').join('');
    if (statsRange === 'total') {
        chart.hidden = true;
        chart.innerHTML = '';
    } else {
        chart.hidden = false;
        const buckets = statsBuckets(statsRange, selectedDate, grouped);
        const scale = Math.max(0.01, ...buckets.map((bucket) => Math.max(bucket.miles, bucket.goal || 0)));
        chart.innerHTML = '<div class="chart-plot">' + buckets.map((bucket) => {
            const height = bucket.miles <= 0 ? 0 : Math.max(4, Math.round((bucket.miles / scale) * 108));
            const level = bucket.level ? ' is-' + bucket.level : '';
            const tip = bucket.miles.toFixed(1) + ' mi';
            return '<button type="button" class="chart-col' + (bucket.selected ? ' is-selected' : '') + '" data-bucket="' + dateKey(bucket.date) + '">' +
                '<span class="chart-track"><span class="chart-tip' + level + '">' + tip + '</span>' +
                '<span class="chart-bar' + level + '" style="height:' + height + 'px"></span></span>' +
                '<span class="chart-label">' + esc(bucket.label) + '</span></button>';
        }).join('') + '</div>';
    }
}
function onStatsClick(event) {
    const button = event.target.closest('[data-range], [data-stats], [data-bucket], [data-day]');
    if (!button) return;
    if (button.dataset.range) {
        statsRange = button.dataset.range;
    } else if (button.dataset.stats === 'prev' || button.dataset.stats === 'next') {
        if (statsRange === 'total') {
            renderHistory();
            return;
        }
        const dir = button.dataset.stats === 'prev' ? -1 : 1;
        if (statsRange === 'week') selectedDate = addDays(selectedDate, dir * 7);
        else if (statsRange === 'year') selectedDate = clampDay(selectedDate.getFullYear() + dir, selectedDate.getMonth(), selectedDate.getDate());
        else selectedDate = addMonths(selectedDate, dir);
    } else if (button.dataset.day === 'prev' || button.dataset.day === 'next') {
        selectedDate = addDays(selectedDate, button.dataset.day === 'prev' ? -1 : 1);
    } else if (button.dataset.bucket) {
        selectedDate = parseDateKey(button.dataset.bucket);
    }
    renderHistory();
}
function showStatsMonth(key) {
    const date = parseDateKey(key);
    if (!date || isNaN(date.getTime())) return;
    selectedDate = startOfDay(date);
    statsRange = 'month';
    renderHistory();
}
window.showStatsMonth = showStatsMonth;

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
            device = await navigator.bluetooth.requestDevice({
                filters: [{ services: [SERVICE_UUID] }],
                services: [SERVICE_UUID]
            });
            device.addEventListener('gattserverdisconnected', () => onDisconnected());
            const server = await device.gatt.connect();
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
    suspendWalk();
    connected = false;
    setStatus('Disconnected');
    connectBtn.textContent = "Connect";
    updateRunningState(3);
}

function packetHex(bytes) {
    const out = [];
    const len = typeof bytes.getUint8 === 'function' ? bytes.byteLength : bytes.length;
    for (let i = 0; i < len; i++) {
        const b = typeof bytes.getUint8 === 'function' ? bytes.getUint8(i) : bytes[i];
        out.push(b.toString(16).padStart(2, '0'));
    }
    return out.join(' ');
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

function handleNotification(value) {
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
    updateDashboard(treadmillData);
    updateRunningState(running_state);
    trackWalk({
        running_state,
        steps,
        calories,
        distance,
        durationMs: duration,
        current_speed,
        speed_unit,
        distance_unit
    });

    const link = beltTransport();
    if (link.canWrite()) {
        if (pendingData) {
            const packet = pendingData;
            link.write(packet).then(() => {
                pendingData = null;
            }).catch(err => {
                console.error("Failed to send pending data:", err);
            });
        } else {
            // Heartbeat packet: 6a05fdf843
            const heartbeat = new Uint8Array([0x6a, 0x05, 0xfd, 0xf8, 0x43]);
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
    connectBtn.textContent = "Disconnect";
    updateRunningState(3);
}
function onAndroidDisconnected() {
    suspendWalk();
    connected = false;
    connectBtn.textContent = "Connect";
    updateRunningState(3);
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
const restoredWalk = loadCurrentSession();
if (restoredWalk && restoredWalk.date && Date.now() - (restoredWalk.updatedAt || restoredWalk.date) < 3 * 60 * 1000) {
    sessionActive = true;
    sessionLive = false;
    sessionStartData = restoredWalk;
}
const statsEl = document.getElementById('stats');
if (statsEl) statsEl.addEventListener('click', onStatsClick);
const dayMilesEl = document.getElementById('dayMilesInput');
const dayDateEl = document.getElementById('dayDateInput');
if (dayDateEl) {
    dayDateEl.addEventListener('change', () => {
        const date = parseDateKey(dayDateEl.value);
        if (!date || isNaN(date.getTime())) {
            renderHistory();
            return;
        }
        selectedDate = startOfDay(date);
        renderHistory();
    });
}
if (dayMilesEl) {
    dayMilesEl.addEventListener('change', () => {
        const key = dateKey(selectedDate);
        const raw = dayMilesEl.value.trim();
        if (raw === '') {
            setDayMiles(key, null);
        } else {
            const value = Math.round(parseFloat(raw) * 100) / 100;
            if (!isFinite(value) || value < 0) {
                renderHistory();
                return;
            }
            setDayMiles(key, value);
        }
        renderHistory();
    });
}
const weightInputEl = document.getElementById('weightInput');
if (weightInputEl) {
    weightInputEl.addEventListener('change', () => {
        const value = Math.round(parseFloat(weightInputEl.value));
        if (!isFinite(value) || value <= 0) {
            weightInputEl.value = String(loadWeightLb());
            return;
        }
        localStorage.setItem('treadmill_weight_lb', String(value));
        renderHistory();
    });
}
const goalInputEl = document.getElementById('goalInput');
if (goalInputEl) {
    goalInputEl.addEventListener('change', () => {
        const value = Math.round(parseFloat(goalInputEl.value) * 10) / 10;
        if (!isFinite(value) || value <= 0) {
            goalInputEl.value = loadDailyGoal().toFixed(1);
            return;
        }
        localStorage.setItem('treadmill_daily_goal_mi', String(value));
        renderHistory();
    });
}
renderHistory();
importMonthHistory().then(() => renderHistory());
window.addEventListener('pagehide', () => {
    if (sessionActive && sessionStartData) {
        saveCurrentSession(sessionStartData);
        commitWalk(true);
    }
});

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
