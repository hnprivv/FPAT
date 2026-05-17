const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static(__dirname));

// roomId -> { name, mode, host, players: Map, snd: sndState | null }
const rooms = new Map();

// ---- SND state helpers ----
function createSndState() {
    return {
        phase: 'waiting',    // waiting | active | planted | round-end | match-end
        round: 0,
        attackerScore: 0,
        defenderScore: 0,
        teams: new Map(),    // socketId -> 'attacker' | 'defender'
        bombHolder: null,
        bombState: 'held',   // held | planted | defused | exploded
        bombPosition: null,
        alivePlayers: new Set(),
        tickInterval: null,
        roundSecondsLeft: 300,
        bombSecondsLeft: 50,
    };
}

function clearSndTimers(snd) {
    if (snd.tickInterval) { clearInterval(snd.tickInterval); snd.tickInterval = null; }
}

function tickSnd(roomId) {
    const room = rooms.get(roomId);
    if (!room?.snd) return;
    const snd = room.snd;
    if (snd.phase === 'active') {
        snd.roundSecondsLeft--;
        io.to(roomId).emit('snd-timer', { roundSeconds: snd.roundSecondsLeft, bombSeconds: null });
        if (snd.roundSecondsLeft <= 0) endRound(roomId, 'defender', 'timeout');
    } else if (snd.phase === 'planted') {
        snd.bombSecondsLeft--;
        io.to(roomId).emit('snd-timer', { roundSeconds: null, bombSeconds: snd.bombSecondsLeft });
        if (snd.bombSecondsLeft <= 0) {
            snd.bombState = 'exploded';
            io.to(roomId).emit('snd-bomb-exploded', { position: snd.bombPosition });
            endRound(roomId, 'attacker', 'explosion');
        }
    }
}

function startRound(roomId) {
    const room = rooms.get(roomId);
    if (!room?.snd) return;
    const snd = room.snd;

    snd.round++;
    snd.phase = 'active';
    snd.bombState = 'held';
    snd.bombPosition = null;
    snd.roundSecondsLeft = 300;
    snd.bombSecondsLeft = 50;

    // Swap teams at round 3 (second half); scores follow the players, not the roles
    if (snd.round === 3) {
        snd.teams.forEach((team, id) => {
            snd.teams.set(id, team === 'attacker' ? 'defender' : 'attacker');
        });
        const tmp = snd.attackerScore;
        snd.attackerScore = snd.defenderScore;
        snd.defenderScore = tmp;
    }

    snd.alivePlayers = new Set(room.players.keys());

    const attackerIds = [];
    snd.teams.forEach((team, id) => { if (team === 'attacker') attackerIds.push(id); });
    snd.bombHolder = attackerIds.length > 0
        ? attackerIds[Math.floor(Math.random() * attackerIds.length)] : null;

    const teamsObj = {};
    snd.teams.forEach((team, id) => { teamsObj[id] = team; });

    io.to(roomId).emit('snd-round-start', {
        round: snd.round,
        teams: teamsObj,
        bombHolder: snd.bombHolder,
        attackerScore: snd.attackerScore,
        defenderScore: snd.defenderScore,
    });

    clearSndTimers(snd);
    snd.tickInterval = setInterval(() => tickSnd(roomId), 1000);
}

function checkWinConditions(roomId) {
    const room = rooms.get(roomId);
    if (!room?.snd) return;
    const snd = room.snd;
    if (snd.phase !== 'active' && snd.phase !== 'planted') return;

    let aliveAttackers = 0, aliveDefenders = 0;
    snd.alivePlayers.forEach(id => {
        const team = snd.teams.get(id);
        if (team === 'attacker') aliveAttackers++;
        else if (team === 'defender') aliveDefenders++;
    });

    if (aliveDefenders === 0) {
        endRound(roomId, 'attacker', 'elimination');
    } else if (aliveAttackers === 0 && snd.phase === 'active') {
        endRound(roomId, 'defender', 'elimination');
    }
    // If attackers all dead but bomb planted: timer still runs, bomb may still explode
}

function endRound(roomId, winner, reason) {
    const room = rooms.get(roomId);
    if (!room?.snd) return;
    const snd = room.snd;
    if (snd.phase === 'round-end' || snd.phase === 'match-end') return;

    clearSndTimers(snd);
    snd.phase = 'round-end';

    if (winner === 'attacker') snd.attackerScore++;
    else snd.defenderScore++;

    const totalRounds = snd.attackerScore + snd.defenderScore;
    const isMatchOver = (totalRounds >= 4 && snd.attackerScore !== snd.defenderScore)
                     || (totalRounds >= 5);

    io.to(roomId).emit('snd-round-end', {
        winner, reason,
        attackerScore: snd.attackerScore,
        defenderScore: snd.defenderScore,
        round: snd.round,
        matchOver: isMatchOver,
    });

    if (isMatchOver) {
        setTimeout(() => endMatch(roomId), 5000);
    } else {
        setTimeout(() => startRound(roomId), 6000);
    }
}

