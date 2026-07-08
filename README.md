# Voice Team - WebRTC Click-to-Call Widget

<a href="https://render.com/deploy?repo=https://github.com/VichyaS/WebRTC-VoiceTeam">
  <img src="https://render.com/images/deploy-to-render-button.svg" alt="Deploy to Render" height="32">
</a>

A modern WebRTC click-to-call widget with iOS 17-inspired UI, powered by AudioCodes SBC.

## ✨ Features

- **WebRTC Audio/Video Calls** via AudioCodes SBC (Session Border Controller)
- **iOS 17 Design** — Frosted glass, pill-shaped controls, Dynamic Island animation
- **🔐 Okta SSO / LDAP Authentication** — Auto-populates SBC config from user profile
- **Device Management** — Select microphone, speaker, camera
- **Device Test Panel** — Camera preview, mic level meter, speaker test
- **DTMF Keypad** — Send touch tones during calls
- **Screen Sharing** — Share your screen during calls
- **Debug Log Panel** — Real-time logging with SBC diagnostic tool
- **Settings Panel** — Configure SBC address, SIP user, call type, and more
- **Security Hardened** — CSP headers, LDAP injection prevention, rate limiting, input validation

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- AudioCodes SBC with WebRTC enabled (or compatible WebRTC-to-SIP gateway)
- (Optional) Okta Developer account or LDAP/AD server

### Local Development

```bash
# Clone the repository
git clone https://github.com/VichyaS/WebRTC-VoiceTeam.git
cd WebRTC-VoiceTeam

# Install dependencies
npm install

# Copy and configure environment variables
cp .env.example .env
# Edit .env with your Okta/LDAP credentials

# Start the development server
npm start
```

Open http://localhost:3000 in your browser.

---

## 🔐 Authentication System

The app supports **three authentication modes**:

### 1. Okta SSO (OIDC) — Recommended

Set these environment variables:

```bash
OIDC_ISSUER=https://your-org.okta.com
OIDC_CLIENT_ID=0oaXXXXXXXXXXXXXXXXX
OIDC_CLIENT_SECRET=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
OIDC_CALLBACK_URL=http://localhost:3000/api/auth/callback
```

**Okta Admin Console Setup:**
1. Create a **Web Application** (OpenID Connect)
2. Set **Login redirect URIs** to `http://localhost:3000/api/auth/callback`
3. Grant **Okta API Scopes**: `okta.users.read.self`
4. **Profile Editor** → Add custom attributes: `sbcDomain`, `sbcAddresses`, `sipCall`, `sipCaller`, `displayName`
5. **Directory → People** → Fill in attribute values per user

### 2. LDAP / Active Directory

```bash
LDAP_URL=ldap://your-ad-server:389
LDAP_BASE_DN=dc=yourcompany,dc=com
LDAP_BIND_DN=cn=admin,dc=yourcompany,dc=com
LDAP_BIND_PASSWORD=your-password
LDAP_SEARCH_FILTER=(uid={{username}})
```

### 3. Local Demo Users (development only)

Edit `conf/ad_users.json` (gitignored for security).
Demo users are automatically **disabled** when OIDC or LDAP is configured.

---

## ☁️ Deploy on Render

### One-Click Deploy

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/VichyaS/WebRTC-VoiceTeam)

### Manual Deploy

1. **Fork/clone this repo** to your GitHub account

