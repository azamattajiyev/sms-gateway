# 📡 SMS Gateway

A Node.js HTTP + WebSocket SMS gateway. Android relay devices connect over WebSocket; backend clients enqueue OTPs over HTTP with a **per-account** API key. An operator admin panel manages those accounts and shows online devices.

---

## 🚀 Features

- WebSocket-based device connection (shared env `API_KEY` for device `REGISTER` only)
- Per-account HTTP `POST /api/send-otp` (quota, OTP length, brand name)
- Server-generated OTP and message: `Your {brandName} code: {code}`
- Load balancing between devices
- SMS rate limiting per device
- In-memory message queue
- SQLite persistence for API accounts and remaining SMS quota
- Public landing at `/` and integration docs at `/docs` (no login)
- Admin panel at `/login` and `/admin`
- Secure communication via WSS (Nginx + SSL)

---

## Breaking change: `POST /api/send-otp`

Callers **no longer** send `message` and **no longer** use the env `API_KEY` as `x-api-key`.

| | Before | Now |
| --- | --- | --- |
| Body | `{ "phone", "message" }` | `{ "phone" }` only |
| `x-api-key` | env `API_KEY` (same as WS) | **Account** key from `/admin/accounts` |
| Response | `{ "status": "queued" }` | `{ "status": "queued", "code": "<otp>" }` |
| SMS text | Caller-supplied `message` | Gateway template `Your {brandName} code: {code}` |

Path `/api/send-otp` and the `x-api-key` header **name** are unchanged. Env `API_KEY` remains the WebSocket device secret.

---

## 🖥️ Installation (Ubuntu)

### 1. Install dependencies

```bash
sudo apt update
sudo apt install -y nodejs npm nginx build-essential python3
```

`better-sqlite3` is a native addon; `build-essential` (or equivalent C toolchain) is required for `npm install`.

Verify installation:

```bash
node -v
npm -v
nginx -v
```

---

### 2. Clone the repository

```bash
git clone https://github.com/azamattajiyev/sms-gateway.git
cd sms-gateway
```

---

### 3. Install dependencies

```bash
npm install
```

---

### 4. Configure environment

```bash
cp .env.example .env
```

Edit `.env` before production. **Do not** leave `ADMIN_PASSWORD=admin` or the default `SESSION_SECRET` on a public host.

### 5. Run the server

```bash
node index.js
```

Listens on `HOST` (default `0.0.0.0`) so a phone on the same LAN can connect. On start the console prints a phone-usable `ws://<lan-ip>:PORT/ws`. If the phone cannot connect, allow incoming Node connections in macOS Firewall (System Settings → Network → Firewall).

Or using PM2 (recommended):

```bash
npm install -g pm2
pm2 start index.js --name sms-gateway
pm2 save
pm2 startup
```

---

## Public site

`GET /` is the public marketing page; `GET /docs` is the client integration guide for `POST /api/send-otp`. Neither requires a session. Both support English (`en`), Russian (`ru`, default), and Turkmen (`tk`, Latin script). The header has an EN / RU / TK switcher; the choice is stored in cookie `public.lang` and can be overridden with `?lang=en|ru|tk`. `/login` and `/admin` stay English operator UI and are not translated.

Public contact (email, Telegram, phone, hours) on the landing, docs, and footer comes from `PUBLIC_CONTACT_EMAIL`, `PUBLIC_CONTACT_TELEGRAM`, `PUBLIC_CONTACT_PHONE`, and `PUBLIC_CONTACT_HOURS`. Defaults are placeholders — replace them with real contact info. If `PUBLIC_CONTACT_HOURS` is unset, each language shows its translated default hours; an empty value hides hours; a set value is shown unchanged in every language. Do not treat `/` as a login redirect.

## Admin panel

Open `http://HOST:PORT/login` (local default `http://localhost:3000/login`). Credentials are `ADMIN_USERNAME` / `ADMIN_PASSWORD` (local defaults `admin` / `admin`). After login you land on `/admin`. `/` stays the public landing even when an admin cookie is present.

