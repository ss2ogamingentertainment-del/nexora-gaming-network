# NEXORA Gaming Network — starter project

This is a runnable starter website with:
- Username/password registration and sign-in
- Password hashing with bcrypt
- SQLite user and session storage
- Socket.IO room creation and joining with room codes
- A responsive game library
- Small browser-playable arcade prototypes: football penalties, cricket timing, Steal the Egg, and lane racing
- Prototype cards for city exploration, hide-and-seek, treasure hunt, basketball and space exploration

## Requirements
- Node.js 20 or newer
- npm

## Run locally
1. Extract the ZIP.
2. Open a terminal in the project folder.
3. Run `npm install`.
4. Set a strong session secret before deployment:
   - Windows PowerShell: `$env:SESSION_SECRET="a-long-random-secret"`
   - macOS/Linux: `export SESSION_SECRET="a-long-random-secret"`
5. Run `npm start`.
6. Open `http://localhost:3000`.

## Make it accessible to friends
Deploy the project to a Node.js host that supports persistent storage and WebSockets (for example, a suitable Render, Railway, Fly.io, or VPS service). Configure:
- `NODE_ENV=production`
- `SESSION_SECRET` to a long random value
- Persistent disk/storage for the `data/` directory
- HTTPS
- WebSocket support

A free hosting tier may sleep, have usage limits, or not provide persistent disks. Check the host's current plan details before choosing it. Do not put this project on static-only hosting such as a plain static site bucket: the server and Socket.IO are required.

## Important current limitations
This is a first playable foundation, not a finished Steam/Roblox-scale service.
- The football and cricket modes are single-browser arcade prototypes. Room membership and real-time Socket.IO events work, but competitive gameplay, authoritative scoring, synchronized physics and player-vs-player rules still need implementation.
- Steal the Egg currently has local movement and room event plumbing; remote player rendering, server-authoritative egg ownership, teams, scoring and anti-cheat checks are next steps.
- City Life is a small concept placeholder, not a GTA-sized open world. It is an original concept and does not copy GTA assets, maps, characters, branding or missions.
- Hide & Seek, Treasure Hunt, Basketball and Space Explorer are placeholders.
- No public chat, voice chat, payments, ads, user-generated uploads or marketplace are included.
- For a public launch, add email/account recovery, rate limiting, CSRF protection, moderation/reporting, privacy policy, backups, monitoring, stronger game-server validation and security review. Never reuse passwords or share them.

## Project files
- `server.js` — Express server, SQLite database, authentication and Socket.IO rooms
- `public/index.html` — page structure
- `public/styles.css` — responsive gaming UI
- `public/app.js` — login, lobby, rooms and client logic
- `public/games.js` — game catalogue
- `package.json` — dependencies and scripts