2. **Create a new Web Service** on [Render Dashboard](https://dashboard.render.com)

3. **Connect your GitHub repo** (`WebRTC-VoiceTeam`)

4. **Settings:**
   - **Name:** `voice-team` (or your choice)
   - **Region:** Choose closest to your SBC
   - **Branch:** `main`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** Free

5. **Environment Variables** — Add these in Render dashboard:

   ```bash
   # Required
   PORT=10000
   
   # For Okta SSO (required for authentication)
   OIDC_ISSUER=https://your-org.okta.com
   OIDC_CLIENT_ID=0oaXXXXXXXXXXXXXXXXX
   OIDC_CLIENT_SECRET=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   OIDC_CALLBACK_URL=https://your-app.onrender.com/api/auth/callback
   ```

6. **Click "Create Web Service"**

> ⚠ **Important:** Configure your SBC to allow connections from Render's IP ranges. See [Render Outbound IPs](https://render.com/docs/outbound-ip-addresses).

### Post-Deploy Checklist

- [ ] Set Okta/LDAP env vars in Render dashboard
- [ ] Configure SBC WebSocket address (in Okta user profile)
- [ ] Set SIP user/caller details (in Okta user profile)
- [ ] Enable HTTPS (Render provides this automatically)
- [ ] Test WebSocket connectivity via Debug Log → "Test SBC"
- [ ] Test login via Okta SSO → user menu → verify auto-populated config

### How Authentication Works on Render

1. User visits `https://your-app.onrender.com`
2. Server checks if OIDC/LDAP is configured (via env vars)
3. If configured → **redirects to login page** (`/html/login.html`)
4. Login page shows **Okta SSO button** (if OIDC enabled) + **username/password form** (if LDAP enabled)
5. After successful login → redirects to main widget
6. User menu shows auto-populated SBC config from Okta profile

---

## 🛡️ Security

This project follows security best practices:

- **Content-Security-Policy** headers restrict script/style sources
- **XSS prevention** — All user-controlled data uses `textContent` or `c2c_escapeHtml()`
- **Input validation** — Username/password validated for charset and length
- **LDAP injection protection** — Special characters sanitized before LDAP queries
- **JSON body size limit** — Max 10KB to prevent DOS attacks
- **Rate limiting** — Dev server limits requests (100/min per IP)
- **Directory traversal prevention** — Server validates file paths
- **HttpOnly cookies** — Session tokens not accessible via JavaScript
- **Session TTL** — Sessions expire after 24 hours
- **No hardcoded secrets** — All credentials via environment variables
- **Minimal attack surface** — Only GET/HEAD requests allowed

## 📁 Project Structure

```
WebRTC-VoiceTeam/
├── conf/
│   ├── config.js             # SBC and call configuration
│   └── ad_users.json         # Local demo users (gitignored)
├── css/c2c.css               # iOS 17-style UI stylesheet
├── html/
│   ├── index.html            # Main widget page
│   └── login.html            # Login page (Okta/LDAP auth)
├── js/
│   ├── c2c.js                # Core widget logic
│   ├── c2c_utils.js          # Audio player, device selection utilities
│   ├── voice_quality.js      # Optional browser voice quality test
│   └── ac_webrtc.min.js      # AudioCodes WebRTC SDK (v1.21.0)
├── sounds/                   # Sound files for tones/beeps
├── server.js                 # HTTP server with auth API endpoints
├── package.json
├── .env.example              # Environment variable template
├── render.yaml               # Render deployment config
└── README.md
```

## 🔧 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/login` | POST | LDAP/Demo user login |
| `/api/logout` | POST | Clear session |
| `/api/session` | GET | Check authentication status |
| `/api/auth/status` | GET | Check if OIDC is configured |
| `/api/auth/login` | GET | Redirect to Okta SSO |
| `/api/auth/callback` | GET | Okta OAuth callback |
| `/api/auth/diagnose` | GET | Debug session attributes |

## ❓ Troubleshooting

### "Cannot connect to SBC server"

1. Open **Debug Log** (top-right)
2. Click **"Test SBC"** to run a WebSocket connectivity test
3. Check that your SBC is configured for WebRTC (WebSocket + SIP)
4. Verify firewall allows outbound connections to port 443

### Okta SSO button not showing

1. Verify env vars are set: `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`
2. Check `GET /api/auth/status` returns `{"oidcEnabled":true}`
3. Ensure **Okta API Scopes** includes `okta.users.read.self`

### SBC Configuration (AudioCodes v7.40)

See [SBC Configuration Guide](docs/sbc-config-guide.md) or the comments in `conf/config.js`.

## 📄 License

MIT