**Create an account and send an OTP**

1. Go to **Accounts** (`/admin/accounts`) → **Add account**.
2. Set name, brand name, OTP length (4–8, default 4), and optional initial SMS quota.
3. Save. Copy the raw API key from the one-time page (`/admin/accounts/:id/created`). It is shown **once**; only an 8-character prefix is stored for display. If you lose it, use **Regenerate key** on the edit page.
4. Top up remaining SMS from the account edit page (`/admin/accounts/:id/edit`).
5. Call `POST /api/send-otp` with that account key (see HTTP API below).
6. **Devices** (`/admin/devices`) lists currently online relays (id, `sentCount`, connected time). Device registry is in-memory; a process restart clears the list until phones re-register.

Unauthenticated visits to `/admin` redirect to `/login`. Logout is a POST to `/logout`. Session cookie name: `admin.sid`.

**Production footguns**

- `ADMIN_PASSWORD=admin` and default `SESSION_SECRET=dev-session-secret` are **local-only**. With `NODE_ENV=production` the process refuses to start unless `SESSION_SECRET` is set and `ADMIN_PASSWORD` is a non-default value.
- `NODE_ENV=production` sets `session.cookie.secure`, so the admin cookie is sent only over HTTPS.

---

## HTTP API

### `POST /api/send-otp`

Authenticates against an **account** row in SQLite, not env `API_KEY`.

**Headers**

| Header | Description |
| ------ | ----------- |
| `x-api-key` | Raw account key from the admin panel (not env `API_KEY`) |
| `Content-Type` | `application/json` |

**Body**

```json
{
  "phone": "+77001234567"
}
```

`phone` is E.164-ish: optional `+`, then 8–16 digits. A client `message` field is ignored; the gateway generates the SMS.

**Success**

```json
{ "status": "queued", "code": "4821" }
```

Queued SMS text is `Your {brandName} code: {code}` (example brand `Abat`, code `4821` → `Your Abat code: 4821`). Quota is decremented atomically at enqueue.

**Errors**

| Code | Body | When |
| ---- | ---- | ---- |
| 400 | `{ "error": "phone required" }` | Missing / empty `phone` |
| 400 | `{ "error": "invalid phone" }` | `phone` fails validation |
| 401 | `{ "error": "Unauthorized" }` | Missing, unknown, or disabled key — including env `API_KEY` |
| 429 | `{ "error": "quota exceeded" }` | Account remaining SMS is 0 (or consume failed) |
| 503 | `{ "error": "queue full" }` | In-memory queue at `MAX_QUEUE_SIZE` (quota not consumed) |

---

## 🌐 Nginx Configuration (WebSocket + SSL)

### ⚠️ Important

WebSocket requires proper headers (`Upgrade` and `Connection`) to work correctly.

If you terminate SSL on Nginx, proxy **HTTP as well as `/ws`**. The public landing (`/`, `/docs`), admin panel (`/login`, `/admin`), and send-otp (`/api`) must reach the same Node `PORT`. Proxying only `/ws` leaves the site, `/admin`, and `/api` unreachable on the domain. The landing is public on the domain.

---

