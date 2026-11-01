const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const helmet = require("helmet");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3")(session);
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const { Server } = require("socket.io");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "CHANGE_THIS_LONG_RANDOM_SECRET_BEFORE_DEPLOYING";
const DATA_DIR = path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "nexora.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);
const findUser = db.prepare("SELECT id, username, password_hash FROM users WHERE username = ?");
const createUser = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const sessionMiddleware = session({
  store: new SQLiteStoreFactory({ db: "sessions.sqlite", dir: DATA_DIR }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "20kb" }));
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, "public")));

function validUsername(name) {
  return typeof name === "string" && /^[A-Za-z0-9_]{3,16}$/.test(name);
}
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Please sign in first." });
  next();
}

app.post("/api/register", async (req, res) => {
  const { username, password } = req.body || {};
  if (!validUsername(username)) {
    return res.status(400).json({ error: "Username must be 3–16 characters: letters, numbers or underscores." });
  }
  if (typeof password !== "string" || password.length < 10 || password.length > 72) {
    return res.status(400).json({ error: "Password must be 10–72 characters." });
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = createUser.run(username, hash);
    req.session.user = { id: Number(result.lastInsertRowid), username };
    res.json({ user: req.session.user });
  } catch (err) {
    if (String(err).includes("UNIQUE")) return res.status(409).json({ error: "That username is already taken." });
    console.error(err);
    res.status(500).json({ error: "Could not create account." });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Enter your username and password." });
  }
  const user = findUser.get(username);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Incorrect username or password." });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "Could not start session." });
    req.session.user = { id: user.id, username: user.username };
    res.json({ user: req.session.user });
  });
});

app.post("/api/logout", requireAuth, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});
app.get("/api/me", (req, res) => res.json({ user: req.session.user || null }));

// Share the same signed-in session with Socket.IO.
io.engine.use(sessionMiddleware);
io.use((socket, next) => {
  const user = socket.request.session?.user;
  if (!user) return next(new Error("Sign in required"));
  socket.user = user;
  next();
});

const rooms = new Map();
const GAME_IDS = new Set(["football", "cricket", "steal-egg", "racing", "hide-seek", "treasure"]);
function makeCode() { return crypto.randomBytes(3).toString("hex").toUpperCase(); }
function roomSummary(room) {
  return {
    code: room.code,
    game: room.game,
    host: room.host,
    players: [...room.players.values()].map(p => ({ username: p.username, ready: p.ready })),
    maxPlayers: room.maxPlayers
  };
}
function emitRoom(room) { io.to(room.code).emit("room:update", roomSummary(room)); }

io.on("connection", socket => {
  socket.on("room:create", ({ game, privateRoom = true } = {}, callback = () => {}) => {
    if (!GAME_IDS.has(game)) return callback({ error: "Choose a valid game." });
    const code = makeCode();
    const room = {
      code, game, host: socket.user.username, privateRoom: !!privateRoom,
      maxPlayers: game === "football" ? 6 : game === "cricket" ? 4 : 8,
      players: new Map(), state: { score: {}, positions: {}, started: false }
    };
    rooms.set(code, room);
    joinRoom(socket, room, callback);
  });

  socket.on("room:join", ({ code } = {}, callback = () => {}) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) return callback({ error: "Room not found. Check the code." });
    joinRoom(socket, room, callback);
  });

  socket.on("player:ready", ({ ready } = {}) => {
    const room = getSocketRoom(socket);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (p) p.ready = !!ready;
    emitRoom(room);
  });

  socket.on("game:start", () => {
    const room = getSocketRoom(socket);
    if (!room || room.host !== socket.user.username) return;
    room.state.started = true;
    io.to(room.code).emit("game:started", { game: room.game });
  });

  // Small, rate-limited-by-client state relay for simple browser games.
  // Production games should validate movement, scoring and collisions on the server.
  socket.on("game:action", payload => {
    const room = getSocketRoom(socket);
    if (!room || !room.state.started || !payload || typeof payload !== "object") return;
    const safe = {
      username: socket.user.username,
      type: String(payload.type || "").slice(0, 24),
      x: Number.isFinite(payload.x) ? Math.max(0, Math.min(1, payload.x)) : undefined,
      y: Number.isFinite(payload.y) ? Math.max(0, Math.min(1, payload.y)) : undefined,
      value: Number.isFinite(payload.value) ? Math.max(0, Math.min(100, payload.value)) : undefined
    };
    socket.to(room.code).emit("game:action", safe);
  });

  socket.on("disconnect", () => {
    const room = getSocketRoom(socket);
    if (!room) return;
    room.players.delete(socket.id);
    socket.leave(room.code);
    if (room.players.size === 0) rooms.delete(room.code);
    else {
      if (![...room.players.values()].some(p => p.username === room.host)) {
        room.host = room.players.values().next().value.username;
      }
      emitRoom(room);
    }
  });
});

function joinRoom(socket, room, callback) {
  if (room.players.size >= room.maxPlayers) return callback({ error: "This room is full." });
  const alreadyIn = getSocketRoom(socket);
  if (alreadyIn) leaveCurrent(socket, alreadyIn);
  room.players.set(socket.id, { username: socket.user.username, ready: false });
  socket.join(room.code);
  callback({ room: roomSummary(room) });
  emitRoom(room);
}
function getSocketRoom(socket) {
  for (const room of rooms.values()) if (room.players.has(socket.id)) return room;
  return null;
}
function leaveCurrent(socket, room) {
  room.players.delete(socket.id);
  socket.leave(room.code);
  if (!room.players.size) rooms.delete(room.code);
  else emitRoom(room);
}

server.listen(PORT, () => console.log(`NEXORA is running on port ${PORT}`));