function endMatch(roomId) {
    const room = rooms.get(roomId);
    if (!room?.snd) return;
    const snd = room.snd;
    snd.phase = 'match-end';
    clearSndTimers(snd);

    const matchWinner = snd.attackerScore > snd.defenderScore ? 'attacker'
        : snd.defenderScore > snd.attackerScore ? 'defender' : 'draw';

    io.to(roomId).emit('snd-match-end', {
        winner: matchWinner,
        attackerScore: snd.attackerScore,
        defenderScore: snd.defenderScore,
    });

    room.snd = createSndState();
}

// ---- Room list ----
function getRoomList() {
    const list = [];
    rooms.forEach((room, roomId) => {
        list.push({
            id: roomId,
            name: room.name,
            mode: room.mode || 'ffa',
            playerCount: room.players.size,
            maxPlayers: 4,
            isFull: room.players.size >= 4,
        });
    });
    return list;
}

function broadcastRoomsUpdate() {
    io.emit('rooms-updated', getRoomList());
}

io.on('connection', (socket) => {
    let currentRoom = null;

    socket.on('get-rooms', () => {
        socket.emit('rooms-list', getRoomList());
    });

    socket.on('create-room', ({ name, roomName, mode }, callback) => {
        const roomId = uuidv4().slice(0, 8);
        const isSnd = mode === 'snd';
        rooms.set(roomId, {
            name: String(roomName || 'Unnamed Room').slice(0, 32).trim() || 'Unnamed Room',
            mode: isSnd ? 'snd' : 'ffa',
            host: socket.id,
            players: new Map(),
            snd: isSnd ? createSndState() : null,
        });
        currentRoom = roomId;
        socket.join(roomId);
        rooms.get(roomId).players.set(socket.id, {
            id: socket.id,
            name: name || 'Player',
            position: { x: 0, y: 2, z: 0 },
            yaw: 0,
            health: 100,
        });
        callback({ roomId, playerId: socket.id, mode: isSnd ? 'snd' : 'ffa', isHost: true });
        broadcastRoomsUpdate();
    });

    socket.on('join-room', ({ roomId, name }, callback) => {
        const room = rooms.get(roomId);
        if (!room) { callback({ error: 'Room not found.' }); return; }
        if (room.players.size >= 4) { callback({ error: 'Room is full (max 4 players).' }); return; }
        if (room.mode === 'snd' && room.snd && room.snd.phase !== 'waiting') {
            callback({ error: 'Match already in progress.' }); return;
        }

        currentRoom = roomId;
        socket.join(roomId);
        const playerName = name || 'Player';
        const state = {
            id: socket.id,
            name: playerName,
            position: { x: 0, y: 2, z: 0 },
            yaw: 0,
            health: 100,
        };
        room.players.set(socket.id, state);

        const existing = [];
        room.players.forEach((s, id) => { if (id !== socket.id) existing.push(s); });

        callback({
            playerId: socket.id,
            existingPlayers: existing,
            mode: room.mode || 'ffa',
            isHost: false,
            host: room.host,
        });
        socket.to(roomId).emit('player-joined', state);
        socket.to(roomId).emit('chat-message', { system: true, text: `${playerName} joined the game` });
        broadcastRoomsUpdate();
    });

    socket.on('player-update', (data) => {
        if (!currentRoom) return;
        const room = rooms.get(currentRoom);
        if (!room) return;
        const p = room.players.get(socket.id);
        if (p) { p.position = data.position; p.yaw = data.yaw; p.health = data.health; }
        socket.to(currentRoom).emit('player-update', { id: socket.id, ...data });
    });

    socket.on('chat-message', ({ text }) => {
        if (!currentRoom) return;
        const room = rooms.get(currentRoom);
        if (!room) return;
        const p = room.players.get(socket.id);
        const playerName = p?.name || 'Player';
        const sanitized = String(text || '').slice(0, 120).trim();
        if (!sanitized) return;
        io.to(currentRoom).emit('chat-message', { id: socket.id, name: playerName, text: sanitized });
    });

    socket.on('player-shoot', () => {
        if (!currentRoom) return;
        socket.to(currentRoom).emit('player-shoot', { id: socket.id });
    });

    socket.on('player-hit', ({ targetId, damage }) => {
        if (!currentRoom) return;
        io.to(currentRoom).emit('player-hit', { shooterId: socket.id, targetId, damage });
    });

    socket.on('player-died', ({ killerId }) => {
        if (!currentRoom) return;
        io.to(currentRoom).emit('player-died', { id: socket.id, killerId: killerId || null });

        const room = rooms.get(currentRoom);
        if (room?.mode === 'snd' && room.snd &&
            (room.snd.phase === 'active' || room.snd.phase === 'planted')) {
            room.snd.alivePlayers.delete(socket.id);
            checkWinConditions(currentRoom);
        }
    });

    socket.on('player-respawned', () => {
        if (!currentRoom) return;
        socket.to(currentRoom).emit('player-respawned', { id: socket.id });
    });

    socket.on('grenade-thrown', (data) => {
        if (!currentRoom) return;
        socket.to(currentRoom).emit('grenade-thrown', data);
    });

    socket.on('pistol-thrown', (data) => {
        if (!currentRoom) return;
        socket.to(currentRoom).emit('pistol-thrown', { id: socket.id, ...data });
    });

    socket.on('pistol-returned', () => {
        if (!currentRoom) return;
        socket.to(currentRoom).emit('pistol-returned', { id: socket.id });
    });

    // ---- SND events ----
    socket.on('snd-start', () => {
        if (!currentRoom) return;
        const room = rooms.get(currentRoom);
        if (!room || room.mode !== 'snd' || !room.snd) return;
        if (socket.id !== room.host || room.snd.phase !== 'waiting') return;

        const playerIds = [...room.players.keys()];
        playerIds.forEach((id, i) => {
            room.snd.teams.set(id, i % 2 === 0 ? 'attacker' : 'defender');
        });
        startRound(currentRoom);
    });

    socket.on('snd-bomb-planted', ({ position }) => {
        if (!currentRoom) return;
        const room = rooms.get(currentRoom);
        if (!room?.snd) return;
        const snd = room.snd;
        if (socket.id !== snd.bombHolder || snd.phase !== 'active') return;

        snd.phase = 'planted';
        snd.bombState = 'planted';
        snd.bombPosition = position;
        snd.bombSecondsLeft = 50;

        io.to(currentRoom).emit('snd-bomb-planted', { position, bombSeconds: 50 });
    });

    socket.on('snd-bomb-planting-start', ({ position }) => {
        if (!currentRoom) return;
        socket.to(currentRoom).emit('snd-bomb-planting-start', { position });
    });

    socket.on('snd-bomb-planting-stop', () => {
        if (!currentRoom) return;
        socket.to(currentRoom).emit('snd-bomb-planting-stop');
    });

    socket.on('snd-bomb-defused', () => {
        if (!currentRoom) return;
        const room = rooms.get(currentRoom);
        if (!room?.snd) return;
        const snd = room.snd;
        if (snd.phase !== 'planted') return;
        if (snd.teams.get(socket.id) !== 'defender') return;

        snd.bombState = 'defused';
        io.to(currentRoom).emit('snd-bomb-defused');
        endRound(currentRoom, 'defender', 'defused');
    });

    socket.on('snd-rematch', () => {
        if (!currentRoom) return;
        const room = rooms.get(currentRoom);
        if (!room || room.mode !== 'snd' || !room.snd) return;
        if (socket.id !== room.host || room.snd.phase !== 'match-end') return;

        clearSndTimers(room.snd);
        room.snd = createSndState();

        const playerIds = [...room.players.keys()];
        playerIds.forEach((id, i) => {
            room.snd.teams.set(id, i % 2 === 0 ? 'attacker' : 'defender');
        });
        startRound(currentRoom);
    });

    socket.on('snd-quit', () => {
        if (!currentRoom) return;
        const room = rooms.get(currentRoom);
        if (!room || room.mode !== 'snd' || !room.snd) return;
        if (socket.id !== room.host) return;

        clearSndTimers(room.snd);
        io.to(currentRoom).emit('snd-quit');
        rooms.delete(currentRoom);
        broadcastRoomsUpdate();
    });

    socket.on('disconnect', () => {
        if (!currentRoom) return;
        const room = rooms.get(currentRoom);
        if (!room) return;
        const leavingPlayer = room.players.get(socket.id);
        const leaveName = leavingPlayer?.name || 'Player';
        room.players.delete(socket.id);

        if (room.mode === 'snd' && room.snd) {
            room.snd.alivePlayers.delete(socket.id);
            room.snd.teams.delete(socket.id);
            if (room.snd.phase === 'active' || room.snd.phase === 'planted') {
                checkWinConditions(currentRoom);
            }
        }

        if (room.players.size === 0) {
            if (room.snd) clearSndTimers(room.snd);
            rooms.delete(currentRoom);
        } else {
            io.to(currentRoom).emit('player-left', { id: socket.id });
            io.to(currentRoom).emit('chat-message', { system: true, text: `${leaveName} left the game` });
        }
        broadcastRoomsUpdate();
    });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`FPAT server running at http://localhost:${PORT}`));
