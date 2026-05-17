import * as THREE from './node_modules/three/build/three.module.js';

let socket = null;
let myPlayerId = null;
let myPlayerName = 'Player';
let currentRoomId = null;
let threeScene = null;
let onHitReceivedCb = null;
let threeListener = null;
let remoteFootstepBuffer = null;
let pieceWallBoxes = [];
let amIHost = false;
let roomMode = 'ffa';

export function setWallBoxes(boxes) { pieceWallBoxes = boxes; }

const playerNames = new Map();
const playerStats = new Map(); // id -> { kills, deaths }

export function getRemotePlayerPositions() {
    const positions = [];
    remotePlayers.forEach(data => {
        if (!data.dying) positions.push(data.group.position.clone());
    });
    return positions;
}

export function getLeaderboardData() {
    const rows = [];
    if (myPlayerId) {
        const s = playerStats.get(myPlayerId) || { kills: 0, deaths: 0 };
        rows.push({ id: myPlayerId, name: myPlayerName, kills: s.kills, deaths: s.deaths, isLocal: true, color: colorToCss(colorForId(myPlayerId)) });
    }
    remotePlayers.forEach((_, id) => {
        const s = playerStats.get(id) || { kills: 0, deaths: 0 };
        rows.push({ id, name: playerNames.get(id) || 'Player', kills: s.kills, deaths: s.deaths, isLocal: false, color: colorToCss(colorForId(id)) });
    });
    rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    return rows;
}

export function initRemoteAudio(listener, buffer) {
    threeListener = listener;
    remoteFootstepBuffer = buffer;
}

let remoteFootstepVolume = 1.0;
export function setRemoteFootstepVolume(val) {
    remoteFootstepVolume = val;
    remotePlayers.forEach(data => {
        if (data.footstepAudio) data.footstepAudio.setVolume(val);
    });
}

// id -> { group, targetPos, targetYaw, muzzleFlash, muzzleTimer }
const remotePlayers = new Map();

// Flying explosion pieces  { mesh, velocity, angularVel, timer, duration }
const explodingPieces = [];

// ---- Player colours ----
const PLAYER_COLORS = [0xe74c3c, 0xe67e22, 0x9b59b6, 0x1abc9c]; // red, orange, purple, teal

function colorForId(id) {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) & 0xffffffff;
    return PLAYER_COLORS[Math.abs(hash) % PLAYER_COLORS.length];
}

// ---- Shared muzzle flash texture (lazy) ----
let _muzzleTex = null;
function getMuzzleTex() {
    if (_muzzleTex) return _muzzleTex;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,200,1)');
    g.addColorStop(0.3, 'rgba(255,180,60,0.85)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    _muzzleTex = new THREE.CanvasTexture(canvas);
    return _muzzleTex;
}

// ---- Remote player mesh ----
function createPlayerMesh(name, color) {
    const group = new THREE.Group();

    const bodyMat = new THREE.MeshLambertMaterial({ color });
    const legMat  = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.5) });
    const skinMat = new THREE.MeshLambertMaterial({ color: 0xf5cba7 });
    const gunMat  = new THREE.MeshLambertMaterial({ color: 0x252525 });

    function mesh(geo, mat, x, y, z, rx = 0) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        if (rx) m.rotation.x = rx;
        m.castShadow = true;
        group.add(m);
        return m;
    }

    // Legs (darker pants shade)
    mesh(new THREE.BoxGeometry(0.26, 0.75, 0.26), legMat, -0.16, 0.375, 0);
    mesh(new THREE.BoxGeometry(0.26, 0.75, 0.26), legMat,  0.16, 0.375, 0);

    // Torso
    mesh(new THREE.BoxGeometry(0.58, 0.8, 0.28), bodyMat, 0, 1.15, 0);

    // Left arm — hanging naturally
    mesh(new THREE.BoxGeometry(0.22, 0.7, 0.22), bodyMat, -0.42, 1.1, 0);

    // Right arm — tilted forward to hold the gun
    mesh(new THREE.BoxGeometry(0.22, 0.65, 0.22), bodyMat, 0.38, 1.26, -0.14, -1.1);

    // Head
    const headMesh = mesh(new THREE.SphereGeometry(0.27, 12, 12), skinMat, 0, 1.73, 0);
    headMesh.userData.isHead = true;

    // Gun proxy parented to a sub-group so muzzle flash inherits its position
    const gunGroup = new THREE.Group();
    gunGroup.position.set(0.34, 1.05, -0.55);
    group.add(gunGroup);

    // Slide (top of pistol)
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.09, 0.22), gunMat);
    slide.position.set(0, 0.03, -0.04);
    gunGroup.add(slide);

    // Barrel (extends forward from slide)
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.3), gunMat);
    barrel.position.set(0, 0.025, -0.15);
    gunGroup.add(barrel);

    // Grip (handle below slide)
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.14, 0.08), gunMat);
    grip.position.set(0, -0.065, 0.05);
    gunGroup.add(grip);

    // Muzzle flash at barrel tip
    const muzzleFlash = new THREE.Sprite(new THREE.SpriteMaterial({
        map: getMuzzleTex(),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    }));
    muzzleFlash.position.set(0, 0.025, -0.32);
    muzzleFlash.scale.set(0.38, 0.38, 0.38);
    muzzleFlash.visible = false;
    gunGroup.add(muzzleFlash);

    // Name label sprite above head
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(4, 8, 248, 48, 6);
    else ctx.rect(4, 8, 248, 48);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((name || 'Player').slice(0, 12), 128, 32);
    const tex = new THREE.CanvasTexture(canvas);
    const label = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    label.position.y = 2.35;
    label.scale.set(1.4, 0.35, 1);
    group.add(label);

    return { group, muzzleFlash };
}

