/**
 * Voice Team - Click to Call Server
 *
 * ⚠ PRODUCTION SERVER — Configure via environment variables.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const https = require('https');
const querystring = require('querystring');

// LDAP module is loaded lazily inside authenticateViaLDAP() — only when needed

// Load .env file (local development only — Render uses env vars directly)
try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        for (const line of envContent.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx === -1) continue;
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            // Strip quotes if present
            if ((val.startsWith('"') && val.endsWith('"')) || 
                (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
            }
            if (!process.env[key]) {
                process.env[key] = val;
            }
        }
    }
} catch (e) {
    // Silently ignore — .env is optional
}

// Load encrypted SSO config from conf/sso_config.enc (if ADMIN_CONFIG_PASSWORD is set)
// This MUST run before OIDC/LDAP const declarations below
const ADMIN_CONFIG_PASSWORD = process.env.ADMIN_CONFIG_PASSWORD || '';
const SSO_CONFIG_FILE = path.join(__dirname, 'conf', 'sso_config.enc');
loadEncryptedConfig();

const PORT = process.env.PORT || 3000;
// Auto-detect Render cloud environment — bind to 0.0.0.0 so Render can detect the port
const isRender = !!process.env.RENDER;
const BIND_ADDR = process.env.BIND_ADDR || (isRender ? '0.0.0.0' : '127.0.0.1');

const MIME_TYPES = new Map([
    ['.html', 'text/html; charset=utf-8'],
    ['.css', 'text/css; charset=utf-8'],
    ['.js', 'application/javascript; charset=utf-8'],
    ['.json', 'application/json'],
    ['.svg', 'image/svg+xml'],
    ['.png', 'image/png'],
    ['.mp3', 'audio/mpeg'],
    ['.wav', 'audio/wav'],
    ['.ico', 'image/x-icon']
]);

// Security headers
const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "media-src 'self' blob:",
        "img-src 'self' data: blob:",
        "connect-src 'self' ws: wss: https:",
        "font-src 'self' https://fonts.gstatic.com",
        "form-action 'self'",
        "frame-ancestors 'none'"
    ].join('; ')
};

// Simple in-memory rate limiter
const rateLimit = new Map();
const RATE_WINDOW = 60000;
const RATE_MAX = 100;

function isRateLimited(ip) {
    const now = Date.now();
    const timestamps = (rateLimit.get(ip) || []).filter(t => now - t < RATE_WINDOW);
    timestamps.push(now);
    rateLimit.set(ip, timestamps);
    return timestamps.length > RATE_MAX;
}

// ──────────────────────────────────────────────
// Encrypted SSO Configuration (AES-256-GCM)
// ──────────────────────────────────────────────

/**
 * Derive a 256-bit key from the admin password using PBKDF2.
 */
function deriveKey(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha512');
}

/**
 * Encrypt an object to a base64 string using AES-256-GCM.
 * Returns format: salt:iv:tag:ciphertext (all base64-encoded)
 */
function encryptConfig(obj, password) {
    if (!password) throw new Error('ADMIN_CONFIG_PASSWORD not set');
    const salt = crypto.randomBytes(16);
    const key = deriveKey(password, salt);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const json = JSON.stringify(obj);
    let encrypted = cipher.update(json, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const tag = cipher.getAuthTag();
    return salt.toString('base64') + ':' + iv.toString('base64') + ':' + tag.toString('base64') + ':' + encrypted;
}

/**
 * Decrypt a base64 string (salt:iv:tag:ciphertext) back to an object using AES-256-GCM.
 */
function decryptConfig(payload, password) {
    if (!password) throw new Error('ADMIN_CONFIG_PASSWORD not set');
    const parts = payload.split(':');
    if (parts.length !== 4) throw new Error('Invalid encrypted payload format');
    const salt = Buffer.from(parts[0], 'base64');
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const encrypted = parts[3];
    const key = deriveKey(password, salt);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
}

/**
 * Load encrypted config from env var SSO_ENCRYPTED_CONFIG or from disk file.
 * Returns true if config was loaded, false otherwise.
 */
function loadEncryptedConfig() {
    if (!ADMIN_CONFIG_PASSWORD) return false;

    let payload = '';

    // Try env var first (works on Render — env vars persist across deploys)
    if (process.env.SSO_ENCRYPTED_CONFIG) {
        payload = process.env.SSO_ENCRYPTED_CONFIG;
    }
    // Fall back to disk file (works locally)
    else if (fs.existsSync(SSO_CONFIG_FILE)) {
        payload = fs.readFileSync(SSO_CONFIG_FILE, 'utf8').trim();
    }

    if (!payload) return false;

    try {
        const config = decryptConfig(payload, ADMIN_CONFIG_PASSWORD);

        // Merge OIDC settings (only if not already set by environment variables)
        const oidcFields = ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET',
            'OIDC_CALLBACK_URL', 'OIDC_AUTHZ_ENDPOINT', 'OIDC_TOKEN_ENDPOINT',
            'OIDC_USERINFO_ENDPOINT', 'OIDC_JWKS_ENDPOINT', 'OIDC_SCOPE',
            'OIDC_ATTR_DOMAIN', 'OIDC_ATTR_ADDRESSES', 'OIDC_ATTR_CALL',
            'OIDC_ATTR_CALLER', 'OIDC_ATTR_CALLER_DN'];
        const ldapFields = ['LDAP_URL', 'LDAP_BASE_DN', 'LDAP_BIND_DN',
            'LDAP_BIND_PASSWORD', 'LDAP_SEARCH_FILTER',
            'LDAP_ATTR_DOMAIN', 'LDAP_ATTR_ADDRESSES', 'LDAP_ATTR_CALL',
            'LDAP_ATTR_CALLER', 'LDAP_ATTR_CALLER_DN'];

        if (config.oidc && typeof config.oidc === 'object') {
            for (const key of oidcFields) {
                if (config.oidc[key] !== undefined && !process.env[key]) {
                    process.env[key] = String(config.oidc[key]);
                }
            }
        }
        if (config.ldap && typeof config.ldap === 'object') {
            for (const key of ldapFields) {
                if (config.ldap[key] !== undefined && !process.env[key]) {
                    process.env[key] = String(config.ldap[key]);
                }
            }
        }
        console.log('  ├  Encrypted SSO config loaded successfully');
        return true;
    } catch (e) {
        console.error('  ╰  Failed to load encrypted SSO config:', e.message);
        return false;
    }
}

