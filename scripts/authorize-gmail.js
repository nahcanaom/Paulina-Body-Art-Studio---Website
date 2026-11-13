require('dotenv').config({ quiet: true });
const http = require('node:http');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { credentials } = require('../services/gmailProvider');
const client = credentials();
const state = crypto.randomBytes(32).toString('hex');
const redirect = 'http://localhost:3002/oauth2callback';
const sender = process.env.GMAIL_FROM_EMAIL;
let exchanging = false;

const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const url = new URL(req.url, 'http://localhost:3002');
  if (url.pathname === '/') {
    const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    auth.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirect,
      response_type: 'code', scope: 'openid email https://www.googleapis.com/auth/gmail.send',
      access_type: 'offline', prompt: 'consent', state, login_hint: sender }).toString();
    res.writeHead(302, { Location: auth.href }); return res.end();
  }
  if (url.pathname !== '/oauth2callback') { res.writeHead(404); return res.end(); }
  if (url.searchParams.get('state') !== state || !url.searchParams.get('code') || exchanging) {
    res.writeHead(400); return res.end('Authorization was cancelled or invalid. Open localhost:3002 to retry.');
  }
  exchanging = true;
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', signal: AbortSignal.timeout(15000), body: new URLSearchParams({
        client_id: client.client_id, client_secret: client.client_secret,
        code: url.searchParams.get('code'), redirect_uri: redirect, grant_type: 'authorization_code'
      })
    });
    const token = await response.json();
    if (!response.ok || !token.refresh_token) throw new Error('Google did not grant offline access. Retry consent.');
    const identityResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token.access_token}` }
    });
    const identity = await identityResponse.json();
    if (!identityResponse.ok || !identity.email_verified || identity.email?.toLowerCase() !== sender?.toLowerCase()) throw new Error('Authorize the configured sender account only.');
    if (!token.scope?.split(' ').includes('https://www.googleapis.com/auth/gmail.send')) throw new Error('Gmail sending permission is required. Retry consent.');
    fs.writeFileSync(process.env.GMAIL_TOKEN_FILE, JSON.stringify({ refresh_token: token.refresh_token, sender }), { mode: 0o600 });
    res.end('Gmail authorized. You can close this tab. No email was sent.');
    console.log('Gmail sender authorized; private refresh token saved. No email sent.');
    server.close();
  } catch (error) { exchanging = false; res.writeHead(400); res.end(error.message); }
});
server.listen(3002, 'localhost', () => console.log('Open http://localhost:3002 to authorize the Gmail sender.'));