function addRemotePlayer(state) {
    if (remotePlayers.has(state.id)) return;
    playerNames.set(state.id, state.name || 'Player');
    if (!playerStats.has(state.id)) playerStats.set(state.id, { kills: 0, deaths: 0 });
    const color = colorForId(state.id);
    const { group, muzzleFlash } = createPlayerMesh(state.name, color);
    const y = (state.position?.y ?? 2) - 1.9;
    group.position.set(state.position?.x ?? 0, y, state.position?.z ?? 0);
    group.rotation.y = state.yaw ?? 0;
    threeScene.add(group);
    let footstepCarrier = null;
    let footstepAudio = null;
    if (threeListener && remoteFootstepBuffer) {
        footstepCarrier = new THREE.Object3D();
        footstepCarrier.position.copy(group.position);
        threeScene.add(footstepCarrier);
        footstepAudio = new THREE.PositionalAudio(threeListener);
        footstepAudio.setBuffer(remoteFootstepBuffer);
        footstepAudio.setLoop(true);
        footstepAudio.setVolume(remoteFootstepVolume);
        footstepAudio.setRefDistance(3);
        footstepAudio.setRolloffFactor(2);
        footstepCarrier.add(footstepAudio);
    }

    remotePlayers.set(state.id, {
        group,
        targetPos: new THREE.Vector3(group.position.x, group.position.y, group.position.z),
        targetYaw: state.yaw ?? 0,
        muzzleFlash,
        muzzleTimer: 0,
        dying: false,
        dyingTimer: 0,
        exploded: false,
        footstepCarrier,
        footstepAudio,
        prevPos: group.position.clone(),
    });
    refreshPlayerCount();
}

function removeRemotePlayer(id) {
    const data = remotePlayers.get(id);
    if (!data) return;
    data.group.traverse(child => {
        if (child.isMesh) { child.geometry.dispose(); child.material.dispose(); }
        if (child.isSprite) { child.material.map?.dispose(); child.material.dispose(); }
    });
    if (data.footstepAudio) { data.footstepAudio.stop(); data.footstepAudio.disconnect(); }
    if (data.footstepCarrier) threeScene.remove(data.footstepCarrier);
    threeScene.remove(data.group);
    remotePlayers.delete(id);
    playerNames.delete(id);
    playerStats.delete(id);
    refreshPlayerCount();
}

