// ============================================================
//  DDoS Educational Simulator - script.js
//  A purely educational tool for classroom demonstrations.
// ============================================================

"use strict";

// ───── CONSTANTS ─────────────────────────────────────────────
const CAPACITY   = 120;
const LEGITIMATE = 40;
const MAX_QUEUE  = 80;

// ───── DOM REFS ──────────────────────────────────────────────
const slider          = document.getElementById("attackSlider");
const sliderFill      = document.getElementById("sliderFill");
const sliderValueDisp = document.getElementById("sliderValueDisplay");

const totalTrafficDisplay = document.getElementById("totalTrafficDisplay");
const queueDisplay        = document.getElementById("queueDisplay");
const attackDisplay       = document.getElementById("attackDisplay");
const servedDisplay       = document.getElementById("servedDisplay");
const deniedDisplay       = document.getElementById("deniedDisplay");
const waitDisplay         = document.getElementById("waitDisplay");
const loadDisplay         = document.getElementById("loadDisplay");

const statusDot        = document.getElementById("statusDot");
const statusText       = document.getElementById("statusText");
const statusBar        = document.getElementById("statusBar");
const botnetCount      = document.getElementById("botnetCount");
const serverStatus     = document.getElementById("serverStatus");
const usersStatus      = document.getElementById("usersStatus");
const usersIcon        = document.getElementById("usersIcon");
const serverIcon       = document.getElementById("serverIcon");

const queueGrid        = document.getElementById("queueGrid");
const queueLabel       = document.getElementById("queueLabel");

const explanationBox   = document.getElementById("explanationBox");
const explanationPhase = document.getElementById("explanationPhase");
const explanationText  = document.getElementById("explanationText");

const canvas = document.getElementById("simCanvas");
const ctx    = canvas.getContext("2d");

// ───── STATE ─────────────────────────────────────────────────
let attackValue = 0;
let packets     = [];
let lastTime    = 0;
let frameId;
let spawnTimer  = 0;
let serverShake = 0;

// ───── BUILD QUEUE GRID ───────────────────────────────────────
function buildQueueGrid() {
    queueGrid.innerHTML = "";
    for (let i = 0; i < MAX_QUEUE; i++) {
        const d = document.createElement("div");
        d.className = "q-box";
        d.id = "qb" + i;
        queueGrid.appendChild(d);
    }
}
buildQueueGrid();

// ───── CANVAS RESIZE ─────────────────────────────────────────
function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width  = rect.width  * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
}
resizeCanvas();
window.addEventListener("resize", () => { resizeCanvas(); });

// ───── UTILITY ───────────────────────────────────────────────
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function getCanvasLogicalSize() {
    return { w: canvas.width / window.devicePixelRatio, h: canvas.height / window.devicePixelRatio };
}

// ───── PACKET CLASS ──────────────────────────────────────────
class Packet {
    constructor(type, fromX, fromY, toX, toY) {
        this.type  = type;  // "attack" | "legit"
        this.x     = fromX;
        this.y     = fromY;
        this.toX   = toX;
        this.toY   = toY;
        this.fX    = fromX;
        this.fY    = fromY;
        this.t     = 0;        // 0..1 progress
        this.speed = type === "attack"
            ? 0.6 + Math.random() * 0.8
            : 0.3 + Math.random() * 0.3;
        this.size  = type === "attack" ? 3 + Math.random() * 2 : 4 + Math.random() * 2;
        this.alive = true;
        // Bezier control point (arc)
        const mx = (fromX + toX) / 2;
        const my = (fromY + toY) / 2;
        const offset = (Math.random() - 0.5) * 80;
        const perp = this.perp(fromX, fromY, toX, toY);
        this.cx = mx + perp.x * offset;
        this.cy = my + perp.y * offset;
    }

    perp(x1, y1, x2, y2) {
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.sqrt(dx*dx + dy*dy) || 1;
        return { x: -dy/len, y: dx/len };
    }