/**
 * Save config object to encrypted file on disk.
 */
function saveEncryptedConfig(configObj) {
    if (!ADMIN_CONFIG_PASSWORD) throw new Error('ADMIN_CONFIG_PASSWORD not set');
    const encrypted = encryptConfig(configObj, ADMIN_CONFIG_PASSWORD);
    fs.writeFileSync(SSO_CONFIG_FILE, encrypted, 'utf8');
}

/**
 * Mask secret values for safe display (show only first/last 4 chars).
 */
function maskSecret(val) {
    if (!val || typeof val !== 'string') return '';
    if (val.length <= 8) return val.slice(0, 2) + '****' + val.slice(-2);
    return val.slice(0, 4) + '****' + val.slice(-4);
}

/**
 * Build the admin-readable config summary (secrets masked).
 */
function getAdminConfigSummary() {
    return {
        oidc: {
            OIDC_ISSUER: process.env.OIDC_ISSUER || '',
            OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID ? maskSecret(process.env.OIDC_CLIENT_ID) : '',
            OIDC_CLIENT_SECRET: process.env.OIDC_CLIENT_SECRET ? maskSecret(process.env.OIDC_CLIENT_SECRET) : '',
            OIDC_CALLBACK_URL: process.env.OIDC_CALLBACK_URL || '',
        },
        ldap: {
            LDAP_URL: process.env.LDAP_URL || '',
            LDAP_BASE_DN: process.env.LDAP_BASE_DN || '',
            LDAP_BIND_DN: process.env.LDAP_BIND_DN || '',
            LDAP_BIND_PASSWORD: process.env.LDAP_BIND_PASSWORD ? maskSecret(process.env.LDAP_BIND_PASSWORD) : '',
        },
        encryptedConfigExists: fs.existsSync(SSO_CONFIG_FILE)
    };
}

// ──────────────────────────────────────────────
// Session & Authentication
// ──────────────────────────────────────────────

const SESSIONS = new Map(); // sessionToken -> { user, attributes, expires }
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Clean expired sessions periodically
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of SESSIONS) {
        if (session.expires < now) SESSIONS.delete(token);
    }
}, 60 * 60 * 1000);

function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

function parseCookies(req) {
    const cookieHeader = req.headers['cookie'];
    if (!cookieHeader) return {};
    return Object.fromEntries(
        cookieHeader.split(';').map(c => {
            const [k, ...v] = c.trim().split('=');
            return [k, v.join('=')];
        })
    );
}

// ──────────────────────────────────────────────
// LDAP Configuration (loaded from conf/config.js or env vars)
// ──────────────────────────────────────────────

function getLdapConfig() {
    return {
        // Default: try env vars first, otherwise use demo/local defaults
        url: process.env.LDAP_URL || 'ldap://localhost:389',
        baseDN: process.env.LDAP_BASE_DN || 'dc=example,dc=com',
        bindDN: process.env.LDAP_BIND_DN || '',
        bindPassword: process.env.LDAP_BIND_PASSWORD || '',
        searchFilter: process.env.LDAP_SEARCH_FILTER || '(uid={{username}})',
        // Mapping from LDAP attributes to config.js parameters
        attributeMapping: {
            domain:     process.env.LDAP_ATTR_DOMAIN     || 'sbcDomain',
            addresses:  process.env.LDAP_ATTR_ADDRESSES  || 'sbcAddresses',
            call:       process.env.LDAP_ATTR_CALL       || 'sipCall',
            caller:     process.env.LDAP_ATTR_CALLER     || 'sipCaller',
            callerDN:   process.env.LDAP_ATTR_CALLER_DN  || 'displayName'
        }
    };
}

/**
 * Authenticate a user via LDAP/AD.
 * Returns { success: true, attributes: { domain, addresses, call, caller, callerDN } }
 * OR { success: false, error: 'message' }
 */