// ---- Per-frame update (call from animate loop) ----
export function updateRemotePlayers(delta) {
    const lf = Math.min(1, 15 * delta);
    remotePlayers.forEach(data => {
        if (data.dying) {
            if (!data.exploded) {
                // Fallback tip animation (shouldn't normally run with explosion on)
                data.dyingTimer += delta;
                const t = Math.min(1, data.dyingTimer / 1.0);
                data.group.rotation.x = t * Math.PI / 2;
                data.group.position.y = data.targetPos.y - t * 0.6;
                if (data.dyingTimer > 1.5) data.group.visible = false;
            }
            return;
        }

        data.group.position.lerp(data.targetPos, lf);
        data.group.rotation.y += (data.targetYaw - data.group.rotation.y) * lf;

        if (data.muzzleTimer > 0) {
            data.muzzleTimer -= delta;
            if (data.muzzleTimer <= 0) {
                data.muzzleTimer = 0;
                data.muzzleFlash.visible = false;
            }
        }

        // Positional footsteps — follow group, play only while moving
        if (data.footstepCarrier) data.footstepCarrier.position.copy(data.group.position);
        if (data.footstepAudio) {
            const moved = data.group.position.distanceTo(data.prevPos);
            const isMoving = moved > 0.005;
            if (isMoving && !data.footstepAudio.isPlaying) data.footstepAudio.play();
            else if (!isMoving && data.footstepAudio.isPlaying) data.footstepAudio.stop();
        }
        data.prevPos = data.group.position.clone();
    });

    // Animate flying explosion pieces
    const PIECE_R = 0.13;
    const FLOOR_Y = 0.1;
    for (let i = explodingPieces.length - 1; i >= 0; i--) {
        const p = explodingPieces[i];
        p.timer += delta;
        const t = p.timer / p.duration;

        p.velocity.y -= 14 * delta; // gravity

        const next = p.mesh.position.clone().addScaledVector(p.velocity, delta);

        // Floor bounce
        if (next.y < FLOOR_Y) {
            next.y = FLOOR_Y;
            p.velocity.y = Math.abs(p.velocity.y) * 0.35;
            p.velocity.x *= 0.72;
            p.velocity.z *= 0.72;
            p.angularVel.multiplyScalar(0.45);
        }

        // Wall bounce
        for (const box of pieceWallBoxes) {
            const ox = next.x, oy = next.y, oz = next.z;
            if (ox + PIECE_R <= box.min.x || ox - PIECE_R >= box.max.x) continue;
            if (oy + PIECE_R <= box.min.y || oy - PIECE_R >= box.max.y) continue;
            if (oz + PIECE_R <= box.min.z || oz - PIECE_R >= box.max.z) continue;

            const dxPos = (ox + PIECE_R) - box.min.x;
            const dxNeg = box.max.x - (ox - PIECE_R);
            const dyPos = (oy + PIECE_R) - box.min.y;
            const dyNeg = box.max.y - (oy - PIECE_R);
            const dzPos = (oz + PIECE_R) - box.min.z;
            const dzNeg = box.max.z - (oz - PIECE_R);

            const minX = Math.min(dxPos, dxNeg);
            const minY = Math.min(dyPos, dyNeg);
            const minZ = Math.min(dzPos, dzNeg);

            if (minX <= minY && minX <= minZ) {
                next.x += dxPos < dxNeg ? -dxPos : dxNeg;
                p.velocity.x = -p.velocity.x * 0.4;
                p.velocity.y *= 0.85; p.velocity.z *= 0.85;
            } else if (minZ <= minX && minZ <= minY) {
                next.z += dzPos < dzNeg ? -dzPos : dzNeg;
                p.velocity.z = -p.velocity.z * 0.4;
                p.velocity.x *= 0.85; p.velocity.y *= 0.85;
            } else {
                next.y += dyPos < dyNeg ? -dyPos : dyNeg;
                p.velocity.y = -p.velocity.y * 0.35;
                p.velocity.x *= 0.85; p.velocity.z *= 0.85;
            }
            p.angularVel.multiplyScalar(0.6);
        }

        p.mesh.position.copy(next);
        p.mesh.rotation.x += p.angularVel.x * delta;
        p.mesh.rotation.y += p.angularVel.y * delta;
        p.mesh.rotation.z += p.angularVel.z * delta;
        p.mesh.material.opacity = Math.max(0, 1 - t * t);

        if (t >= 1) {
            threeScene.remove(p.mesh);
            p.mesh.material.dispose();
            explodingPieces.splice(i, 1);
        }
    }
}

// ---- Chat ----
function colorToCss(num) {
    return '#' + num.toString(16).padStart(6, '0');
}

const MAX_CHAT_MSGS = 60;

function appendChatMessage({ system, id, name, text }) {
    const el = document.getElementById('chat-messages');
    if (!el) return;

    const div = document.createElement('div');
    div.className = 'chat-msg' + (system ? ' chat-sys' : '');

    if (system) {
        div.textContent = text;
    } else {
        const color = id ? colorToCss(colorForId(id)) : '#fff';
        const nameSpan = document.createElement('span');
        nameSpan.style.color = color;
        nameSpan.style.fontWeight = '700';
        nameSpan.textContent = (name || 'Player') + ': ';
        div.appendChild(nameSpan);
        div.appendChild(document.createTextNode(text));
    }

    el.appendChild(div);
    // Trim old messages
    while (el.children.length > MAX_CHAT_MSGS) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
}

export function broadcastChat(text) {
    if (!socket || !currentRoomId) return;
    const trimmed = String(text || '').trim();
    if (!trimmed) return;
    socket.emit('chat-message', { text: trimmed });
}

