# Voice Team - WebRTC Click-to-Call Widget

<a href="https://render.com/deploy?repo=https://github.com/YOUR_USERNAME/WebRTC-VoiceTeam">
  <img src="https://render.com/images/deploy-to-render-button.svg" alt="Deploy to Render" height="32">
</a>

A modern WebRTC click-to-call widget with iOS 17-inspired UI, powered by AudioCodes SBC.

## ✨ Features

- **WebRTC Audio/Video Calls** via AudioCodes SBC (Session Border Controller)
- **iOS 17 Design** — Frosted glass, pill-shaped controls, Dynamic Island animation
- **Device Management** — Select microphone, speaker, camera
- **Device Test Panel** — Camera preview, mic level meter, speaker test
- **DTMF Keypad** — Send touch tones during calls
- **Screen Sharing** — Share your screen during calls
- **Debug Log Panel** — Real-time logging with SBC diagnostic tool
- **Settings Panel** — Configure SBC address, SIP user, call type, and more
- **Security Hardened** — CSP headers, XSS prevention, rate limiting, input validation

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- AudioCodes SBC with WebRTC enabled (or compatible WebRTC-to-SIP gateway)

### Local Development

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/WebRTC-VoiceTeam.git
cd WebRTC-VoiceTeam

# Start the development server
npm start
```

Open http://localhost:3000 in your browser.

### Configuration

Edit `conf/config.js` to set your SBC details:

```javascript
let c2c_serverConfig = {
    domain: 'sbc.yourcompany.com',
    addresses: ['wss://sbc.yourcompany.com:443'],
    ...
};
```

Or use the **Settings panel** (gear icon) in the app to configure without editing files.

## ☁️ Deploy on Render

### One-Click Deploy

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/YOUR_USERNAME/WebRTC-VoiceTeam)

### Manual Deploy

1. **Fork/clone this repo** to your GitHub account

2. **Create a new Web Service** on [Render Dashboard](https://dashboard.render.com)

3. **Connect your GitHub repo** (`WebRTC-VoiceTeam`)

4. **Settings:**
   - **Name:** `voice-team` (or your choice)
   - **Region:** Choose closest to your SBC
   - **Branch:** `main`
   - **Build Command:** *(leave empty — no build needed)*
   - **Start Command:** `node server.js`
   - **Plan:** Free

5. **Environment Variables** (optional):
   - `PORT` — Set to `10000` (Render default)

6. **Click "Create Web Service"**

7. **Update `conf/config.js`** with your SBC address, or use the Settings panel after deployment

> ⚠ **Important:** Configure your SBC to allow connections from Render's IP ranges. See [Render Outbound IPs](https://render.com/docs/outbound-ip-addresses).

### Post-Deploy Checklist

- [ ] Set your SBC domain in `conf/config.js`
- [ ] Configure SBC WebSocket address (wss://...)
- [ ] Set SIP user/caller details
- [ ] Enable HTTPS (Render provides this automatically)
- [ ] Test WebSocket connectivity via Debug Log → "Test SBC"
- [ ] Test a call

## 🛡️ Security

This project follows security best practices:

- **Content-Security-Policy** headers restrict script/style sources
- **XSS prevention** — All user-controlled data uses `textContent` or `c2c_escapeHtml()`
- **Input validation** — URL parameters are validated with regex
- **Rate limiting** — Dev server limits requests (100/min per IP)
- **Directory traversal prevention** — Server validates file paths
- **No hardcoded secrets** — Configuration uses placeholders
- **Minimal attack surface** — Only GET/HEAD requests allowed

## 📁 Project Structure

```
WebRTC-VoiceTeam/
├── conf/config.js          # SBC and call configuration
├── css/c2c.css             # iOS 17-style UI stylesheet
├── html/
│   ├── index.html          # Main widget page
│   └── debug.html          # Standalone debug log window
├── js/
│   ├── c2c.js              # Core widget logic (~2200 lines)
│   ├── c2c_utils.js        # Audio player, device selection utilities
│   ├── voice_quality.js    # Optional browser voice quality test
│   └── ac_webrtc.min.js    # AudioCodes WebRTC SDK (v1.21.0)
├── sounds/                 # Sound files for tones/beeps
├── docs/                   # Documentation
├── server.js               # Static file server (dev & production)
├── package.json
└── .env.example            # Environment variable template
```

## ❓ Troubleshooting

### "Cannot connect to SBC server"

1. Open **Debug Log** (top-right)
2. Click **"Test SBC"** to run a WebSocket connectivity test
3. Check that your SBC is configured for WebRTC (WebSocket + SIP)
4. Verify firewall allows outbound connections to port 443

### SBC Configuration (AudioCodes v7.40)

See [SBC Configuration Guide](docs/sbc-config-guide.md) or the comments in `conf/config.js`.

## 📄 License

MIT