async function authenticateViaLDAP(username, password) {
    const ldap = require('ldapjs');
    const ldapCfg = getLdapConfig();
    const client = ldap.createClient({ url: ldapCfg.url, reconnect: false, timeout: 10000 });

    return new Promise((resolve) => {
        // Try to bind with the user's credentials directly (AD simple bind)
        // First, determine the user DN
        let userDN;
        if (ldapCfg.bindDN && ldapCfg.bindPassword) {
            // Use service account to search for the user DN first
            client.bind(ldapCfg.bindDN, ldapCfg.bindPassword, (bindErr) => {
                if (bindErr) {
                    client.unbind(() => {});
                    // Fallback: try direct bind with username@domain
                    const fallbackDN = `${username}@${ldapCfg.baseDN.replace(/^dc=/i, '').replace(/,dc=/gi, '.')}`;
                    return tryDirectBind(client, fallbackDN, password, ldapCfg, resolve);
                }

                // Search for the user
                const sanitizedUsername = sanitizeLdapValue(username);
                const searchFilter = ldapCfg.searchFilter.replace('{{username}}', sanitizedUsername);
                const searchAttrs = Object.values(ldapCfg.attributeMapping).filter(a => a);
                // Always get cn, displayName, mail too
                searchAttrs.push('cn', 'displayName', 'mail', 'uid', 'sAMAccountName');

                client.search(ldapCfg.baseDN, {
                    filter: searchFilter,
                    scope: 'sub',
                    attributes: [...new Set(searchAttrs)]
                }, (searchErr, searchRes) => {
                    if (searchErr) {
                        client.unbind(() => {});
                        return resolve({ success: false, error: `LDAP search error: ${searchErr.message}` });
                    }

                    let foundUser = null;
                    searchRes.on('searchEntry', (entry) => {
                        foundUser = entry.object;
                    });

                    searchRes.on('end', (result) => {
                        if (result.status !== 0) {
                            client.unbind(() => {});
                            return resolve({ success: false, error: 'LDAP search returned no results' });
                        }
                        if (!foundUser) {
                            client.unbind(() => {});
                            return resolve({ success: false, error: 'User not found in directory' });
                        }

                        // Now bind with the user's credentials to verify password
                        const userBindDN = foundUser.dn || foundUser.distinguishedName || foundUser.userPrincipalName || userDN;
                        client.unbind(() => {
                            const newClient = ldap.createClient({ url: ldapCfg.url, reconnect: false, timeout: 10000 });
                            newClient.bind(userBindDN, password, (pwErr) => {
                                if (pwErr) {
                                    newClient.unbind(() => {});
                                    return resolve({ success: false, error: 'Invalid username or password' });
                                }
                                newClient.unbind(() => {});
                                // Map LDAP attributes to config params
                                const attrs = mapLdapAttributes(foundUser, ldapCfg);
                                resolve({ success: true, attributes: attrs });
                            });
                        });
                    });

                    searchRes.on('error', (err) => {
                        client.unbind(() => {});
                        resolve({ success: false, error: `LDAP search error: ${err.message}` });
                    });
                });
            });
        } else {
            // No service account — try direct bind with constructed DN
            userDN = `uid=${username},${ldapCfg.baseDN}`;
            tryDirectBind(client, userDN, password, ldapCfg, resolve);
        }
    });
}

function tryDirectBind(client, userDN, password, ldapCfg, resolve) {
    // Extract username from userDN
    const uname = sanitizeLdapValue(userDN.replace(/^(uid|cn|sAMAccountName)=/i, '').split(',')[0]);

    client.bind(userDN, password, (err) => {
        if (err) {
            client.unbind(() => {});
            return resolve({ success: false, error: 'Invalid username or password' });
        }
        // Try to search for user attributes
        const searchAttrs = Object.values(ldapCfg.attributeMapping).filter(a => a);
        searchAttrs.push('cn', 'displayName', 'mail', 'uid', 'sAMAccountName');

        client.search(ldapCfg.baseDN, {
            filter: `(|(uid=${uname})(sAMAccountName=${uname})(cn=${uname}))`,
            scope: 'sub',
            attributes: [...new Set(searchAttrs)]
        }, (searchErr, searchRes) => {
            if (searchErr) {
                client.unbind(() => {});
                // Return basic attributes even without search
                return resolve({
                    success: true,
                    attributes: {
                        domain: ldapCfg.baseDN,
                        addresses: '',
                        call: uname,
                        caller: uname,
                        callerDN: uname
                    }
                });
            }

            let foundUser = null;
            searchRes.on('searchEntry', (entry) => {
                foundUser = entry.object;
            });

            searchRes.on('end', () => {
                client.unbind(() => {});
                if (foundUser) {
                    const attrs = mapLdapAttributes(foundUser, ldapCfg);
                    resolve({ success: true, attributes: attrs });
                } else {
                    resolve({
                        success: true,
                        attributes: {
                            domain: ldapCfg.baseDN,
                            addresses: '',
                            call: uname,
                            caller: uname,
                            callerDN: uname
                        }
                    });
                }
            });
        });
    });
}

function mapLdapAttributes(ldapUser, ldapCfg) {
    const mapping = ldapCfg.attributeMapping;
    const getAttr = (field) => {
        if (!field) return '';
        const val = ldapUser[field];
        if (Array.isArray(val)) return val[0] || '';
        return val || '';
    };

    return {
        domain:   getAttr(mapping.domain)   || ldapCfg.baseDN,
        addresses: getAttr(mapping.addresses) || '',
        call:     getAttr(mapping.call)     || ldapUser.sAMAccountName || ldapUser.uid || ldapUser.cn || '',
        caller:   getAttr(mapping.caller)   || ldapUser.sAMAccountName || ldapUser.uid || '',
        callerDN: getAttr(mapping.callerDN) || ldapUser.displayName || ldapUser.cn || ''
    };
}

/**
 * Demo/local authentication (when no LDAP server is available).
 * For testing purposes — uses credentials from a local config file.
 */
const DEMO_USERS = new Map();

// Production mode: disable demo users when OIDC or LDAP is configured
const DEMO_USERS_DISABLED = !!(process.env.OIDC_ISSUER || process.env.LDAP_URL);

// Load demo users from conf/ad_users.json if it exists (only for local development)
if (!DEMO_USERS_DISABLED) {
    try {
        const demoPath = path.join(__dirname, 'conf', 'ad_users.json');
        if (fs.existsSync(demoPath)) {
            const demoData = JSON.parse(fs.readFileSync(demoPath, 'utf8'));
            for (const user of demoData.users || []) {
                DEMO_USERS.set(user.username, user);
            }
        }
    } catch (e) {
        // No demo users file
    }
    // Always add a default admin user if no demo users file
    if (!DEMO_USERS.has('admin')) {
        DEMO_USERS.set('admin', {
            username: 'admin',
            password: 'admin123',
            attributes: {
                domain: 'sbc.voiceteam.local',
                addresses: ['wss://sbc.voiceteam.local:443'],
                call: '1000',
                caller: 'admin',
                callerDN: 'Admin User'
            }
        });
    }
}

