const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static(__dirname));

// roomId -> { name: string, players: Map<socketId, playerState> }
const rooms = new Map();

function getRoomList() {
    const list = [];
    rooms.forEach((room, roomId) => {
        list.push({
            id: roomId,
            name: room.name,
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

    socket.on('create-room', ({ name, roomName }, callback) => {
        const roomId = uuidv4().slice(0, 8);
        rooms.set(roomId, {
            name: String(roomName || 'Unnamed Room').slice(0, 32).trim() || 'Unnamed Room',
            players: new Map(),
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
        callback({ roomId, playerId: socket.id });
        broadcastRoomsUpdate();
    });

    socket.on('join-room', ({ roomId, name }, callback) => {
        const room = rooms.get(roomId);
        if (!room) { callback({ error: 'Room not found.' }); return; }
        if (room.players.size >= 4) { callback({ error: 'Room is full (max 4 players).' }); return; }

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

        callback({ playerId: socket.id, existingPlayers: existing });
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
    });

    socket.on('player-respawned', () => {
        if (!currentRoom) return;
        socket.to(currentRoom).emit('player-respawned', { id: socket.id });
    });

    socket.on('grenade-thrown', (data) => {
        if (!currentRoom) return;
        socket.to(currentRoom).emit('grenade-thrown', data);
    });


    socket.on('disconnect', () => {
        if (!currentRoom) return;
        const room = rooms.get(currentRoom);
        if (!room) return;
        const leavingPlayer = room.players.get(socket.id);
        const leaveName = leavingPlayer?.name || 'Player';
        room.players.delete(socket.id);
        if (room.players.size === 0) {
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
