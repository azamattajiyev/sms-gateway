# 📡 SMS Gateway

A Node.js WebSocket-based SMS Gateway that allows sending SMS messages through connected devices.

---

## 🚀 Features

- WebSocket-based device connection
- Load balancing between devices
- SMS rate limiting per device
- Message queue system
- Secure communication via WSS (Nginx + SSL)

---

## 🖥️ Installation (Ubuntu)

### 1. Install dependencies

```bash
sudo apt update
sudo apt install -y nodejs npm nginx
```

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

### 4. Run the server

```bash
node index.js
```

Or using PM2 (recommended):

```bash
npm install -g pm2
pm2 start index.js --name sms-gateway
pm2 save
pm2 startup
```

---

## 🌐 Nginx Configuration (WebSocket + SSL)

### ⚠️ Important

WebSocket requires proper headers (`Upgrade` and `Connection`) to work correctly.

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

---

## ⚙️ Environment Variables

Create a `.env` file:

```env
PORT=6050
MAX_SMS_PER_DEVICE=50
```

---

## 🧪 Testing

1. Start the server
2. Connect using a WebSocket client
3. Check logs:

```bash
pm2 logs sms-gateway
```

---

## ❗ Common Issues

### WebSocket connection fails
- Ensure `Upgrade` and `Connection` headers are set
- Check Nginx configuration

### 502 Bad Gateway
- Node.js server is not running
- Incorrect port in Nginx config

### SSL issues
- Certificate not generated
- Incorrect certificate paths

---

## 🧠 Recommendations

- Use PM2 for process management
- Add logging for connected devices
- Monitor device load and SMS limits

---

## 📦 Project Structure (example)

```
sms-gateway/
│
├── index.js
├── devices.js
├── queue.js
├── config.js
├── .env
└── README.md
```

---

## 🔥 Summary

To get everything working:

1. Run the Node.js server
2. Configure Nginx
3. Enable SSL
4. Connect via `wss://YOUR_DOMAIN/ws`

