# Voice Team - WebRTC Click-to-Call Widget

<a href="https://render.com/deploy?repo=https://github.com/VichyaS/WebRTC-VoiceTeam">
  <img src="https://render.com/images/deploy-to-render-button.svg" alt="Deploy to Render" height="32">
</a>

A modern WebRTC click-to-call widget with iOS 17-inspired UI, powered by AudioCodes SBC. Supports **Okta SSO**, **LDAP/AD**, and **local demo** authentication with encrypted configuration management.

## ✨ Features

- **WebRTC Audio/Video Calls** via AudioCodes SBC (Session Border Controller)
- **iOS 17 Design** — Frosted glass, pill-shaped controls, Dynamic Island animation
- **🔐 Okta SSO / LDAP Authentication** — Auto-populates SBC config from user profile
- **🔒 Encrypted Config Manager** — AES-256-GCM encrypted SSO settings via Admin UI
- **Device Management** — Select microphone, speaker, camera
- **Device Test Panel** — Camera preview, mic level meter, speaker test
- **DTMF Keypad** — Send touch tones during calls
- **Screen Sharing** — Share your screen during calls
- **Debug Log Panel** — Real-time logging with SBC diagnostic tool
- **Settings Panel** — Configure SBC address, SIP user, call type, and more
- **Security Hardened** — CSP, HSTS, rate limiting, LDAP injection prevention, JWT verification

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
```

> **Note:** `OIDC_CALLBACK_URL` is auto-detected from the request host — no need to hardcode it.

**Okta Admin Console Setup:**
1. Create a **Web Application** (OpenID Connect)
2. Set **Login redirect URIs** to `https://your-app.com/api/auth/callback`
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

## 🔒 Encrypted SSO Config Manager

Configure SSO credentials through a secure web UI instead of editing environment variables directly.

### How it works

1. Set `ADMIN_CONFIG_PASSWORD` as an environment variable (strong password, 16+ chars)
2. Visit `/html/admin.html` → enter password → unlock configuration panel
3. Fill in OIDC/LDAP settings → click **Save & Encrypt**
4. Data is encrypted with **AES-256-GCM** (PBKDF2 key derivation, 100K iterations)
5. Encrypted payload is stored in `conf/sso_config.enc` (local) or `SSO_ENCRYPTED_CONFIG` env var (Render)

### For Render Deployment

Render has an **ephemeral filesystem** — files are deleted on every deploy. After saving config:

1. Copy the encrypted payload from the Admin UI
2. Go to **Render Dashboard** → Environment Variables
3. Add `SSO_ENCRYPTED_CONFIG` with the copied payload
4. Deploy — the config persists across all future deploys

### Security

| Layer | Protection |
|---|---|
| **Encryption** | AES-256-GCM with random salt + IV per encryption |
| **Key Derivation** | PBKDF2 with 100,000 iterations |
| **Secrets Masking** | API responses show only first/last 4 chars |
| **Session Auth** | Admin session expires after 1 hour |
| **File Storage** | Encrypted blob — unreadable without password |

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
   
   # For Admin UI (optional but recommended)
   ADMIN_CONFIG_PASSWORD=your-strong-admin-password
   ```

6. **Click "Create Web Service"**

> ⚠ **Important:** Configure your SBC to allow connections from Render's IP ranges. See [Render Outbound IPs](https://render.com/docs/outbound-ip-addresses).

### Post-Deploy Checklist

- [ ] Set Okta/LDAP env vars in Render dashboard
- [ ] (Optional) Set `ADMIN_CONFIG_PASSWORD` for Admin UI
- [ ] Configure SBC WebSocket address (in Okta user profile)
- [ ] Set SIP user/caller details (in Okta user profile)
- [ ] Enable HTTPS (Render provides this automatically)
- [ ] Test WebSocket connectivity via Debug Log → "Test SBC"
- [ ] Test login via Okta SSO → user menu → verify auto-populated config

---

## 🛡️ Security

### Security Headers

| Header | Value |
|--------|-------|
| `Content-Security-Policy` | Restricts script/style sources, form actions, frame ancestors |
| `Strict-Transport-Security` | max-age=1 year, includeSubDomains |
| `X-Content-Type-Options` | nosniff |
| `X-Frame-Options` | DENY |
| `Referrer-Policy` | no-referrer |
| `Permissions-Policy` | camera=(), microphone=(), geolocation=() |

### Authentication Security

- **OIDC JWT Verification** — All ID tokens are cryptographically verified via JWKS (RS256)
- **CSRF Protection** — OIDC state parameter with random tokens
- **HttpOnly + Secure + SameSite=Strict** cookies — Session tokens protected from XSS/CSRF
- **Session TTL** — Sessions expire after 24 hours
- **Admin Session** — Short-lived (1 hour), separate from user sessions

### Input Validation & Injection Prevention

- **LDAP Injection** — All RFC 4515 special characters sanitized before queries
- **JSON Body Size Limit** — Max 10KB to prevent DOS attacks
- **Username Validation** — Only printable ASCII characters allowed
- **Path Traversal Prevention** — Server validates all file paths

### Rate Limiting

- **100 requests/min per IP** — Protects against brute-force and DOS attacks
- Applied to all API endpoints and static file requests

### Deployment Security

- **No hardcoded secrets** — All credentials via environment variables
- **Demo users disabled** automatically when OIDC/LDAP configured
- **Encrypted config storage** — AES-256-GCM with PBKDF2
- **Minimal attack surface** — Only GET/HEAD requests allowed for static files

---

## 📁 Project Structure

```
WebRTC-VoiceTeam/
├── conf/
│   ├── config.js             # SBC and call configuration
│   ├── ad_users.json         # Local demo users (gitignored)
│   └── sso_config.enc        # Encrypted SSO config (gitignored)
├── css/c2c.css               # iOS 17-style UI stylesheet
├── docs/
│   ├── ARCHITECTURE.md           # 🏗️ System architecture diagrams & flow docs
│   ├── WEBRTC_ARCHITECTURE.md    # 📞 WebRTC internals, log analysis & troubleshooting
│   └── IFRAME_ARCHITECTURE.md    # 🖼️ Iframe browser internals & security model
├── html/
│   ├── index.html            # Main widget page
│   ├── login.html            # Login page (Okta/LDAP auth)
│   └── admin.html            # Admin config UI (encrypted SSO manager)
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