async function authenticateUser(username, password) {
    // First try demo/local users (only when OIDC and LDAP are NOT configured)
    if (!DEMO_USERS_DISABLED) {
        const demoUser = DEMO_USERS.get(username);
        if (demoUser && demoUser.password === password) {
            return { success: true, attributes: demoUser.attributes };
        }
    }

    // If LDAP is configured (LDAP_URL is set), try LDAP
    if (process.env.LDAP_URL) {
        try {
            const ldapResult = await authenticateViaLDAP(username, password);
            if (ldapResult.success) return ldapResult;
            // If LDAP fails, fall through to error (don't fall back to anonymous)
            return ldapResult;
        } catch (e) {
            return { success: false, error: `LDAP error: ${e.message}` };
        }
    }

    // No LDAP configured and not a demo user
    return { success: false, error: 'Invalid username or password' };
}

// ── JSON response helper ────────────────────
function jsonResponse(res, status, data, extraHeaderName, extraHeaderValue) {
    const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        ...SECURITY_HEADERS
    };
    if (extraHeaderName && extraHeaderValue) {
        headers[extraHeaderName] = extraHeaderValue;
    }
    res.writeHead(status, headers);
    res.end(JSON.stringify(data));
}

// ── Parse JSON body helper (with size limit) ──
function parseJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        let size = 0;
        const MAX_BODY_SIZE = 1024 * 10; // 10KB
        req.on('data', chunk => {
            size += chunk.length;
            if (size > MAX_BODY_SIZE) {
                req.destroy(new Error('Request body too large'));
                return reject(new Error('Request body too large'));
            }
            body += chunk;
        });
        req.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch (e) { reject(new Error('Invalid JSON')); }
        });
        req.on('error', reject);
    });
}

/**
 * Sanitize a value for LDAP filter injection prevention.
 * Escodes LDAP special characters: * ( ) \ NUL
 */
function sanitizeLdapValue(value) {
    if (typeof value !== 'string') return '';
    // Limit length to 100 chars
    return value.slice(0, 100).replace(/[\\*()\0]/g, '\\$&');
}

/**
 * Validate username/password for basic safety
 */
function validateCredentials(username, password) {
    if (!username || !password) return 'Username and password required';
    if (typeof username !== 'string' || typeof password !== 'string') return 'Invalid input type';
    if (username.length > 100 || password.length > 200) return 'Input too long';
    if (username.length < 1 || password.length < 1) return 'Input too short';
    // Only allow printable characters
    if (!/^[\x20-\x7E]+$/.test(username)) return 'Username contains invalid characters';
    return null; // valid
}

// ── Handle POST /api/login ──────────────────
async function handleLogin(req, res) {
    try {
        const { username, password } = await parseJsonBody(req);
        
        // Validate credentials
        const validationError = validateCredentials(username, password);
        if (validationError) {
            return jsonResponse(res, 400, { success: false, error: validationError });
        }

        const result = await authenticateUser(username, password);
        if (!result.success) {
            return jsonResponse(res, 401, { success: false, error: result.error || 'Authentication failed' });
        }

        // Create session
        const token = generateSessionToken();
        SESSIONS.set(token, {
            user: username,
            attributes: result.attributes,
            expires: Date.now() + SESSION_TTL
        });

        // Set cookie and return
        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Set-Cookie': `c2c_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}`,
            ...SECURITY_HEADERS
        });
        res.end(JSON.stringify({
            success: true,
            user: username,
            attributes: result.attributes
        }));
    } catch (e) {
        jsonResponse(res, 400, { success: false, error: e.message });
    }
}

// ── Handle POST /api/logout ─────────────────
function handleLogout(req, res) {
    const cookies = parseCookies(req);
    const token = cookies['c2c_session'];
    if (token) SESSIONS.delete(token);

    res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': 'c2c_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
        ...SECURITY_HEADERS
    });
    res.end(JSON.stringify({ success: true }));
}

// ── Handle GET /api/session ─────────────────
function handleSessionCheck(req, res) {
    const cookies = parseCookies(req);
    const token = cookies['c2c_session'];
    if (!token || !SESSIONS.has(token)) {
        return jsonResponse(res, 200, { authenticated: false });
    }

    const session = SESSIONS.get(token);
    if (session.expires < Date.now()) {
        SESSIONS.delete(token);
        return jsonResponse(res, 200, { authenticated: false });
    }

    jsonResponse(res, 200, {
        authenticated: true,
        user: session.user,
        attributes: session.attributes
    });
}

// ── Handle GET /api/config ──────────────────
function handleGetConfig(req, res) {
    const cookies = parseCookies(req);
    const token = cookies['c2c_session'];
    if (!token || !SESSIONS.has(token)) {
        return jsonResponse(res, 401, { authenticated: false, error: 'Not authenticated' });
    }

    const session = SESSIONS.get(token);
    if (session.expires < Date.now()) {
        SESSIONS.delete(token);
        return jsonResponse(res, 401, { authenticated: false, error: 'Session expired' });
    }

    jsonResponse(res, 200, {
        authenticated: true,
        user: session.user,
        attributes: session.attributes
    });
}

