# 🏗️ Architecture Diagrams

## 1. System Architecture Overview

```mermaid
graph TB
    subgraph Client["🌐 Browser (Client)"]
        UI["iOS 17 UI<br/>html/index.html"]
        Login["Login Page<br/>html/login.html"]
        Admin["Admin UI<br/>html/admin.html"]
        WEBRTC["WebRTC SDK<br/>ac_webrtc.min.js"]
        AC["Audio Config<br/>conf/config.js"]
    end

    subgraph Server["🖥️ Node.js Server (server.js)"]
        HTTP["HTTP Server<br/>port 3000"]
        AUTH["🔐 Auth Module<br/>OIDC / LDAP / Demo"]
        SESSION["Session Store<br/>In-Memory Map"]
        RATE["Rate Limiter<br/>100 req/min/IP"]
        ENC["Encrypted Config<br/>AES-256-GCM"]
        CSP["Security Headers<br/>CSP / HSTS / CORS"]
    end

    subgraph AuthProviders["🔑 Authentication Providers"]
        OKTA["Okta OIDC<br/>(SSO)"]
        LDAP["LDAP / AD<br/>(JumpCloud etc.)"]
        DEMO["Demo Users<br/>conf/ad_users.json"]
    end

    subgraph SBC["📞 AudioCodes SBC"]
        WEBSOCKET["WebSocket<br/>wss://sbc:443"]
        SIP["SIP Signaling"]
        RTP["RTP Media"]
    end

    subgraph Storage["💾 Storage"]
        ENV["Environment Variables<br/>(Render Dashboard)"]
        SSO_ENC["SSO_ENCRYPTED_CONFIG<br/>(env var)"]
        LOCAL_ENC["conf/sso_config.enc<br/>(local file)"]
        SESSION_STORAGE["sessionStorage<br/>(browser)"]
    end

    Client -->|HTTP/HTTPS| Server
    Server -->|OIDC Authorization Code| OKTA
    Server -->|LDAP Bind| LDAP
    Server -->|Plaintext Check| DEMO
    Client -->|WebSocket| WEBSOCKET
    WEBSOCKET -->|SIP| SIP
    SIP -->|Media| RTP
    Server -->|Read| ENV
    Server -->|Decrypt| SSO_ENC
    Server -->|Decrypt| LOCAL_ENC
    Admin -->|Save & Encrypt| ENC
    ENC -->|Write| LOCAL_ENC
    ENC -->|Export Payload| SSO_ENC
    AC -->|Load| SESSION_STORAGE
```

## 2. Authentication Flow (OIDC / Okta SSO)

```mermaid
sequenceDiagram
    participant User as 👤 User
    participant Browser as 🌐 Browser
    participant Server as 🖥️ Node.js Server
    participant Okta as 🔑 Okta OIDC
    participant Session as 💾 Session Store

    Note over User,Browser: Step 1: Access Main Page
    Browser->>Server: GET /html/index.html
    Server->>Browser: 302 Redirect → /html/login.html
    Browser->>Server: GET /html/login.html
    Server-->>Browser: Login page (SSO button visible)

    Note over User,Browser: Step 2: Click SSO Button
    User->>Browser: Click "Sign in with Okta / SSO"
    Browser->>Server: GET /api/auth/login
    Server->>Server: Generate state param (CSRF)
    Server->>Browser: 302 Redirect → Okta Authorize URL
    Browser->>Okta: Authorization Request (client_id, redirect_uri, state)

    Note over User,Browser: Step 3: Login at Okta
    Okta-->>User: Okta Login Page
    User->>Okta: Enter credentials + MFA
    Okta->>Browser: 302 Redirect → /api/auth/callback?code=xxx&state=yyy

    Note over Browser,Session: Step 4: Token Exchange
    Browser->>Server: GET /api/auth/callback?code=xxx&state=yyy
    Server->>Server: Verify state (CSRF check)
    Server->>Okta: POST /oauth2/v1/token (code → id_token + access_token)
    Okta-->>Server: id_token (RS256 signed JWT)
    Server->>Server: Verify JWT signature via JWKS (RS256)
    Server->>Server: Extract user attributes (domain, addresses, call, caller)
    Server->>Session: Create session (token → {user, attributes})
    Server->>Browser: 302 Redirect → / + Set-Cookie (HttpOnly, Secure, SameSite)

    Note over User,Browser: Step 5: Authenticated Access
    Browser->>Server: GET / (with session cookie)
    Server->>Session: Validate session
    Server-->>Browser: Main widget page
    Browser->>Server: GET /api/config
    Server-->>Browser: {attributes: {domain, addresses, call, caller}}
```

## 3. Authentication Flow (LDAP / AD)

