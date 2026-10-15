import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createApp, token } from '../src/app.js';
import { Track } from '../src/models/Track.js';

function makeWave() {
  const samples = 8000;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  return wav;
}

test('upload WAV : extraction de durée et conservation du contrat', async () => {
  const server = createApp().listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  let created;
  const modelStub = mock.method(Track, 'create', async fields => {
    created = fields;
    return { toPublic: () => ({ id: 'mock-track', title: fields.title, duration: fields.duration, hasCover: false }) };
  });
  try {
    const body = new FormData();
    body.append('audio', new Blob([makeWave()], { type: 'audio/wav' }), 'sample.wav');
    body.append('title', '');
    const jwtToken = token({ id: '507f1f77bcf86cd799439011', email: 'test@example.com' });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/tracks`, {
      method: 'POST', headers: { Authorization: `Bearer ${jwtToken}` }, body,
    });
    assert.equal(response.status, 201);
    assert.equal(created.duration, 1);
    assert.equal(created.originalName, 'sample.wav');
    assert.equal((await response.json()).duration, 1);
  } finally {
    modelStub.mock.restore();
    if (created?.storedName) await fs.unlink(path.resolve('data/uploads', created.storedName));
    await new Promise(resolve => server.close(resolve));
  }
});

test('Magic Link : un seul usage et expiration contrôlée', async () => {
  const { User } = await import('../src/models/User.js');
  const { MagicLink } = await import('../src/auth/MagicLink.js');
  const nodemailer = (await import('nodemailer')).default;
  const previous = Object.fromEntries(['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'].map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    SMTP_HOST: 'smtp.test', SMTP_PORT: '587', SMTP_USER: 'test',
    SMTP_PASSWORD: 'test', SMTP_FROM: 'test@example.com',
  });
  let sentText = '';
  let stored;
  const stubs = [
    mock.method(nodemailer, 'createTransport', () => ({ sendMail: async mail => { sentText = mail.text; } })),
    mock.method(User, 'exists', async () => true),
    mock.method(User, 'findOne', async () => ({ id: 'user-1', email: 'test@example.com', toPublic: () => ({ id: 'user-1', email: 'test@example.com' }) })),
    mock.method(MagicLink, 'exists', async () => false),
    mock.method(MagicLink, 'deleteMany', async () => ({})),
    mock.method(MagicLink, 'create', async value => { stored = value; return { id: 'link-1' }; }),
    mock.method(MagicLink, 'findOneAndDelete', async filter => {
      if (!stored || filter.tokenHash !== stored.tokenHash || stored.expiresAt <= new Date()) return null;
      const result = stored;
      stored = null;
      return result;
    }),
  ];
  const server = createApp().listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const request = await fetch(base + '/api/auth/magic/request', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com' }),
    });
    assert.equal(request.status, 200);
    assert.ok(stored.expiresAt.getTime() - Date.now() <= 600000);
    const raw = new URL(sentText.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
    assert.ok(raw);
    assert.ok(!JSON.stringify(stored).includes(raw));
    const verify = () => fetch(base + '/api/auth/magic/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: raw }),
    });
    const first = await verify();
    assert.equal(first.status, 200);
    assert.ok((await first.json()).token);
    const second = await verify();
    assert.equal(second.status, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
    stubs.forEach(stub => stub.mock.restore());
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('Google : identité vérifiée par audience avant création du compte', async () => {
  const { User } = await import('../src/models/User.js');
  const { OAuth2Client } = await import('google-auth-library');
  const previous = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = 'local-client-id';
  let created;
  const stubs = [
    mock.method(OAuth2Client.prototype, 'verifyIdToken', async options => {
      assert.equal(options.audience, 'local-client-id');
      return { getPayload: () => ({ sub: 'google-user-1', email: 'person@example.com', email_verified: true, name: 'Person' }) };
    }),
    mock.method(User, 'findOne', async () => null),
    mock.method(User, 'create', async value => {
      created = value;
      return { id: 'google-local-id', email: value.email, toPublic: () => ({ id: 'google-local-id', email: value.email }) };
    }),
  ];
  const server = createApp().listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/google`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credential: 'simulated-google-id-token' }),
    });
    assert.equal(response.status, 200);
    assert.equal(created.googleSub, 'google-user-1');
    assert.equal(created.email, 'person@example.com');
    assert.ok((await response.json()).token);
  } finally {
    await new Promise(resolve => server.close(resolve));
    stubs.forEach(stub => stub.mock.restore());
    if (previous === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = previous;
  }
});

test('Google : un email existant n’est pas associé sans connexion préalable', async () => {
  const { User } = await import('../src/models/User.js');
  const { OAuth2Client } = await import('google-auth-library');
  const previous = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = 'local-client-id';
  const stubs = [
    mock.method(OAuth2Client.prototype, 'verifyIdToken', async () => ({
      getPayload: () => ({ sub: 'google-user-2', email: 'existing@example.com', email_verified: true }),
    })),
    mock.method(User, 'findOne', async filter => 'email' in filter ? { id: 'existing-user' } : null),
  ];
  const server = createApp().listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/google`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credential: 'simulated-google-id-token' }),
    });
    assert.equal(response.status, 409);
  } finally {
    await new Promise(resolve => server.close(resolve));
    stubs.forEach(stub => stub.mock.restore());
    if (previous === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = previous;
  }
});