function initChatUI() {
    const panel = document.getElementById('chat-panel');
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send-btn');
    const inputRow = document.getElementById('chat-input-row');
    if (!panel || !input) return;

    function sendMessage() {
        const text = input.value.trim();
        if (!text) return;
        broadcastChat(text);
        input.value = '';
    }

    input.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.code === 'Enter') { e.preventDefault(); sendMessage(); input.blur(); }
        if (e.code === 'Escape') { e.preventDefault(); input.blur(); }
    });

    if (sendBtn) sendBtn.addEventListener('click', () => { sendMessage(); input.focus(); });

    input.addEventListener('focus', () => {
        if (inputRow) inputRow.style.display = 'flex';
        panel.classList.add('focused');
    });

    input.addEventListener('blur', () => {
        if (inputRow) inputRow.style.display = 'none';
        panel.classList.remove('focused');
        document.dispatchEvent(new CustomEvent('chat-closed'));
    });
}

// ---- Explosion ----
function explodePlayer(id) {
    const data = remotePlayers.get(id);
    if (!data || data.exploded) return;
    data.exploded = true;
    data.dying = true;
    data.dyingTimer = 0;

    const origin = new THREE.Vector3();
    data.group.getWorldPosition(origin);
    // Aim the origin at the torso centre (roughly mid-body)
    origin.y += 0.8;

    data.group.traverse(child => {
        if (!child.isMesh) return;

        // Clone so the original group stays intact for respawn
        const worldPos = new THREE.Vector3();
        const worldQuat = new THREE.Quaternion();
        const worldScale = new THREE.Vector3();
        child.getWorldPosition(worldPos);
        child.getWorldQuaternion(worldQuat);
        child.getWorldScale(worldScale);

        const clone = child.clone();
        clone.material = child.material.clone();
        clone.material.transparent = true;
        clone.material.opacity = 1;
        clone.castShadow = false;
        clone.position.copy(worldPos);
        clone.quaternion.copy(worldQuat);
        clone.scale.copy(worldScale);
        threeScene.add(clone);

        // Outward velocity from body centre
        const dir = worldPos.clone().sub(origin);
        if (dir.length() < 0.05) dir.set(Math.random() - 0.5, 0.5, Math.random() - 0.5);
        dir.normalize();

        const speed = 4 + Math.random() * 6;
        const velocity = new THREE.Vector3(
            dir.x * speed + (Math.random() - 0.5) * 2,
            dir.y * speed + 3 + Math.random() * 4,
            dir.z * speed + (Math.random() - 0.5) * 2,
        );

        const angularVel = new THREE.Vector3(
            (Math.random() - 0.5) * 20,
            (Math.random() - 0.5) * 20,
            (Math.random() - 0.5) * 20,
        );

        explodingPieces.push({ mesh: clone, velocity, angularVel, timer: 0, duration: 4.0 });
    });

    if (data.footstepAudio?.isPlaying) data.footstepAudio.stop();
    data.group.visible = false;

    document.dispatchEvent(new CustomEvent('player-exploded', { detail: { position: origin.clone() } }));
}

// ---- Kill feed ----
const ROAST_MSGS = [
    'absolutely cooked',
    'deleted',
    'disrespected',
    'clowned on',
    'one-tapped',
    'obliterated',
    'humiliated',
    'made an example of',
    'ended',
];

function appendKillFeed(killerId, victimId) {
    if (!killerId) return;
    const feed = document.getElementById('kill-feed');
    if (!feed) return;

    const killerName = killerId === myPlayerId ? myPlayerName : (playerNames.get(killerId) || 'Unknown');
    const victimName = victimId === myPlayerId ? myPlayerName : (playerNames.get(victimId) || 'Unknown');
    const killerColor = colorToCss(colorForId(killerId));
    const victimColor = colorToCss(colorForId(victimId));
    const roast = ROAST_MSGS[Math.floor(Math.random() * ROAST_MSGS.length)];

    const entry = document.createElement('div');
    entry.className = 'kill-entry';
    entry.innerHTML =
        `<span class="kill-name" style="color:${killerColor}">${killerName}</span>` +
        ` <span class="kill-roast">${roast}</span> ` +
        `<span class="kill-name" style="color:${victimColor}">${victimName}</span>`;

    feed.appendChild(entry);
    while (feed.children.length > 4) feed.removeChild(feed.firstChild);
    setTimeout(() => entry.remove(), 5000);
}

// ---- Broadcast helpers ----
let lastBroadcast = 0;
export function broadcastState(controlsObj, health) {
    if (!socket || !currentRoomId) return;
    const now = performance.now();
    if (now - lastBroadcast < 50) return; // 20 fps
    lastBroadcast = now;
    socket.emit('player-update', {
        position: { x: controlsObj.position.x, y: controlsObj.position.y, z: controlsObj.position.z },
        yaw: controlsObj.rotation.y,
        health,
    });
}