## 🏗️ Architecture Diagrams

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed technical diagrams including:

- **System Architecture Overview** — Full component diagram
- **OIDC Okta SSO Flow** — Step-by-step sequence diagram
- **LDAP/AD Authentication Flow** — Server-to-LDAP interaction
- **Encrypted Config Manager Flow** — How AES-256-GCM config works
- **WebRTC Call Flow** — SIP signaling and media path
- **Render Deployment Architecture** — How it runs on Render
- **Config Data Flow** — How auth attributes reach the widget
- **Security Architecture** — All security layers

### 📞 WebRTC Architecture & Log Analysis

See [docs/WEBRTC_ARCHITECTURE.md](docs/WEBRTC_ARCHITECTURE.md) for in-depth documentation including:

- **WebRTC SDK Initialization** — Detailed sequence diagrams of engine startup
- **SIP Call State Machine** — All states from Idle → Connecting → Active → Terminating
- **Media Flow (SRTP/DTLS)** — ICE, DTLS handshake, and encrypted RTP flow
- **Logging System** — Logger hierarchy, format, prefix categories
- **Log Analysis Guide** — 5 error patterns with diagnosis and fixes
- **Troubleshooting Flowchart** — Step-by-step diagnostic workflow
- **SBC Diagnostic Tool** — Auto-scan ports/paths to find working WebSocket URL
- **Voice Quality Scoring** — Browser G.711 matrix + SBC X-VoiceQuality
- **Git Workflow** — Branch strategy, commit conventions, rollback commands

> 📘 **ต้องการดูเอกสารแบบเต็ม?** เปิด [docs/WEBRTC_ARCHITECTURE.md](docs/WEBRTC_ARCHITECTURE.md) โดยตรง หรือเปิดผ่าน local dev server ที่ `http://localhost:3000/docs/WEBRTC_ARCHITECTURE.md`

## 🔧 API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/login` | POST | Public | LDAP/Demo user login |
| `/api/logout` | POST | Session | Clear session |
| `/api/session` | GET | Public | Check authentication status |
| `/api/config` | GET | Session | Get user's SBC config attributes |
| `/api/auth/status` | GET | Public | Check if OIDC is configured |
| `/api/auth/login` | GET | Public | Redirect to Okta SSO |
| `/api/auth/callback` | GET | Public | Okta OAuth callback |
| `/api/auth/diagnose` | GET | Session | Debug session attributes |
| `/api/admin/login` | POST | Public | Admin password login |
| `/api/admin/config` | GET | Admin | Get current config summary |
| `/api/admin/config` | POST | Admin | Save encrypted SSO config |
| `/api/admin/config` | DELETE | Admin | Delete encrypted config |

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

### "redirect_uri mismatch" error from Okta

1. The callback URL is auto-detected from the request host
2. Ensure `https://your-app.onrender.com/api/auth/callback` is in Okta's **Login redirect URIs**
3. For local dev: `http://localhost:3000/api/auth/callback`

### Admin UI shows "Not authorized"

1. Ensure `ADMIN_CONFIG_PASSWORD` is set as an environment variable
2. After login, the session token is valid for 1 hour
3. If using `SSO_ENCRYPTED_CONFIG`, ensure `ADMIN_CONFIG_PASSWORD` matches the one used when saving

### SBC Configuration (AudioCodes v7.40)

See [SBC Configuration Guide](docs/sbc-config-guide.md) or the comments in `conf/config.js`.

**📖 เอกสารที่เกี่ยวข้อง:**
- [🏗️ System Architecture Overview](docs/ARCHITECTURE.md#1-system-architecture-overview) — ภาพรวมระบบ SBC + WebRTC
- [📞 WebRTC Call Flow](docs/ARCHITECTURE.md#5-webrtc-call-flow) — SIP signaling และ media path ผ่าน SBC
- [🔧 SBC Connection Diagnostic](docs/WEBRTC_ARCHITECTURE.md#52-diagnostic-tool-c2cdiagnosesbc) — วิธีใช้ SBC Diagnostic Tool ใน Debug Panel
- [🖼️ Iframe Security & Deployment](docs/IFRAME_ARCHITECTURE.md#84-content-security-policy-frame-ancestors) — CSP frame-ancestors สำหรับ SBC WebSocket

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.