    update(dt) {
        this.t += this.speed * dt;
        if (this.t >= 1) { this.alive = false; return; }
        // Quadratic bezier
        const inv = 1 - this.t;
        this.x = inv*inv*this.fX + 2*inv*this.t*this.cx + this.t*this.t*this.toX;
        this.y = inv*inv*this.fY + 2*inv*this.t*this.cy + this.t*this.t*this.toY;
    }

    draw(ctx) {
        const alpha = clamp(Math.sin(this.t * Math.PI), 0, 1);
        if (this.type === "attack") {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,61,61,${alpha * 0.85})`;
            ctx.shadowColor = "rgba(255,61,61,0.7)";
            ctx.shadowBlur  = 6;
            ctx.fill();
        } else {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(34,216,122,${alpha * 0.9})`;
            ctx.shadowColor = "rgba(34,216,122,0.6)";
            ctx.shadowBlur  = 8;
            ctx.fill();
        }
        ctx.shadowBlur = 0;
    }
}

// ───── NODE POSITIONS ─────────────────────────────────────────
function getNodePositions() {
    const { w, h } = getCanvasLogicalSize();
    return {
        // Botnet cloud – top-left area
        botA: { x: w * 0.06, y: h * 0.20 },
        botB: { x: w * 0.06, y: h * 0.42 },
        botC: { x: w * 0.13, y: h * 0.12 },
        botD: { x: w * 0.13, y: h * 0.55 },
        botE: { x: w * 0.20, y: h * 0.30 },
        // Legit user – bottom-left
        legit: { x: w * 0.10, y: h * 0.82 },
        // Server – center
        server: { x: w * 0.50, y: h * 0.50 },
        // Users – right
        users: { x: w * 0.90, y: h * 0.30 },
    };
}

