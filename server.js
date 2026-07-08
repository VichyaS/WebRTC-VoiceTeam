/**
 * Voice Team - Click to Call Server
 *
 * ⚠ DEVELOPMENT SERVER — For production, use nginx/Apache with HTTPS.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const BIND_ADDR = process.env.BIND_ADDR || '127.0.0.1'; // Set BIND_ADDR=0.0.0.0 for Render/cloud

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

const server = http.createServer((req, res) => {
    const clientIp = req.socket.remoteAddress;

    // Rate limiting
    if (isRateLimited(clientIp)) {
        res.writeHead(429, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
        res.end('429 Too Many Requests');
        return;
    }

    // Only allow GET and HEAD
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
        res.end('405 Method Not Allowed');
        return;
    }

    // Normalize and resolve path securely
    let reqPath = req.url === '/' ? '/html/index.html' : req.url;
    
    // Remove query strings (not needed for static file serving)
    reqPath = reqPath.split('?')[0].split('#')[0];

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
    const displayAddr = BIND_ADDR === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1';
    console.log('╔══════════════════════════════════════════╗');
    console.log('║     Voice Team - Dev Server            ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  Local:   http://${displayAddr}:${PORT}        ║`);
    console.log('║                                          ║');
    console.log('║  ⚠  DEVELOPMENT SERVER ONLY              ║');
    console.log('║  ⚠  Do not expose to the internet        ║');
    console.log('║  ⚠  Use nginx/apache for production      ║');
    console.log('╚══════════════════════════════════════════╝');
});