export function broadcastShoot() {
    if (!socket || !currentRoomId) return;
    socket.emit('player-shoot');
}

export function broadcastPlayerHit(targetId, damage) {
    if (!socket || !currentRoomId) return;
    socket.emit('player-hit', { targetId, damage });
}

// ---- Hit detection against remote capsules ----
export function broadcastDeath(killerId) {
    if (!socket || !currentRoomId) return;
    socket.emit('player-died', { killerId: killerId || null });
}

export function broadcastRespawn() {
    if (!socket || !currentRoomId) return;
    socket.emit('player-respawned');
}

export function broadcastGrenadeThrow(pos, vel) {
    if (!socket || !currentRoomId) return;
    socket.emit('grenade-thrown', {
        position: { x: pos.x, y: pos.y, z: pos.z },
        velocity: { x: vel.x, y: vel.y, z: vel.z },
    });
}

export function broadcastSndRematch() {
    if (!socket || !currentRoomId) return;
    socket.emit('snd-rematch');
}

export function broadcastSndQuit() {
    if (!socket || !currentRoomId) return;
    socket.emit('snd-quit');
}

export function broadcastBombPlanted(position) {
    if (!socket || !currentRoomId) return;
    socket.emit('snd-bomb-planted', { position: { x: position.x, y: position.y, z: position.z } });
}

export function broadcastBombDefused() {
    if (!socket || !currentRoomId) return;
    socket.emit('snd-bomb-defused');
}

export function broadcastPistolThrow(position, velocity) {
    if (!socket || !currentRoomId) return;
    socket.emit('pistol-thrown', {
        position: { x: position.x, y: position.y, z: position.z },
        velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
    });
}

export function broadcastPistolReturn() {
    if (!socket || !currentRoomId) return;
    socket.emit('pistol-returned');
}

export function broadcastBombPlantingStart(position) {
    if (!socket || !currentRoomId) return;
    socket.emit('snd-bomb-planting-start', { position: { x: position.x, y: position.y, z: position.z } });
}

export function broadcastBombPlantingStop() {
    if (!socket || !currentRoomId) return;
    socket.emit('snd-bomb-planting-stop');
}

export function getMyPlayerId() { return myPlayerId; }

export function getPlayersInRange(center, radius) {
    const results = [];
    remotePlayers.forEach((data, id) => {
        if (data.dying) return;
        const dist = center.distanceTo(data.group.position);
        if (dist <= radius) results.push({ id, dist });
    });
    return results;
}

export function getRemotePlayerHit(raycaster) {
    const meshes = [];
    const meshToId = new Map();
    remotePlayers.forEach((data, id) => {
        if (data.dying) return; // can't shoot a dying/dead player
        data.group.traverse(child => {
            if (child.isMesh) {
                meshes.push(child);
                meshToId.set(child, id);
            }
        });
    });
    if (meshes.length === 0) return null;
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return null;
    const id = meshToId.get(hits[0].object);
    const data = remotePlayers.get(id);
    const bodyPos = data ? data.group.position.clone().setY(data.group.position.y + 1.2) : hits[0].point.clone();
    const isHeadshot = hits[0].object.userData.isHead === true;
    return { playerId: id, intersect: hits[0], bodyPos, isHeadshot };
}

// ---- Misc ----
function refreshPlayerCount() {
    const el = document.getElementById('lobby-player-count');
    if (el) {
        el.textContent = `${remotePlayers.size + 1} / 4 players`;
        el.style.display = 'block';
    }
}

// ---- Helpers ----
function parseRoomId(input) {
    const str = (input || '').trim();
    if (!str) return null;
    try {
        const url = new URL(str);
        const r = url.searchParams.get('room');
        if (r) return r;
    } catch (e) {}
    return str; // treat as raw room code
}

