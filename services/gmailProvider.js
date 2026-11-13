const fs = require('node:fs');
const nodemailer = require('nodemailer');

function credentials() {
  if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET) {
    return { client_id: process.env.GMAIL_CLIENT_ID, client_secret: process.env.GMAIL_CLIENT_SECRET };
  }
  const json = JSON.parse(fs.readFileSync(process.env.GMAIL_CLIENT_FILE, 'utf8'));
  return json.web || json.installed;
}

function authorization() {
  return process.env.GMAIL_REFRESH_TOKEN
    ? { refresh_token: process.env.GMAIL_REFRESH_TOKEN, sender: process.env.GMAIL_TOKEN_SENDER }
    : JSON.parse(fs.readFileSync(process.env.GMAIL_TOKEN_FILE, 'utf8'));
}

function configured() {
  try {
    const client = credentials();
    const token = authorization();
    return Boolean(client.client_id && client.client_secret && token.refresh_token && token.sender === process.env.GMAIL_FROM_EMAIL);
  } catch { return false; }
}

async function send(message) {
  const client = credentials();
  const token = authorization();
  if (!configured()) throw new Error('Gmail authorization is missing or does not match the configured sender. Run npm run email:authorize.');
  const refreshed = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ client_id: client.client_id, client_secret: client.client_secret, refresh_token: token.refresh_token, grant_type: 'refresh_token' })
  });
  const auth = await refreshed.json();
  if (!refreshed.ok || !auth.access_token) throw new Error('Gmail authorization expired or was revoked. Run npm run email:authorize.');
  const mime = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail(message);
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: mime.message.toString('base64url') })
  });
  const result = await response.json();
  if (!response.ok || !result.id) throw new Error(`Gmail delivery failed (HTTP ${response.status}). Check Gmail API access and sender authorization.`);
  return result.id;
}

module.exports = { credentials, configured, send };
