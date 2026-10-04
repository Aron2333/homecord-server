# HomeCord API & Voice Signaling Server

Ultra-low latency backend and WebSocket signaling engine for **HomeCord**.

## Features
- **Ultra-low Latency Voice:** WebRTC peer signaling tuned for <20ms latency (Opus 10ms frame packets, zero jitter buffer).
- **Real-time Messaging & Channels:** Full Socket.io event handling with typing indicators, reactions, and direct messaging.
- **MySQL Persistence:** Automatic schema verification and table creation on boot.
- **Docker & Cloud Ready:** Pre-configured for Render.com deployment (Frankfurt region recommended).

## Deployment on Render.com
1. Click **New +** > **Web Service** in Render.
2. Connect this repository (`homecord-server`).
3. Set Environment to **Node**.
4. Set Region to **Frankfurt (EU Central)** for minimal ping to Hungary (~20ms).
5. Build Command: `npm install && npm run build`
6. Start Command: `npm run start`
7. Add Environment Variables:
   - `NODE_ENV`: `production`
   - `PORT`: `10000`
   - `API_URL`: `https://api.homecord.hu`
   - `WS_URL`: `wss://api.homecord.hu`
   - `CLIENT_URL`: `https://homecord.hu`
   - `DB_HOST`: Your MySQL host
   - `DB_PORT`: `3306`
   - `DB_NAME`: Your database name
   - `DB_USER`: Your database username
   - `DB_PASSWORD`: Your database password
   - `JWT_SECRET`: Random secure string