// ───── DRAW CANVAS ─────────────────────────────────────────
function drawCanvas(attackRate, queueFill) {
    const { w, h } = getCanvasLogicalSize();
    const N = getNodePositions();
    const ratio = clamp(attackRate / CAPACITY, 0, 1);
    const isOverloaded = (attackRate + LEGITIMATE) > CAPACITY;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Background grid
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 0.5;
    const gridSize = 32;
    for (let x = 0; x < w; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.restore();

    // ── Draw connection lines ──
    const bots = [N.botA, N.botB, N.botC, N.botD, N.botE];
    const serverX = N.server.x + (isOverloaded && serverShake > 0 ? (Math.random()-0.5)*4 : 0);
    const serverY = N.server.y + (isOverloaded && serverShake > 0 ? (Math.random()-0.5)*4 : 0);

    if (attackRate > 0) {
        bots.forEach(b => {
            ctx.beginPath();
            ctx.moveTo(b.x, b.y);
            ctx.lineTo(serverX, serverY);
            ctx.strokeStyle = `rgba(255,61,61,${0.06 + ratio * 0.14})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
        });
    }

    // Legit line
    ctx.beginPath();
    ctx.moveTo(N.legit.x, N.legit.y);
    ctx.lineTo(serverX, serverY);
    ctx.strokeStyle = "rgba(34,216,122,0.15)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Server to users
    ctx.beginPath();
    ctx.moveTo(serverX, serverY);
    ctx.lineTo(N.users.x, N.users.y);
    ctx.strokeStyle = isOverloaded ? "rgba(255,61,61,0.1)" : "rgba(34,216,122,0.2)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // ── Draw bots ──
    if (attackRate > 0) {
        bots.forEach((b, i) => {
            const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.003 + i * 1.2);
            ctx.beginPath();
            ctx.arc(b.x, b.y, 7 + pulse * 2, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,61,61,${0.15 + pulse * 0.2})`;
            ctx.fill();

            ctx.beginPath();
            ctx.arc(b.x, b.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = "#ff3d3d";
            ctx.shadowColor = "#ff3d3d";
            ctx.shadowBlur = 12;
            ctx.fill();
            ctx.shadowBlur = 0;

            // Bot label
            ctx.fillStyle = "rgba(255,61,61,0.8)";
            ctx.font = "bold 9px Inter, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("BOT", b.x, b.y + 16);
        });
    }

    // ── Legit user node ──
    const gpulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.002);
    ctx.beginPath();
    ctx.arc(N.legit.x, N.legit.y, 8 + gpulse * 2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(34,216,122,${0.1 + gpulse * 0.1})`;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(N.legit.x, N.legit.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#22d87a";
    ctx.shadowColor = "#22d87a";
    ctx.shadowBlur = 14;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "rgba(34,216,122,0.8)";
    ctx.font = "bold 9px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("USER", N.legit.x, N.legit.y + 18);

    // ── SERVER NODE ──
    const serverLoad = clamp((attackRate + LEGITIMATE) / CAPACITY, 0, 2);
    const crashScale = isOverloaded ? 1 + Math.sin(Date.now() * 0.015) * 0.03 * clamp(serverLoad - 1, 0, 1) : 1;

    // Server glow
    const glowColor = isOverloaded ? `rgba(255,61,61,${0.2 + ratio * 0.3})` : "rgba(76,157,255,0.15)";
    const glowRadius = 32 * crashScale;
    const grad = ctx.createRadialGradient(serverX, serverY, 0, serverX, serverY, glowRadius);
    grad.addColorStop(0, glowColor);
    grad.addColorStop(1, "transparent");
    ctx.beginPath();
    ctx.arc(serverX, serverY, glowRadius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Server body
    const sColor = isOverloaded ? "#ff3d3d" : "#4c9dff";
    ctx.beginPath();
    ctx.arc(serverX, serverY, 18 * crashScale, 0, Math.PI * 2);
    ctx.fillStyle = sColor;
    ctx.shadowColor = sColor;
    ctx.shadowBlur = isOverloaded ? 24 : 16;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Load ring
    ctx.beginPath();
    ctx.arc(serverX, serverY, 22 * crashScale, -Math.PI/2, -Math.PI/2 + Math.PI * 2 * clamp(serverLoad / 2, 0, 1));
    ctx.strokeStyle = isOverloaded ? "#ff3d3d" : "#22d87a";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "bold 8px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("SRV", serverX, serverY + 3);

    // Load % label
    const pct = Math.round(clamp((attackRate + LEGITIMATE) / CAPACITY * 100, 0, 999));
    ctx.fillStyle = isOverloaded ? "rgba(255,100,100,0.9)" : "rgba(255,255,255,0.5)";
    ctx.font = "bold 10px JetBrains Mono, monospace";
    ctx.fillText(pct + "%", serverX, serverY + 38);

    // ── USERS NODE ──
    const userReachable = !isOverloaded || queueFill < 0.5;
    ctx.beginPath();
    ctx.arc(N.users.x, N.users.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = userReachable ? "#22d87a" : "#ef4444";
    ctx.shadowColor = userReachable ? "#22d87a" : "#ef4444";
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = userReachable ? "rgba(34,216,122,0.8)" : "rgba(239,68,68,0.8)";
    ctx.font = "bold 9px Inter, sans-serif";
    ctx.fillText(userReachable ? "ONLINE" : "BLOCKED", N.users.x, N.users.y + 18);

    // ── DRAW PACKETS ──
    ctx.save();
    packets.forEach(p => p.draw(ctx));
    ctx.restore();
}

// ───── SPAWN PACKETS ─────────────────────────────────────────
function spawnPackets(dt, attackRate) {
    const { w, h } = getCanvasLogicalSize();
    const N = getNodePositions();

    spawnTimer += dt;

    const bots = [N.botA, N.botB, N.botC, N.botD, N.botE];

    // Attack packets
    if (attackRate > 0) {
        const rate = clamp(attackRate / 60, 0.05, 4);
        const interval = 1 / rate;
        if (spawnTimer >= interval) {
            const botSrc = bots[Math.floor(Math.random() * bots.length)];
            packets.push(new Packet("attack", botSrc.x, botSrc.y, N.server.x, N.server.y));
            spawnTimer = 0;
        }
    }

    // Legit packets — steady
    if (Math.random() < dt * 0.8) {
        packets.push(new Packet("legit", N.legit.x, N.legit.y, N.server.x, N.server.y));
    }

    // Response packets (server → users) if not fully overloaded
    const overloaded = (attackRate + LEGITIMATE) > CAPACITY * 1.5;
    if (!overloaded && Math.random() < dt * 0.6) {
        packets.push(new Packet("legit", N.server.x, N.server.y, N.users.x, N.users.y));
    }

    // Cap
    if (packets.length > 200) {
        packets = packets.slice(-160);
    }
}

// ───── UPDATE SIMULATION LOGIC ───────────────────────────────
function updateSimulation() {
    const attack     = Number(slider.value);
    attackValue      = attack;
    const total      = attack + LEGITIMATE;
    const overload   = Math.max(0, total - CAPACITY);
    const queueFill  = Math.min(MAX_QUEUE, Math.round(overload / 1.5));
    const denied     = queueFill >= MAX_QUEUE ? Math.max(0, overload - MAX_QUEUE) : 0;
    const served     = Math.min(total, CAPACITY);
    const wait       = queueFill === 0 ? 0 : (queueFill / CAPACITY);
    const loadPct    = Math.round(clamp(total / CAPACITY * 100, 0, 999));
    const qFillRatio = queueFill / MAX_QUEUE;

    // ── Update DOM ──
    sliderValueDisp.textContent   = attack;
    totalTrafficDisplay.textContent = total + " req/s";
    queueDisplay.textContent      = queueFill + " / " + MAX_QUEUE;
    attackDisplay.innerHTML       = attack + ' <small>req/s</small>';
    servedDisplay.innerHTML       = Math.round(served) + ' <small>req/s</small>';
    deniedDisplay.innerHTML       = Math.round(denied) + ' <small>req/s</small>';
    waitDisplay.innerHTML         = wait.toFixed(1) + ' <small>s</small>';
    loadDisplay.textContent       = loadPct + "%";
    sliderFill.style.width        = (attack / 300 * 100) + "%";

    // Botnet count
    const bots = Math.round(attack / 6);
    botnetCount.textContent = attack > 0 ? bots + " bots active" : "Inactive";

    // ── Status bar ──
    statusBar.className = "status-bar";
    statusDot.className = "status-dot";
    if (total <= CAPACITY * 0.7) {
        statusDot.classList.add("dot-normal");
        statusText.textContent = "✅ Server Online — Normal Traffic";
        statusBar.classList.remove("status-warning", "status-danger");
    } else if (total <= CAPACITY) {
        statusDot.classList.add("dot-warning");
        statusText.textContent = "⚠️ Server Under Stress — Queue Building";
        statusBar.classList.add("status-warning");
        statusBar.classList.remove("status-danger");
    } else if (queueFill < MAX_QUEUE) {
        statusDot.classList.add("dot-danger");
        statusText.textContent = "🔴 Server Overloaded — Queue Filling";
        statusBar.classList.add("status-danger");
        statusBar.classList.remove("status-warning");
    } else {
        statusDot.classList.add("dot-danger");
        statusText.textContent = "💥 Server CRASHED — Denying All Requests";
        statusBar.classList.add("status-danger");
        statusBar.classList.remove("status-warning");
    }

    // ── Icons ──
    serverIcon.textContent = denied > 0 ? "💥" : (total > CAPACITY ? "🔥" : "🖥️");
    usersIcon.textContent  = denied > 10 ? "😡" : (total > CAPACITY ? "😰" : "😊");
    serverStatus.textContent = denied > 0 ? "Crashed!" : (total > CAPACITY ? "Overloaded" : "Processing");
    usersStatus.textContent  = denied > 10 ? "Request denied!" : (total > CAPACITY ? "Long wait..." : "Getting response");

    // ── Queue grid ──
    const boxes = queueGrid.children;
    for (let i = 0; i < boxes.length; i++) {
        boxes[i].className = "q-box";
        if (i < queueFill) {
            const attackRatio = clamp((attack) / (total || 1), 0, 1);
            if (i < Math.round(queueFill * attackRatio)) {
                boxes[i].classList.add("q-attack");
            } else {
                boxes[i].classList.add("q-legit");
            }
        }
    }
    queueLabel.textContent = queueFill + " / " + MAX_QUEUE + " slots used";

    // ── Explanation ──
    explanationBox.className = "explanation-box";
    if (total <= CAPACITY && attack === 0) {
        explanationPhase.textContent = "🟢 Phase 1: Normal Operation";
        explanationText.innerHTML = `The server receives <strong>${total} legitimate requests per second</strong> from real users. With a capacity of ${CAPACITY} req/s, it handles all requests instantly with zero wait time. Users get fast responses.`;
    } else if (total <= CAPACITY) {
        explanationPhase.textContent = "🟡 Phase 2: Light Attack Begins";
        explanationText.innerHTML = `${attack} req/s of <strong>attack traffic</strong> joins the ${LEGITIMATE} req/s of legitimate traffic. Total is ${total} req/s — still within the ${CAPACITY} req/s limit, so the server copes, but it is using extra resources to process junk requests.`;
        explanationBox.classList.add("phase-warning");
    } else if (queueFill < MAX_QUEUE) {
        explanationPhase.textContent = "🔴 Phase 3: Server Overloaded";
        explanationText.innerHTML = `Traffic exceeds capacity by <strong>${Math.round(overload)} req/s</strong>! Requests are backing up into a queue (${queueFill}/${MAX_QUEUE} slots). Legitimate users experience delays of <strong>${wait.toFixed(1)}s</strong> while the server struggles to process malicious requests alongside real ones.`;
        explanationBox.classList.add("phase-danger");
    } else {
        explanationPhase.textContent = "💥 Phase 4: Complete Denial of Service";
        explanationText.innerHTML = `The queue is <strong>completely full (${MAX_QUEUE}/${MAX_QUEUE})</strong>. The server is dropping <strong>${Math.round(denied)} requests per second</strong>. Legitimate users cannot reach the server at all — this is the goal of a DDoS attack. The service is effectively OFFLINE.`;
        explanationBox.classList.add("phase-danger");
    }

    return { attack, total, queueFill, qFillRatio, denied, served };
}

// ───── ANIMATION LOOP ─────────────────────────────────────────
function animate(ts) {
    const dt = Math.min((ts - lastTime) / 1000, 0.05);
    lastTime = ts;

    const { attack, total, queueFill, qFillRatio } = updateSimulation();

    // Spawn packets
    spawnPackets(dt, attack);

    // Update packets
    packets = packets.filter(p => p.alive);
    packets.forEach(p => p.update(dt));

    // Server shake
    if (total > CAPACITY) {
        serverShake = clamp((total - CAPACITY) / CAPACITY, 0, 1);
    } else {
        serverShake = 0;
    }

    // Draw
    drawCanvas(attack, qFillRatio);

    frameId = requestAnimationFrame(animate);
}

// ───── SLIDER INPUT ──────────────────────────────────────────
slider.addEventListener("input", () => {
    // Feedback is handled in animate loop
});

// ───── PRESET BUTTONS ────────────────────────────────────────
window.setPreset = function(val) {
    slider.value = val;
};

window.resetSim = function() {
    slider.value = 0;
    packets = [];
};

// ───── START ─────────────────────────────────────────────────
frameId = requestAnimationFrame((ts) => {
    lastTime = ts;
    animate(ts);
});