### 1. Add to `nginx.conf` (inside `http` block)

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}
```

---

### 2. Create server config

```bash
sudo nano /etc/nginx/sites-available/sms-gateway
```

Paste:

```nginx
server {
    listen 443 ssl;
    server_name YOUR_DOMAIN;

    ssl_certificate /etc/letsencrypt/live/YOUR_DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/YOUR_DOMAIN/privkey.pem;

    location /ws {
        proxy_pass http://127.0.0.1:6050;

        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        proxy_read_timeout 86400;
    }

    # Public landing (/), docs (/docs), admin (/login, /admin), send-otp (/api), static assets.
    location / {
        proxy_pass http://127.0.0.1:6050;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

---

### 3. Enable configuration

```bash
sudo ln -s /etc/nginx/sites-available/sms-gateway /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## 🔐 SSL (Let's Encrypt)

Install Certbot:

```bash
sudo apt install certbot python3-certbot-nginx
```

Generate SSL certificate:

```bash
sudo certbot --nginx -d YOUR_DOMAIN
```

---

## 🔌 WebSocket Connection

Use the following endpoint:

```
wss://YOUR_DOMAIN/ws
```

Flutter `sms_relay` still registers with env `API_KEY`. That secret is **device-only**; it does not authorize `POST /api/send-otp`.

---

## ⚙️ Environment Variables

Copy [`.env.example`](.env.example) to `.env` and adjust values. `index.js` loads `.env` via `dotenv`; tests do not require a `.env` file.

**Two different keys**

| Secret | Used for |
| ------ | -------- |
| Env `API_KEY` | WebSocket `REGISTER.apiKey` only (Android devices) |
| Account `x-api-key` | HTTP `POST /api/send-otp` only (created in `/admin/accounts`) |

They are **not** interchangeable. Env `API_KEY` returns 401 on send-otp. An account key is rejected on device `REGISTER`.

| Variable | Default (local) | Description |
| -------- | --------------- | ----------- |
| `PORT` | `3000` | Port Node.js listens on (HTTP + WebSocket). |
| `HOST` | `0.0.0.0` | Bind address. `0.0.0.0` = all interfaces (phone-on-LAN). `127.0.0.1` = local-only. |
| `API_KEY` | `dev-api-key` (local only) | **Device WebSocket `REGISTER` only.** Not send-otp. Required in production. Do not commit real secrets. |
| `MAX_SMS_PER_DEVICE` | `500` | Max successful SMS per device (`sentCount` after `SMS_SENT`). |
| `CORS_ORIGIN` | empty / `*` | Open CORS, or comma-separated allowed origins. |
| `MAX_QUEUE_SIZE` | `1000` | Max in-memory queue length; reject enqueue when full. |
| `SQLITE_PATH` | `data/gateway.sqlite` | SQLite file for accounts and quotas. Relative paths are from the `sms-gateway` directory. `data/` is gitignored. |
| `SESSION_SECRET` | `dev-session-secret` (local only) | Signs the `admin.sid` cookie. **Local default is not for production.** |
| `ADMIN_USERNAME` | `admin` | Admin login at `/login`. |
| `ADMIN_PASSWORD` | `admin` (local only) | Admin login. **Not for production.** |
| `NODE_ENV` | unset → `development` | `production` sets `session.cookie.secure` and rejects default admin secrets at startup. |
| `PUBLIC_CONTACT_EMAIL` | `hello@abat-otp.example` | Email on the public landing, docs, and footer. Placeholder until replaced. Empty string hides this field. |
| `PUBLIC_CONTACT_TELEGRAM` | `abat_otp_example` | Telegram handle on public pages (5–32 chars `[A-Za-z0-9_]`, with or without `@`). Placeholder until replaced. Empty or invalid handle hides this field. |
| `PUBLIC_CONTACT_PHONE` | `+7 700 000-00-00` | Phone on the public landing, docs, and footer. Placeholder until replaced. Empty string hides this field. |
| `PUBLIC_CONTACT_HOURS` | unset (translated default) | Hours on the landing contact section. Unset → translated default per language (en/ru/tk). Empty string hides the field. A set value is shown as-is in every language. |

### Persistence

- **SQLite** (`SQLITE_PATH`): API accounts, hashed keys, remaining SMS quota. Survives process restart.
- **In-memory**: SMS queue and device registry (`sentCount`, online sockets). Lost on restart.

### `PORT` vs Nginx `6050`

- The app always binds to **`PORT`** (default **`3000`** for local/dev).
- The Nginx example below proxies to `http://127.0.0.1:6050`. That is a **deployment choice**: set `PORT=6050` for the Node process so it matches Nginx, **or** change Nginx `proxy_pass` to your chosen `PORT`.
- Do not assume the app hardcodes `6050`.

Example `.env` for the Nginx sample above:

```env
PORT=6050
HOST=0.0.0.0
API_KEY=replace-me
MAX_SMS_PER_DEVICE=500
CORS_ORIGIN=*
MAX_QUEUE_SIZE=1000
SQLITE_PATH=data/gateway.sqlite
SESSION_SECRET=replace-with-a-long-random-string
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-me
NODE_ENV=production
```

### WebSocket auth (contract)

On connect, the device sends:

```json
{ "type": "REGISTER", "deviceId": "<uuid>", "apiKey": "<same as env API_KEY>" }
```

`apiKey` must match env `API_KEY` (device-only). Account HTTP keys are not valid here.

If `apiKey` is missing or wrong, the gateway sends `{ "type": "ERROR", "error": "Unauthorized" }`, then closes the socket, and does **not** register the device.

Client must ack SMS jobs:

- Success: `{ "type": "SMS_SENT", "jobId": "<job.id>" }`
- Failure: `{ "type": "SMS_FAILED", "jobId": "<optional>", "reason": "<string>" }`

Full protocol table: root [`README.md`](../README.md).

---

## 🧪 Testing

Automated:

```bash
npm test
```

Manual:

1. Start the server (`node index.js`)
2. Open `/` (public landing) and `/docs` (integration guide)
3. Log in at `/login`, create an account, copy the key
4. Connect a WebSocket client / `sms_relay` with env `API_KEY`
4. Check logs:

```bash
pm2 logs sms-gateway
```

---

## ❗ Common Issues

### WebSocket connection fails
- Ensure `Upgrade` and `Connection` headers are set
- Check Nginx configuration

### Admin or send-otp 404 / connection refused on the domain
- Nginx must proxy `/`, not only `/ws`, to the same Node `PORT`
- Confirm `PORT` matches `proxy_pass`

### 502 Bad Gateway
- Node.js server is not running
- Nginx `proxy_pass` port does not match the process `PORT` (e.g. Nginx → `6050` but app still on `3000`)

### SSL issues
- Certificate not generated
- Incorrect certificate paths

### Process exits immediately in production
- Set `SESSION_SECRET` and a non-default `ADMIN_PASSWORD`
- Do not use `ADMIN_PASSWORD=admin`

---

## 🧠 Recommendations

- Use PM2 for process management
- Put a strong `API_KEY`, `SESSION_SECRET`, and `ADMIN_PASSWORD` in production
- Serve admin over HTTPS (`NODE_ENV=production`)
- Monitor device load and SMS limits

---

## 📦 Project Structure

```
sms-gateway/
├── index.js          HTTP + WS listen, loads dotenv
├── app.js            Express app (send-otp + admin)
├── ws.js             WebSocket, heartbeat, job dispatch
├── queue.js          In-memory queue (TTL 60 s)
├── devices.js        In-memory device Map + listDevices()
├── middleware.js     Account x-api-key guard for send-otp
├── config.js         Env: PORT, API_KEY, SQLITE_PATH, admin, …
├── db.js             better-sqlite3 open/schema
├── accounts.js       Account CRUD, hashed keys, quota
├── otp.js            OTP generate + message template
├── admin/            Login, accounts CRUD, devices page
├── views/            EJS layouts and pages
├── public/           Admin CSS
├── data/             SQLite file (gitignored)
├── test/             node --test
├── .env.example
├── .env              local only; not committed
└── README.md
```

---

## 🔥 Summary

To get everything working:

1. Copy `.env.example` to `.env` and set secrets
2. Run the Node.js server
3. Confirm `/` is the public landing and `/docs` is the client guide; log in at `/login`, create an account, copy the API key
4. Configure Nginx to proxy `/ws` **and** `/` (landing, `/docs`, admin, `/api`) to the same `PORT`
5. Enable SSL
6. Connect devices via `wss://YOUR_DOMAIN/ws` with env `API_KEY`
7. Call `POST /api/send-otp` with the **account** `x-api-key` and `{ "phone" }`
