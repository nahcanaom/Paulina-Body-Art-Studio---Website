const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gmail = require('../services/gmailProvider');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paulina-gmail-test-'));
  const originalFetch = global.fetch;
  try {
    process.env.GMAIL_CLIENT_FILE = path.join(dir, 'client.json');
    process.env.GMAIL_TOKEN_FILE = path.join(dir, 'token.json');
    process.env.GMAIL_FROM_EMAIL = 'sender@example.com';
    fs.writeFileSync(process.env.GMAIL_CLIENT_FILE, JSON.stringify({ web: { client_id: 'test', client_secret: 'fake' } }));
    assert.equal(gmail.configured(), false);
    fs.writeFileSync(process.env.GMAIL_TOKEN_FILE, JSON.stringify({ refresh_token: 'fake', sender: 'wrong@example.com' }));
    assert.equal(gmail.configured(), false);
    fs.writeFileSync(process.env.GMAIL_TOKEN_FILE, JSON.stringify({ refresh_token: 'fake', sender: 'sender@example.com' }));
    assert.equal(gmail.configured(), true);
    process.env.GMAIL_CLIENT_ID = 'test';
    process.env.GMAIL_CLIENT_SECRET = 'fake';
    process.env.GMAIL_REFRESH_TOKEN = 'fake';
    process.env.GMAIL_TOKEN_SENDER = 'sender@example.com';
    fs.unlinkSync(process.env.GMAIL_CLIENT_FILE);
    fs.unlinkSync(process.env.GMAIL_TOKEN_FILE);
    assert.equal(gmail.configured(), true);
    let sends = 0;
    global.fetch = async (url, options) => {
      if (url.endsWith('/token')) return { ok: true, json: async () => ({ access_token: 'fake' }) };
      sends++;
      const raw = Buffer.from(JSON.parse(options.body).raw, 'base64url').toString();
      assert.match(raw, /To: recipient@example.com/);
      assert.match(raw, /Subject: Booking test/);
      return { ok: true, json: async () => ({ id: 'mock-message' }) };
    };
    assert.equal(await gmail.send({ from: 'sender@example.com', to: 'recipient@example.com', subject: 'Booking test', text: 'Test only' }), 'mock-message');
    assert.equal(sends, 1);
    global.fetch = async () => ({ ok: false, json: async () => ({ error: 'invalid_grant' }) });
    await assert.rejects(gmail.send({}), /expired or was revoked/);
    console.log('Gmail checks passed: sender binding, MIME, token refresh and revoked authorization; no real email sent.');
  } finally {
    global.fetch = originalFetch;
    for (const file of ['client.json', 'token.json']) fs.rmSync(path.join(dir, file), { force: true });
    fs.rmdirSync(dir);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