// ---- Init ----
export function initNetwork(scene, onGameStart, onHitReceived) {
    threeScene = scene;
    onHitReceivedCb = onHitReceived;
    socket = window.io();
    initChatUI();

    // Socket events
    socket.on('player-joined', state => addRemotePlayer(state));

    socket.on('player-update', state => {
        const data = remotePlayers.get(state.id);
        if (!data) return;
        data.targetPos.set(state.position.x, state.position.y - 1.9, state.position.z);
        data.targetYaw = state.yaw;
    });

    socket.on('player-left', ({ id }) => {
        removeRemotePlayer(id);
        document.dispatchEvent(new CustomEvent('player-left', { detail: { id } }));
    });

    socket.on('pistol-thrown', data => {
        document.dispatchEvent(new CustomEvent('remote-pistol-thrown', { detail: data }));
    });

    socket.on('pistol-returned', data => {
        document.dispatchEvent(new CustomEvent('remote-pistol-returned', { detail: data }));
    });

    socket.on('player-died', ({ id, killerId }) => {
        appendKillFeed(killerId, id);
        explodePlayer(id);
        const victimStats = playerStats.get(id);
        if (victimStats) victimStats.deaths++;
        if (killerId) {
            const killerStats = playerStats.get(killerId);
            if (killerStats) killerStats.kills++;
            if (killerId === myPlayerId) {
                document.dispatchEvent(new CustomEvent('my-kill'));
            }
        }
    });

    socket.on('player-respawned', ({ id }) => {
        const data = remotePlayers.get(id);
        if (!data) return;
        data.dying = false;
        data.dyingTimer = 0;
        data.exploded = false;
        data.group.rotation.x = 0;
        data.group.position.copy(data.targetPos);
        data.group.visible = true;
    });

    socket.on('player-shoot', ({ id }) => {
        const data = remotePlayers.get(id);
        if (!data) return;
        data.muzzleFlash.visible = true;
        data.muzzleTimer = 0.1;
        const pos = new THREE.Vector3();
        data.group.getWorldPosition(pos);
        pos.y += 1.05; // approximate gun height
        document.dispatchEvent(new CustomEvent('remote-gunshot', { detail: { position: pos } }));
    });

    socket.on('player-hit', ({ shooterId, targetId, damage }) => {
        if (targetId === myPlayerId && onHitReceivedCb) {
            onHitReceivedCb(damage, shooterId);
        }
    });

    socket.on('chat-message', msg => appendChatMessage(msg));

    socket.on('grenade-thrown', ({ position, velocity }) => {
        document.dispatchEvent(new CustomEvent('remote-grenade-thrown', { detail: { position, velocity } }));
    });

    // ---- SND socket events ----
    socket.on('snd-round-start', data => {
        const myTeam = data.teams[myPlayerId];
        const hasBomb = data.bombHolder === myPlayerId;
        const lobbyOverlayEl = document.getElementById('lobby-overlay');
        if (lobbyOverlayEl) lobbyOverlayEl.classList.remove('visible');
        onGameStart();
        document.dispatchEvent(new CustomEvent('snd-round-start', { detail: { ...data, myTeam, hasBomb } }));
    });

    socket.on('snd-round-end', data => {
        document.dispatchEvent(new CustomEvent('snd-round-end', { detail: data }));
    });

    socket.on('snd-match-end', data => {
        document.dispatchEvent(new CustomEvent('snd-match-end', { detail: { ...data, isHost: amIHost } }));
    });

    socket.on('snd-timer', data => {
        document.dispatchEvent(new CustomEvent('snd-timer', { detail: data }));
    });

    socket.on('snd-bomb-planting-start', data => {
        document.dispatchEvent(new CustomEvent('snd-bomb-planting-start', { detail: data }));
    });

    socket.on('snd-bomb-planting-stop', () => {
        document.dispatchEvent(new CustomEvent('snd-bomb-planting-stop'));
    });

    socket.on('snd-bomb-planted', data => {
        document.dispatchEvent(new CustomEvent('snd-bomb-planted', { detail: data }));
    });

    socket.on('snd-bomb-defused', () => {
        document.dispatchEvent(new CustomEvent('snd-bomb-defused'));
    });

    socket.on('snd-bomb-exploded', data => {
        document.dispatchEvent(new CustomEvent('snd-bomb-exploded', { detail: data }));
    });

    socket.on('snd-quit', () => {
        resetToSolo();
        document.dispatchEvent(new CustomEvent('snd-quit'));
    });

    // ---- Lobby UI wiring ----
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get('room');

    const nameInput     = document.getElementById('lobby-name-input');
    const createBtn     = document.getElementById('lobby-create-btn');
    const joinBtn       = document.getElementById('lobby-join-btn');
    const joinLinkInput = document.getElementById('lobby-join-link-input');
    const inviteSection = document.getElementById('lobby-invite-section');
    const inviteInput   = document.getElementById('lobby-invite-link');
    const copyBtn       = document.getElementById('lobby-copy-btn');
    const startBtn      = document.getElementById('lobby-start-btn');
    const statusEl      = document.getElementById('lobby-status');
    const playerCountEl = document.getElementById('lobby-player-count');

    function setStatus(msg, isError = false) {
        if (!statusEl) return;
        statusEl.textContent = msg;
        statusEl.style.color = isError ? '#fc8181' : '#68d391';
    }

    function resetToSolo() {
        remotePlayers.forEach((_, id) => removeRemotePlayer(id));
        currentRoomId = null;
        amIHost = false;
        roomMode = 'ffa';
        playerStats.clear();
        playerNames.clear();

        // Hide post-connection elements
        const inviteSectionEl = document.getElementById('lobby-invite-section');
        const startBtnEl      = document.getElementById('lobby-start-btn');
        if (inviteSectionEl)  inviteSectionEl.style.display  = 'none';
        if (startBtnEl)       startBtnEl.style.display       = 'none';
        if (playerCountEl)    playerCountEl.style.display    = 'none';

        // Restore pre-connection elements
        const nameFieldEl  = document.getElementById('lobby-name-field');
        const tabsEl       = document.getElementById('lobby-tabs');
        const tabConnectEl = document.getElementById('lobby-tab-connect');
        const tabRoomsEl   = document.getElementById('lobby-tab-rooms');
        if (nameFieldEl)  nameFieldEl.style.display  = '';
        if (tabsEl)       tabsEl.style.display       = '';
        if (tabConnectEl) tabConnectEl.style.display  = '';
        if (tabRoomsEl)   tabRoomsEl.style.display    = 'none';

        // Reset active tab highlight to Connect
        document.querySelectorAll('.lobby-tab').forEach(b => b.classList.remove('active'));
        const connectTabBtn = document.querySelector('.lobby-tab[data-tab="connect"]');
        if (connectTabBtn) connectTabBtn.classList.add('active');

        // Clear status and re-enable create button
        setStatus('');
        if (createBtn) createBtn.disabled = false;
    }

    function revealInviteAndStart(roomId) {
        const link = `${location.origin}${location.pathname}?room=${roomId}`;
        if (inviteInput) inviteInput.value = link;
        if (inviteSection) inviteSection.style.display = 'flex';
        if (playerCountEl) playerCountEl.style.display = 'block';
        if (startBtn) {
            startBtn.style.display = 'block';
            if (amIHost && roomMode === 'snd') {
                startBtn.textContent = 'Start Match';
                startBtn.className = 'lobby-btn lobby-btn-start lobby-btn-snd-start';
            } else {
                startBtn.textContent = 'Close';
                startBtn.className = 'lobby-btn lobby-btn-start';
            }
        }
        // Swap out the connect UI for the connected state
        const nameFieldEl  = document.getElementById('lobby-name-field');
        const tabsEl       = document.getElementById('lobby-tabs');
        const tabConnectEl = document.getElementById('lobby-tab-connect');
        const tabRoomsEl   = document.getElementById('lobby-tab-rooms');
        if (nameFieldEl)  nameFieldEl.style.display  = 'none';
        if (tabsEl)       tabsEl.style.display       = 'none';
        if (tabConnectEl) tabConnectEl.style.display  = 'none';
        if (tabRoomsEl)   tabRoomsEl.style.display    = 'none';
        refreshPlayerCount();
    }

    // ---- Tab switching ----
    const tabBtns = document.querySelectorAll('.lobby-tab');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tab = btn.dataset.tab;
            const connectEl = document.getElementById('lobby-tab-connect');
            const roomsEl   = document.getElementById('lobby-tab-rooms');
            if (connectEl) connectEl.style.display = tab === 'connect' ? '' : 'none';
            if (roomsEl)   roomsEl.style.display   = tab === 'rooms'   ? '' : 'none';
            if (tab === 'rooms') requestRoomsList();
        });
    });

    // ---- Public rooms ----
    function escapeHtml(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function renderRoomsList(roomList) {
        const container = document.getElementById('rooms-list');
        const emptyEl   = document.getElementById('rooms-empty');
        if (!container) return;
        container.innerHTML = '';
        if (!roomList || roomList.length === 0) {
            if (emptyEl) emptyEl.style.display = 'block';
            return;
        }
        if (emptyEl) emptyEl.style.display = 'none';
        roomList.forEach(room => {
            const entry = document.createElement('div');
            entry.className = 'room-entry';
            const joinEl = room.isFull
                ? `<span class="room-entry-full">Full</span>`
                : `<button class="room-entry-join lobby-btn" data-room-id="${escapeHtml(room.id)}">Join</button>`;
            const modeBadge = `<span class="room-entry-mode ${room.mode === 'snd' ? 'mode-snd' : 'mode-ffa'}">${room.mode === 'snd' ? 'S&D' : 'FFA'}</span>`;
            entry.innerHTML =
                `<div class="room-entry-info">` +
                `<span class="room-entry-name">${escapeHtml(room.name)}</span>${modeBadge}` +
                `<span class="room-entry-count">${room.playerCount} / ${room.maxPlayers} players</span>` +
                `</div>${joinEl}`;
            container.appendChild(entry);
        });
        container.querySelectorAll('.room-entry-join').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                btn.disabled = true;
                performJoin(btn.dataset.roomId, () => { btn.disabled = false; });
            });
        });
    }

    function requestRoomsList() {
        socket.emit('get-rooms');
    }

    socket.on('rooms-list', roomList => renderRoomsList(roomList));

    socket.on('rooms-updated', roomList => {
        const roomsEl = document.getElementById('lobby-tab-rooms');
        if (roomsEl && roomsEl.style.display !== 'none') renderRoomsList(roomList);
    });

    const refreshBtn = document.getElementById('rooms-refresh-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', e => { e.stopPropagation(); requestRoomsList(); });

    // ---- Shared join logic ----
    function performJoin(roomId, onError) {
        if (!roomId) { setStatus('Enter a room link or code.', true); if (onError) onError(); return; }
        const name = nameInput?.value.trim() || 'Player';
        setStatus('Joining...');
        socket.emit('join-room', { roomId, name }, res => {
            if (res.error) { setStatus(res.error, true); if (onError) onError(); return; }
            myPlayerId = res.playerId;
            myPlayerName = name;
            currentRoomId = roomId;
            amIHost = false;
            roomMode = res.mode || 'ffa';
            playerStats.set(myPlayerId, { kills: 0, deaths: 0 });
            res.existingPlayers?.forEach(addRemotePlayer);
            revealInviteAndStart(roomId);
            setStatus(roomMode === 'snd'
                ? 'Joined! Waiting for host to start the match.'
                : `Joined! ${(res.existingPlayers?.length ?? 0) + 1} player(s) in room.`);
            refreshPlayerCount();
            appendChatMessage({ system: true, text: `You joined the game` });
        });
    }

    // Pre-fill join input if visiting via invite link
    if (roomFromUrl && joinLinkInput) {
        joinLinkInput.value = roomFromUrl;
        setStatus('Invite detected — enter your name and click Join.');
    }

    // Close modal on ✕ button or backdrop click
    const lobbyOverlayEl = document.getElementById('lobby-overlay');
    const lobbyBoxEl     = document.getElementById('lobby-box');
    if (lobbyOverlayEl) lobbyOverlayEl.addEventListener('click', () => lobbyOverlayEl.classList.remove('visible'));
    if (lobbyBoxEl)     lobbyBoxEl.addEventListener('click', e => e.stopPropagation());

    const lobbyCloseBtn = document.getElementById('lobby-close-btn');
    if (lobbyCloseBtn) {
        lobbyCloseBtn.addEventListener('click', e => {
            e.stopPropagation();
            if (lobbyOverlayEl) lobbyOverlayEl.classList.remove('visible');
        });
    }

    if (createBtn) {
        createBtn.addEventListener('click', e => {
            e.stopPropagation();
            const name = nameInput?.value.trim() || 'Player';
            const roomName = document.getElementById('lobby-room-name-input')?.value.trim() || 'Unnamed Room';
            const mode = document.getElementById('lobby-mode-select')?.value || 'ffa';
            createBtn.disabled = true;
            setStatus('Creating room...');
            socket.emit('create-room', { name, roomName, mode }, res => {
                if (res.error) { setStatus(res.error, true); createBtn.disabled = false; return; }
                myPlayerId = res.playerId;
                myPlayerName = name;
                currentRoomId = res.roomId;
                amIHost = true;
                roomMode = res.mode || 'ffa';
                playerStats.set(myPlayerId, { kills: 0, deaths: 0 });
                revealInviteAndStart(res.roomId);
                setStatus(roomMode === 'snd'
                    ? 'Room created! Add players, then press "Start Match".'
                    : 'Room created! Share the link, then close when ready.');
                appendChatMessage({ system: true, text: `Room created. Waiting for players...` });
            });
        });
    }

    if (joinBtn) {
        joinBtn.addEventListener('click', e => {
            e.stopPropagation();
            const raw    = joinLinkInput?.value.trim() || roomFromUrl || '';
            const roomId = parseRoomId(raw);
            joinBtn.disabled = true;
            performJoin(roomId, () => { joinBtn.disabled = false; });
        });
    }

    if (copyBtn && inviteInput) {
        copyBtn.addEventListener('click', e => {
            e.stopPropagation();
            navigator.clipboard.writeText(inviteInput.value);
            copyBtn.textContent = 'Copied!';
            setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
        });
    }

    if (startBtn) {
        startBtn.addEventListener('click', e => {
            e.stopPropagation();
            if (amIHost && roomMode === 'snd') {
                socket.emit('snd-start');
                startBtn.disabled = true;
                setStatus('Starting match...');
            } else {
                if (lobbyOverlayEl) lobbyOverlayEl.classList.remove('visible');
                onGameStart();
            }
        });
    }
}
