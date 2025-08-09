// server.js - Node + Express + Socket.io simple server for Torre de Decisiones 3D
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

// Serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// In-memory rooms (simple). For production use DB or Redis.
const rooms = {}; // roomId -> { players: [{id, name}], state: {...} }

function createInitialState() {
  const NIVELES = 18;
  const BLOQUES_POR_NIVEL = 3;
  const total = NIVELES * BLOQUES_POR_NIVEL;
  const blocks = [];
  for (let i = 1; i <= total; i++) {
    let color = 'azul';
    if (i <= 18) color = 'azul';
    else if (i <= 36) color = 'verde';
    else if (i <= 45) color = 'rojo';
    else color = 'amarillo';
    blocks.push({ id: i, removed: false, color: color, level: Math.ceil(i/3) });
  }
  return {
    blocks,
    stability: 100,
    turnIndex: 0,
    players: [],
    started: false,
    timer: null
  };
}

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on('createRoom', ({ roomId, name }, cb) => {
    if (!roomId) return cb({ ok: false, error: 'roomId required' });
    if (rooms[roomId]) return cb({ ok: false, error: 'Room exists' });
    rooms[roomId] = createInitialState();
    rooms[roomId].players.push({ id: socket.id, name: name || 'Jugador' });
    socket.join(roomId);
    console.log(`Room ${roomId} created by ${socket.id}`);
    io.to(roomId).emit('roomUpdate', rooms[roomId]);
    cb({ ok: true, room: rooms[roomId] });
  });

  socket.on('joinRoom', ({ roomId, name }, cb) => {
    const room = rooms[roomId];
    if (!room) return cb({ ok: false, error: 'Room not found' });
    room.players.push({ id: socket.id, name: name || 'Jugador' });
    socket.join(roomId);
    io.to(roomId).emit('roomUpdate', room);
    cb({ ok: true, room });
  });

  socket.on('startGame', ({ roomId }, cb) => {
    const room = rooms[roomId];
    if (!room) return cb({ ok: false, error: 'Room not found' });
    room.started = true;
    room.turnIndex = 0;
    io.to(roomId).emit('gameStarted', room);
    cb({ ok: true });
  });

  socket.on('removeBlock', ({ roomId, blockId }, cb) => {
    const room = rooms[roomId];
    if (!room) return cb({ ok: false, error: 'Room not found' });
    const block = room.blocks.find(b => b.id === blockId);
    if (!block || block.removed) return cb({ ok: false, error: 'Invalid block' });
    // mark removed
    block.removed = true;
    // simple stability penalty by color
    const penalty = (block.color === 'azul') ? 2 : (block.color === 'verde') ? 3 : (block.color === 'rojo') ? 6 : 1;
    room.stability = Math.max(0, room.stability - penalty);
    // persist turn (do not advance until confirmed)
    io.to(roomId).emit('blockRemoved', { blockId, color: block.color, stability: room.stability });
    // if stability 0 -> collapse and finish
    if (room.stability <= 0) {
      io.to(roomId).emit('collapse', { message: 'La torre ha caído', stability: room.stability });
    }
    cb({ ok: true });
  });

  socket.on('confirmAction', ({ roomId }, cb) => {
    const room = rooms[roomId];
    if (!room) return cb({ ok: false, error: 'Room not found' });
    // advance turn
    room.turnIndex = (room.turnIndex + 1) % room.players.length;
    io.to(roomId).emit('turnAdvanced', { turnIndex: room.turnIndex });
    cb({ ok: true });
  });

  socket.on('getRoom', ({ roomId }, cb) => {
    const room = rooms[roomId];
    if (!room) return cb({ ok: false, error: 'Room not found' });
    cb({ ok: true, room });
  });

  socket.on('leaveRoom', ({ roomId }, cb) => {
    const room = rooms[roomId];
    if (!room) return cb({ ok: false, error: 'Room not found' });
    room.players = room.players.filter(p => p.id !== socket.id);
    socket.leave(roomId);
    io.to(roomId).emit('roomUpdate', room);
    cb({ ok: true });
  });

  socket.on('disconnecting', () => {
    // remove from rooms
    for (const roomId of Object.keys(rooms)) {
      const room = rooms[roomId];
      if (!room) continue;
      room.players = room.players.filter(p => p.id !== socket.id);
      io.to(roomId).emit('roomUpdate', room);
      // if room empty delete
      if (room.players.length === 0) delete rooms[roomId];
    }
  });

});

server.listen(PORT, () => {
  console.log('Server running on port', PORT);
});