// ──────────────────────────────────────────────
// Generic OIDC Provider (Okta / Auth0 / Azure AD)
// ──────────────────────────────────────────────
// To use Okta Developer Edition, set these environment variables:
//   OIDC_ISSUER=https://your-org.okta.com
//   OIDC_CLIENT_ID=your-client-id
//   OIDC_CLIENT_SECRET=your-client-secret
//   OIDC_CALLBACK_URL=http://localhost:3000/api/auth/callback
//   OIDC_AUTHZ_ENDPOINT=/oauth2/v1/authorize   (default for Okta)
//   OIDC_TOKEN_ENDPOINT=/oauth2/v1/token        (default for Okta)
//   OIDC_USERINFO_ENDPOINT=/oauth2/v1/userinfo  (default for Okta)
//   OIDC_JWKS_ENDPOINT=/oauth2/v1/keys          (default for Okta)
//   OIDC_SCOPE=openid profile email              (default)
//
// In Okta Admin Console, configure user profile attributes:
//   sbcDomain, sbcAddresses, sipCall, sipCaller, displayName
// ──────────────────────────────────────────────

const OIDC_ISSUER = process.env.OIDC_ISSUER || '';
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID || '';
const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET || '';
const OIDC_CALLBACK_URL = process.env.OIDC_CALLBACK_URL || 'http://localhost:3000/api/auth/callback';
const OIDC_ENABLED = !!(OIDC_ISSUER && OIDC_CLIENT_ID && OIDC_CLIENT_SECRET);

// Okta default endpoints (can be overridden for other providers)
const OIDC_AUTHZ_ENDPOINT = process.env.OIDC_AUTHZ_ENDPOINT || '/oauth2/v1/authorize';
const OIDC_TOKEN_ENDPOINT = process.env.OIDC_TOKEN_ENDPOINT || '/oauth2/v1/token';
const OIDC_USERINFO_ENDPOINT = process.env.OIDC_USERINFO_ENDPOINT || '/oauth2/v1/userinfo';
const OIDC_JWKS_ENDPOINT = process.env.OIDC_JWKS_ENDPOINT || '/oauth2/v1/keys';
// OIDC scope: openid + profile + email + okta.users.read.self (for custom attributes via /api/v1/users/me)
const OIDC_SCOPE = process.env.OIDC_SCOPE || 'openid profile email okta.users.read.self';

// JWKS client to verify OIDC RS256 JWT tokens
let oidcJwksClient = null;
if (OIDC_ENABLED) {
    oidcJwksClient = jwksClient({
        jwksUri: `${OIDC_ISSUER}${OIDC_JWKS_ENDPOINT}`
    });
}

// Map OIDC user attributes to config.js parameters
// These are the custom Okta profile attribute names
const OIDC_ATTR_MAPPING = {
    domain:     process.env.OIDC_ATTR_DOMAIN     || 'sbcDomain',
    addresses:  process.env.OIDC_ATTR_ADDRESSES  || 'sbcAddresses',
    call:       process.env.OIDC_ATTR_CALL       || 'sipCall',
    caller:     process.env.OIDC_ATTR_CALLER     || 'sipCaller',
    callerDN:   process.env.OIDC_ATTR_CALLER_DN  || 'displayName'
};

/**
 * Get a signing key from OIDC JWKS endpoint
 */
function getOidcSigningKey(kid) {
    return new Promise((resolve, reject) => {
        if (!oidcJwksClient) return reject(new Error('OIDC not configured'));
        oidcJwksClient.getSigningKey(kid, (err, key) => {
            if (err) return reject(err);
            resolve(key.getPublicKey());
        });
    });
}

/**
 * Verify an OIDC ID token (RS256 JWT)
 */
async function verifyOidcToken(token) {
    if (!OIDC_ENABLED) throw new Error('OIDC not configured');

    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || !decoded.header || !decoded.header.kid) {
        throw new Error('Invalid token: missing kid');
    }

    const signingKey = await getOidcSigningKey(decoded.header.kid);

    return new Promise((resolve, reject) => {
        jwt.verify(token, signingKey, {
            algorithms: ['RS256'],
            audience: OIDC_CLIENT_ID,
            issuer: `${OIDC_ISSUER}/`
        }, (err, payload) => {
            if (err) return reject(err);
            resolve(payload);
        });
    });
}

/**
 * Helper: make HTTPS POST request (for OIDC token exchange)
 */