```mermaid
sequenceDiagram
    participant User as 👤 User
    participant Browser as 🌐 Browser
    participant Server as 🖥️ Node.js Server
    participant LDAP as 📂 LDAP / AD
    participant Session as 💾 Session Store

    User->>Browser: Enter username + password
    Browser->>Server: POST /api/login {username, password}
    
    Server->>Server: Validate input (charset, length, LDAP sanitize)
    
    alt LDAP Configured
        Server->>LDAP: Bind with service account (search user)
        LDAP-->>Server: User DN
        Server->>LDAP: Bind with user credentials (verify password)
        LDAP-->>Server: Success
        Server->>LDAP: Search user attributes
        LDAP-->>Server: {sbcDomain, sbcAddresses, sipCall, ...}
        Server->>Server: Map LDAP attributes → config
    else Demo Users
        Server->>Session: Lookup demo user
        Session-->>Server: {attributes}
    end

    Server->>Session: Create session (token → {user, attributes})
    Server->>Browser: 200 + Set-Cookie (HttpOnly, Secure, SameSite)
    Browser->>Server: GET /api/config (with cookie)
    Server-->>Browser: {attributes: {domain, addresses, call, caller}}
    Note over Browser: Auto-populate config.js
```

## 4. Encrypted Config Manager Flow

```mermaid
sequenceDiagram
    participant Admin as 👤 Admin
    participant AdminUI as 📋 Admin UI<br/>html/admin.html
    participant Server as 🖥️ Server
    participant Disk as 💾 Encrypted File
    participant Render as ☁️ Render Env Vars

    Note over Admin,Render: Step 1: Setup ADMIN_CONFIG_PASSWORD
    Admin->>Render: Set ADMIN_CONFIG_PASSWORD=strong-password
    Note over Admin,Render: Step 2: Access Admin UI
    Admin->>AdminUI: GET /html/admin.html
    AdminUI-->>Admin: Login form
    Admin->>AdminUI: Enter admin password
    AdminUI->>Server: POST /api/admin/login {password}
    Server->>Server: Compare password
    Server-->>AdminUI: {token, config summary}

    Note over Admin,Render: Step 3: Configure SSO
    Admin->>AdminUI: Fill OIDC/LDAP fields
    Admin->>AdminUI: Click "Save & Encrypt"
    AdminUI->>Server: POST /api/admin/config {oidc: {...}, ldap: {...}}
    Server->>Server: AES-256-GCM Encrypt
    
    alt Local Development
        Server->>Disk: Write conf/sso_config.enc
        Disk-->>Server: Saved
        Server-->>AdminUI: {success, encryptedConfigPayload}
        AdminUI-->>Admin: ✅ Saved locally
    else Render Deployment
        Server->>Disk: Write conf/sso_config.enc (ephemeral!)
        Server-->>AdminUI: {success, encryptedConfigPayload}
        AdminUI-->>Admin: 📋 Copy encrypted payload
        Admin->>Render: Paste payload as SSO_ENCRYPTED_CONFIG
        Admin->>Render: Deploy (restart)
        Render-->>Server: SSO_ENCRYPTED_CONFIG env var
        Server->>Server: Decrypt AES-256-GCM → merge into process.env
        Server->>Server: OIDC_ENABLED = true ✅
    end
```

## 5. WebRTC Call Flow

```mermaid
sequenceDiagram
    participant User as 👤 User
    participant Browser as 🌐 Browser
    participant SBC as 📞 AudioCodes SBC
    participant Phone as ☎️ SIP Phone

    Note over User,Phone: Step 1: Initiate Call
    User->>Browser: Click call button
    Browser->>Browser: Get constraints from config
    Browser->>Browser: getUserMedia({audio, video})
    Browser-->>User: Permission prompt
    User->>Browser: Allow
    
    Note over Browser,SBC: Step 2: WebSocket Connection
    Browser->>SBC: WebSocket connect (wss://sbc:443)
    SBC-->>Browser: WebSocket established
    
    Note over Browser,SBC: Step 3: SIP Registration
    Browser->>SBC: SIP Register (user@domain)
    SBC-->>Browser: 200 OK
    
    Note over Browser,Phone: Step 4: SIP Call
    Browser->>SBC: SIP INVITE (sip:destination@sbc)
    SBC->>Phone: Route call to SIP trunk
    Phone-->>SBC: 180 Ringing
    SBC-->>Browser: 180 Ringing
    Browser->>Browser: Play ringing tone
    
    Phone-->>SBC: 200 OK (SDP answer)
    SBC-->>Browser: 200 OK (SDP answer)
    
    Note over Browser,Phone: Step 5: Media Exchange
    Browser->>SBC: SRTP/DTSLTP (audio/video)
    SBC->>Phone: RTP (audio/video)
    Phone->>SBC: RTP (audio/video)
    SBC->>Browser: SRTP/DTSLTP (audio/video)
    
    Note over Browser,Phone: Step 6: End Call
    User->>Browser: Click hangup
    Browser->>SBC: SIP BYE
    SBC->>Phone: SIP BYE
    Phone-->>SBC: 200 OK
    SBC-->>Browser: 200 OK
    Browser->>Browser: Close WebSocket
```

## 6. Deployment Architecture on Render

```mermaid
graph TB
    subgraph Internet["🌍 Internet"]
        User["👤 User"]
        Admin["👤 Admin"]
        Okta["🔑 Okta OIDC"]
    end

    subgraph Render["☁️ Render Cloud"]
        subgraph WebService["Web Service (Node.js)"]
            SERVER["server.js<br/>Node 18+"]
            CONFIG["conf/config.js<br/>Static Config"]
        end
        
        subgraph EnvVars["Environment Variables"]
            OIDC["OIDC_ISSUER<br/>OIDC_CLIENT_ID<br/>OIDC_CLIENT_SECRET"]
            ADMIN_PW["ADMIN_CONFIG_PASSWORD"]
            SSO_ENC["SSO_ENCRYPTED_CONFIG"]
        end
        
        subgraph Logs["Logs & Monitoring"]
            RENDER_LOGS["Render Logs"]
        end

        subgraph Ephemeral["⚠️ Ephemeral Filesystem"]
            SSO_FILE["conf/sso_config.enc<br/>(deleted on deploy)"]
        end
    end

    subgraph Enterprise["🏢 Enterprise Network"]
        SBC["📞 AudioCodes SBC<br/>WebSocket + SIP"]
        LDAP["📂 LDAP / AD Server"]
    end

    User -->|HTTPS| WebService
    Admin -->|HTTPS| WebService
    WebService -->|OIDC Auth| Okta
    WebService -->|LDAP Bind| LDAP
    WebService -->|WebSocket| SBC
    SERVER -->|Reads| EnvVars
    SERVER -->|Decrypt| SSO_ENC
    SERVER -->|Write local only| Ephemeral
    SERVER -->|Logs| RENDER_LOGS
    CONFIG -->|Served to Browser| User
```

## 7. Data Flow: Config Attributes from Auth to Widget

```mermaid
flowchart LR
    subgraph AuthSource["🔑 Auth Source"]
        OKTA_PROFILE["Okta Profile<br/>sbcDomain, sbcAddresses<br/>sipCall, sipCaller, displayName"]
        LDAP_ATTR["LDAP Attributes<br/>(mapped via config)"]
        DEMO_ATTR["Demo Users JSON<br/>conf/ad_users.json"]
    end

    subgraph ServerProcess["🖥️ Server Processing"]
        EXTRACT["extractOidcAttributes()<br/>or mapLdapAttributes()"]
        SESSION["Session Store<br/>{user, attributes}"]
        API_CONFIG["GET /api/config"]
    end

    subgraph ClientProcess["🌐 Browser Merge"]
        STATIC["conf/config.js<br/>(Static Defaults)"]
        MERGE["c2c_applyADConfig()<br/>Merge attributes → config"]
        WIDGET["Widget Uses<br/>Config Values"]
    end

    AuthSource -->|Login Success| EXTRACT
    EXTRACT -->|domain, addresses, call, caller, callerDN| SESSION
    SESSION -->|With Session Cookie| API_CONFIG
    API_CONFIG -->|JSON Response| MERGE
    STATIC -->|Default Values| MERGE
    MERGE -->|Final Config| WIDGET
```

## 8. Security Architecture

```mermaid
graph TB
    subgraph Incoming["📥 Incoming Request"]
        REQ["HTTP Request"]
    end

    subgraph SecurityLayer["🛡️ Security Layers"]
        RATE["Rate Limiter<br/>100 req/min/IP"]
        CSP["CSP Headers<br/>script-src 'self'<br/>form-action 'self'"]
        HSTS["Strict-Transport-Security<br/>max-age=1 year"]
        PERM["Permissions-Policy<br/>camera=(self)<br/>microphone=(self)"]
    end

    subgraph AuthLayer["🔐 Authentication Layer"]
        SESSION_CHECK["Session Validation<br/>(HttpOnly Cookie)"]
        OIDC_VERIFY["OIDC JWT Verify<br/>(RS256 via JWKS)"]
        LDAP_SANITIZE["LDAP Injection<br/>Prevention"]
        INPUT_VALID["Input Validation<br/>(charset, length)"]
    end

    subgraph DataProtection["🔒 Data Protection"]
        COOKIE_SECURE["Secure Cookie<br/>HttpOnly + Secure + SameSite"]
        AES_GCM["AES-256-GCM<br/>Encrypted Config"]
        PBKDF2["PBKDF2 Key Derivation<br/>100,000 iterations"]
        MASKING["Secrets Masking<br/>(first/last 4 chars)"]
    end

    Incoming --> RATE
    RATE --> CSP
    CSP --> HSTS
    HSTS --> PERM
    PERM --> SESSION_CHECK
    SESSION_CHECK --> OIDC_VERIFY
    SESSION_CHECK --> LDAP_SANITIZE
    SESSION_CHECK --> INPUT_VALID
    OIDC_VERIFY --> COOKIE_SECURE
    LDAP_SANITIZE --> COOKIE_SECURE
    AES_GCM --> PBKDF2
    PBKDF2 --> MASKING
```

---

## 📁 Diagram Files

| File | Description |
|------|-------------|
| `docs/ARCHITECTURE.md` | Full architecture documentation (this file) |

> 💡 These diagrams use [Mermaid](https://mermaid.js.org/) syntax — GitHub renders them automatically in Markdown files.