function httpsPost(hostname, path, data) {
    return new Promise((resolve, reject) => {
        const body = querystring.stringify(data);
        const options = {
            hostname,
            path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body)
            }
        };
        const req = https.request(options, (res) => {
            let response = '';
            res.on('data', chunk => response += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(response)); }
                catch (e) { reject(new Error('Invalid response from OIDC provider')); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

/**
 * Extract config attributes from OIDC user info / ID token claims.
 * Reads custom Okta profile attributes from multiple possible locations
 * because Okta can return them at the top level, in profile, or in namespaced claims.
 */
function extractOidcAttributes(userInfo) {
    if (!userInfo) return { domain: '', addresses: [], call: '', caller: '', callerDN: '' };

    // Collect values from all possible locations
    const searchPaths = [
        // Direct top-level keys
        userInfo,
        // Nested under "profile" key (Okta sometimes nests custom attrs here)
        userInfo.profile || {},
        // Under "claims" namespace
        userInfo['https://voiceteam/claims'] || {},
        // Under "voiceteam" namespace
        userInfo['https://voiceteam/'] || {}
    ];

    // Also search any nested custom attribute namespace
    for (const key of Object.keys(userInfo)) {
        if (key.includes('voiceteam') || key.includes('sbc') || key.includes('sip')) {
            const val = userInfo[key];
            if (typeof val === 'object' && val !== null) {
                searchPaths.push(val);
            }
        }
    }

    /**
     * Search for a key across all possible paths
     */
    function findValue(...keys) {
        for (const path of searchPaths) {
            for (const key of keys) {
                if (path[key] !== undefined && path[key] !== null && path[key] !== '') {
                    return path[key];
                }
                // also check nested objects
                for (const nestedKey of Object.keys(path)) {
                    const nested = path[nestedKey];
                    if (typeof nested === 'object' && nested !== null && nested[key] !== undefined && nested[key] !== '') {
                        return nested[key];
                    }
                }
            }
        }
        return undefined;
    }

    // Try multiple Okta attribute name conventions
    const rawAttrs = {
        domain:     findValue('sbcDomain', 'SbcDomain', 'sbc_domain', 'domain'),
        addresses:  findValue('sbcAddresses', 'SbcAddresses', 'sbc_addresses', 'addresses', 'sbcaddresses'),
        call:       findValue('sipCall', 'SipCall', 'sip_call', 'call'),
        caller:     findValue('sipCaller', 'SipCaller', 'sip_caller', 'caller'),
        callerDN:   findValue('displayName', 'DisplayName', 'display_name', 'callerDN', 'CallerDN') 
                    || userInfo.name || userInfo.nickname || ''
    };

    // Try to parse addresses (could be string like "wss://sbc.example.com:443" or array)
    let addresses;
    if (Array.isArray(rawAttrs.addresses) && rawAttrs.addresses.length > 0) {
        addresses = rawAttrs.addresses;
    } else if (typeof rawAttrs.addresses === 'string' && rawAttrs.addresses.trim()) {
        addresses = rawAttrs.addresses.split(',').map(s => {
            s = s.trim();
            if (!s.startsWith('ws://') && !s.startsWith('wss://')) s = 'wss://' + s;
            return s;
        });
    } else {
        addresses = undefined; // undefined = not set, don't overwrite config
    }

    return {
        domain:   rawAttrs.domain || undefined,
        addresses: addresses,
        call:     rawAttrs.call || undefined,
        caller:   rawAttrs.caller || undefined,
        callerDN: rawAttrs.callerDN || userInfo.name || undefined
    };
}

/**
 * ── Admin: Verify admin session token from Bearer header or cookie ──
 */
function verifyAdminAuth(req) {
    if (!ADMIN_CONFIG_PASSWORD) return false;
    // Check Authorization header (Bearer token = session token from admin login)
    const authHeader = req.headers['authorization'] || '';
    let token = '';
    if (authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7);
    }
    // Also check cookie
    const cookies = parseCookies(req);
    if (!token) token = cookies['c2c_admin'] || '';
    if (!token) return false;

    // Look up admin session in SESSIONS store
    const session = SESSIONS.get(`admin_${token}`);
    return !!(session && session.expires > Date.now());
}

/**
 * Handle POST /api/admin/login — verify admin password, return admin token
 */
function handleAdminLogin(req, res) {
    if (!ADMIN_CONFIG_PASSWORD) {
        return jsonResponse(res, 400, { success: false, error: 'ADMIN_CONFIG_PASSWORD not set on server' });
    }
    parseJsonBody(req).then(({ password }) => {
        if (!password || password !== ADMIN_CONFIG_PASSWORD) {
            return jsonResponse(res, 401, { success: false, error: 'Invalid admin password' });
        }
        // Generate a short-lived admin session token
        const token = crypto.randomBytes(32).toString('hex');
        SESSIONS.set(`admin_${token}`, {
            user: 'admin',
            attributes: {},
            expires: Date.now() + 3600000 // 1 hour
        });
        jsonResponse(res, 200, {
            success: true,
            token: token,
            config: getAdminConfigSummary()
        }, 'Set-Cookie', `c2c_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);
    }).catch(e => {
        jsonResponse(res, 400, { success: false, error: e.message });
    });
}

/**
 * Handle GET /api/admin/config — return current config summary (masked secrets)
 */
function handleAdminGetConfig(req, res) {
    if (!verifyAdminAuth(req)) {
        return jsonResponse(res, 401, { success: false, error: 'Not authorized' });
    }
    jsonResponse(res, 200, { success: true, config: getAdminConfigSummary() });
}

/**
 * Handle POST /api/admin/config — save encrypted SSO config
 */
function handleAdminSaveConfig(req, res) {
    if (!verifyAdminAuth(req)) {
        return jsonResponse(res, 401, { success: false, error: 'Not authorized' });
    }

    parseJsonBody(req).then(({ oidc, ldap }) => {
        if (!oidc && !ldap) {
            return jsonResponse(res, 400, { success: false, error: 'Provide oidc and/or ldap config' });
        }

        // Validate OIDC fields
        if (oidc) {
            if (oidc.OIDC_ISSUER && !/^https:\/\//.test(oidc.OIDC_ISSUER)) {
                return jsonResponse(res, 400, { success: false, error: 'OIDC_ISSUER must start with https://' });
            }
        }

        // Build config object
        const configObj = {};
        if (oidc) configObj.oidc = oidc;
        if (ldap) configObj.ldap = ldap;

        saveEncryptedConfig(configObj);
        // Return the encrypted payload so user can copy it for Render env var
        const encryptedPayload = encryptConfig(configObj, ADMIN_CONFIG_PASSWORD);
        jsonResponse(res, 200, {
            success: true,
            config: getAdminConfigSummary(),
            encryptedConfigPayload: encryptedPayload,
            message: 'Config saved. For Render: copy the payload and set SSO_ENCRYPTED_CONFIG in Environment Variables.'
        });
    }).catch(e => {
        jsonResponse(res, 400, { success: false, error: e.message });
    });
}

/**
 * Handle DELETE /api/admin/config — delete encrypted config file
 */
function handleAdminDeleteConfig(req, res) {
    if (!verifyAdminAuth(req)) {
        return jsonResponse(res, 401, { success: false, error: 'Not authorized' });
    }

    try {
        if (fs.existsSync(SSO_CONFIG_FILE)) {
            fs.unlinkSync(SSO_CONFIG_FILE);
        }
        jsonResponse(res, 200, { success: true, message: 'Encrypted config deleted' });
    } catch (e) {
        jsonResponse(res, 500, { success: false, error: e.message });
    }
}

/**
 * Handle GET /api/auth/login — redirect to OIDC provider (Okta) login
 */
function handleOidcLogin(req, res) {
    if (!OIDC_ENABLED) {
        // Return a simple HTML page with error + link back to login
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
'<!DOCTYPE html><html><head><title>SSO Not Configured</title>' +
'<style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#111;color:#fff;margin:0}' +
'.card{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:40px;max-width:400px;text-align:center}' +
'h2{color:#FF9F0A;margin-top:0}code{background:rgba(255,255,255,0.06);padding:2px 8px;border-radius:4px;font-size:13px}' +
'a{color:#409CFF;text-decoration:none}a:hover{text-decoration:underline}' +
'</style></head><body>' +
'<div class="card">' +
'<h2>⚠️ SSO Not Configured</h2>' +
'<p style="color:#aaa;font-size:14px;line-height:1.6">' +
'To use Okta SSO, set these environment variables:<br><br>' +
'<code>OIDC_ISSUER</code><br>' +
'<code>OIDC_CLIENT_ID</code><br>' +
'<code>OIDC_CLIENT_SECRET</code><br><br>' +
'Or ask your administrator to enable SSO.</p>' +
'<a href="/html/login.html" style="display:inline-block;margin-top:16px;padding:10px 24px;background:#007AFF;color:#fff;border-radius:10px;font-weight:600">Back to Login</a>' +
'</div></body></html>');
        return;
    }

    // Generate state parameter for CSRF protection
    const state = crypto.randomBytes(16).toString('hex');
    SESSIONS.set(`oidc_state_${state}`, { expires: Date.now() + 600000 }); // 10 min

    const authUrl = `${OIDC_ISSUER}${OIDC_AUTHZ_ENDPOINT}?` + querystring.stringify({
        response_type: 'code',
        client_id: OIDC_CLIENT_ID,
        redirect_uri: OIDC_CALLBACK_URL,
        scope: OIDC_SCOPE,
        state: state
    });

    res.writeHead(302, { Location: authUrl });
    res.end();
}

/**
 * Handle GET /api/auth/callback — OIDC provider redirects here after login
 */
async function handleOidcCallback(req, res) {
    if (!OIDC_ENABLED) {
        res.writeHead(400, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
        res.end('OIDC not configured');
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
        res.writeHead(302, { Location: '/html/login.html?error=' + encodeURIComponent(error) });
        res.end();
        return;
    }

    if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
        res.end('Missing authorization code');
        return;
    }

    // Verify state (CSRF protection)
    const stateKey = `oidc_state_${state}`;
    const storedState = SESSIONS.get(stateKey);
    SESSIONS.delete(stateKey);
    if (!storedState) {
        res.writeHead(400, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
        res.end('Invalid state parameter — possible CSRF attack');
        return;
    }

    try {
        // Exchange authorization code for tokens
        const tokenResponse = await httpsPost(
            OIDC_ISSUER.replace(/^https?:\/\//, ''),
            OIDC_TOKEN_ENDPOINT,
            {
                grant_type: 'authorization_code',
                client_id: OIDC_CLIENT_ID,
                client_secret: OIDC_CLIENT_SECRET,
                code: code,
                redirect_uri: OIDC_CALLBACK_URL
            }
        );

        if (tokenResponse.error) {
            res.writeHead(302, { Location: '/html/login.html?error=' + encodeURIComponent(tokenResponse.error_description || tokenResponse.error) });
            res.end();
            return;
        }

        // Decode ID token to get user info
        let userInfo = {};
        if (tokenResponse.id_token) {
            try {
                userInfo = jwt.decode(tokenResponse.id_token);
            } catch (e) {
                try {
                    userInfo = await verifyOidcToken(tokenResponse.id_token);
                } catch (verifyErr) {
                    userInfo = jwt.decode(tokenResponse.id_token);
                }
            }
        }

        // Get userinfo from /userinfo endpoint for custom Okta attributes
        let userInfoExtended = { ...(userInfo || {}) };
        try {
            const userInfoResp = await httpsGet(
                OIDC_ISSUER.replace(/^https?:\/\//, ''),
                OIDC_USERINFO_ENDPOINT,
                tokenResponse.access_token
            );
            Object.assign(userInfoExtended, userInfoResp);
        } catch (e) {
            // /userinfo endpoint is optional
        }

        // Also fetch from Okta Users API (GET /api/v1/users/me) for custom profile attributes
        // because /userinfo only returns standard OIDC claims
        try {
            const oktaProfile = await httpsGet(
                OIDC_ISSUER.replace(/^https?:\/\//, ''),
                '/api/v1/users/me',
                tokenResponse.access_token
            );
            // Merge the Okta profile into userInfoExtended
            // Custom attributes are in oktaProfile.profile
            if (oktaProfile.profile) {
                Object.assign(userInfoExtended, oktaProfile.profile);
            }
        } catch (e) {
            // Okta API call is optional — may fail if scope not granted
        }

        // Extract our custom attributes
        const attributes = extractOidcAttributes(userInfoExtended);
        const username = userInfoExtended.preferred_username || userInfoExtended.nickname || userInfoExtended.sub || 'oidc_user';

        // Create session
        const token = generateSessionToken();
        SESSIONS.set(token, {
            user: username,
            attributes: attributes,
            expires: Date.now() + SESSION_TTL
        });

        // Set cookie and redirect to main page
        res.writeHead(302, {
            Location: '/',
            'Set-Cookie': `c2c_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}`
        });
        res.end();

    } catch (e) {
        res.writeHead(302, { Location: '/html/login.html?error=' + encodeURIComponent('OIDC error: ' + e.message) });
        res.end();
    }
}

/**
 * Helper: HTTPS GET (for OIDC /userinfo endpoint)
 */
function httpsGet(hostname, path, accessToken) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname,
            path,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        };
        const req = https.request(options, (res) => {
            let response = '';
            res.on('data', chunk => response += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(response)); }
                catch (e) { reject(new Error('Invalid response from OIDC provider')); }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

/**
 * Handle GET /api/auth/diagnose — Debug current session attributes
 */
function handleDiagnoseSession(req, res) {
    const cookies = parseCookies(req);
    const token = cookies['c2c_session'];
    if (!token || !SESSIONS.has(token)) {
        return jsonResponse(res, 401, { authenticated: false, error: 'Not authenticated' });
    }
    const session = SESSIONS.get(token);
    if (session.expires < Date.now()) {
        SESSIONS.delete(token);
        return jsonResponse(res, 401, { authenticated: false, error: 'Session expired' });
    }
    jsonResponse(res, 200, {
        authenticated: true,
        user: session.user,
        attributes: session.attributes,
        sessionAge: Math.round((Date.now() - (session.expires - 24*60*60*1000)) / 1000) + 's'
    });
}

const server = http.createServer((req, res) => {
    const clientIp = req.socket.remoteAddress;

    // Rate limiting
    if (isRateLimited(clientIp)) {
        res.writeHead(429, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
        res.end('429 Too Many Requests');
        return;
    }

    // ── API Routes ──────────────────────────────────────
    if (req.url === '/api/login' && req.method === 'POST') {
        return handleLogin(req, res);
    }
    if (req.url === '/api/logout' && req.method === 'POST') {
        return handleLogout(req, res);
    }
    if (req.url === '/api/session' && req.method === 'GET') {
        return handleSessionCheck(req, res);
    }
    if (req.url === '/api/config' && req.method === 'GET') {
        return handleGetConfig(req, res);
    }

    // ── Admin API Routes (encrypted config management) ──
    if (req.url === '/api/admin/login' && req.method === 'POST') {
        return handleAdminLogin(req, res);
    }
    if (req.url === '/api/admin/config' && req.method === 'GET') {
        return handleAdminGetConfig(req, res);
    }
    if (req.url === '/api/admin/config' && req.method === 'POST') {
        return handleAdminSaveConfig(req, res);
    }
    if (req.url === '/api/admin/config' && req.method === 'DELETE') {
        return handleAdminDeleteConfig(req, res);
    }

    // ── OIDC (Okta/Auth0) OAuth Routes ────────────────
    if (req.url === '/api/auth/status' && req.method === 'GET') {
        return jsonResponse(res, 200, { oidcEnabled: OIDC_ENABLED });
    }
    if (req.url === '/api/auth/diagnose' && req.method === 'GET') {
        return handleDiagnoseSession(req, res);
    }
    if (req.url.startsWith('/api/auth/login') && req.method === 'GET') {
        return handleOidcLogin(req, res);
    }
    if (req.url.startsWith('/api/auth/callback') && req.method === 'GET') {
        return handleOidcCallback(req, res);
    }

    // Only allow GET and HEAD for static files
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
        res.end('405 Method Not Allowed');
        return;
    }

    // Normalize and resolve path securely
    let reqPath = req.url === '/' ? '/html/index.html' : req.url;
    
    // Remove query strings (not needed for static file serving)
    reqPath = reqPath.split('?')[0].split('#')[0];

    // Auth check: always redirect to login when not authenticated
    const isMainWidget = reqPath === '/html/index.html';
    const isAdminPage = reqPath === '/html/admin.html';
    if (isMainWidget && !isAdminPage) {
        const cookies = parseCookies(req);
        const token = cookies['c2c_session'];
        const isAuthenticated = token && SESSIONS.has(token) && SESSIONS.get(token).expires > Date.now();
        if (!isAuthenticated) {
            res.writeHead(302, { Location: '/html/login.html' });
            res.end();
            return;
        }
    }

    // Prevent directory traversal: resolve and verify path is within project
    const normalizedPath = path.posix ? path.posix.normalize(reqPath) : path.normalize(reqPath);
    const resolvedPath = path.resolve(__dirname, '.' + normalizedPath);
    
    if (!resolvedPath.startsWith(path.resolve(__dirname))) {
        res.writeHead(403, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
        res.end('403 Forbidden');
        return;
    }

    // Block access to hidden files and directories
    const relativePath = path.relative(__dirname, resolvedPath);
    if (relativePath.split(path.sep).some(part => part.startsWith('.'))) {
        res.writeHead(403, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
        res.end('403 Forbidden');
        return;
    }

    // Validate file extension
    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = MIME_TYPES.get(ext);
    if (!contentType) {
        res.writeHead(403, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
        res.end('403 Forbidden');
        return;
    }

    fs.readFile(resolvedPath, (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
                res.end('404 Not Found');
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
                res.end('500 Internal Server Error');
            }
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType, ...SECURITY_HEADERS });
        res.end(data);
    });
});

server.listen(PORT, BIND_ADDR, () => {
    const isRender = !!process.env.RENDER;
    const displayAddr = isRender ? '0.0.0.0' : BIND_ADDR;

    console.log('╔══════════════════════════════════════════╗');
    console.log('║     Voice Team - Server                ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  Server:  http://${displayAddr}:${PORT}        ║`);
    console.log('║                                          ║');
    if (isRender) {
        console.log('║  ✅ Running on Render (0.0.0.0)          ║');
    } else {
        console.log('║  ⚠  Local dev only — not for internet   ║');
    }
    if (ADMIN_CONFIG_PASSWORD) {
        console.log('║  🔐 Admin config: enabled                ║');
    } else {
        console.log('║  ⚠  Admin config: disabled (set ADMIN_CONFIG_PASSWORD) ║');
    }
    console.log('╚══════════════════════════════════════════╝');
});