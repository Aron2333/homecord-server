import { test } from 'node:test';
import assert from 'node:assert';
import { server } from '../index.js';

let authToken: string = '';
let testUserId: string = '';
let testServerId: string = '';
let testChannelId: string = '';

async function post(urlPath: string, body: any, token?: string): Promise<{ status: number; data: any }> {
  const res = await fetch(`http://127.0.0.1:4000${urlPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
  const data: any = await res.json();
  return { status: res.status, data };
}

async function get(urlPath: string, token?: string): Promise<{ status: number; data: any }> {
  const res = await fetch(`http://127.0.0.1:4000${urlPath}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  const data: any = await res.json();
  return { status: res.status, data };
}

test('0. Wait for server readiness', async () => {
  // Give DB init and server listen 1.5 seconds to establish
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch('http://127.0.0.1:4000/api/health');
      if (res.ok) return;
    } catch (e) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
});

test('1. Auth - Register and Login flow', async () => {
  const randomSuffix = Math.floor(Math.random() * 100000);
  const username = `testuser_${randomSuffix}`;
  const email = `test_${randomSuffix}@otpcord.gg`;
  const password = 'StrongPassword123!';

  // Register
  const regRes = await post('/api/auth/register', {
    username,
    display_name: 'Test Tester',
    email,
    password
  });

  assert.strictEqual(regRes.status, 201, 'Registration should succeed with 201');
  assert.ok(regRes.data.token, 'Token should be returned');
  assert.strictEqual(regRes.data.user.username, username);

  testUserId = regRes.data.user.id;
  authToken = regRes.data.token;

  // Me
  const meRes = await get('/api/auth/me', authToken);
  assert.strictEqual(meRes.status, 200);
  assert.strictEqual(meRes.data.user.id, testUserId);

  // Login
  const loginRes = await post('/api/auth/login', {
    login: username,
    password
  });
  assert.strictEqual(loginRes.status, 200);
  assert.ok(loginRes.data.token);
});

test('2. Server Creation - Default roles, tags, channels', async () => {
  const sRes = await post('/api/servers', {
    name: 'Dev Community Server'
  }, authToken);

  assert.strictEqual(sRes.status, 201);
  assert.strictEqual(sRes.data.name, 'Dev Community Server');
  testServerId = sRes.data.id;

  // Fetch server details
  const detailRes = await get(`/api/servers/${testServerId}`, authToken);
  assert.strictEqual(detailRes.status, 200);
  assert.ok(detailRes.data.channels.length >= 2, 'Should create default text and voice channels');
  assert.ok(detailRes.data.roles.length >= 4, 'Should create default roles');
  assert.ok(detailRes.data.tags.length >= 2, 'Should create default tags [DEV], [ADMIN]');

  testChannelId = detailRes.data.channels[0].id;
});

test('3. Messaging - Send message in channel', async () => {
  const msgRes = await post(`/api/channels/${testChannelId}`, {
    content: 'Üdvözlet az OTPCord világában! Teszt üzenet.'
  }, authToken);

  assert.strictEqual(msgRes.status, 201);
  assert.strictEqual(msgRes.data.content, 'Üdvözlet az OTPCord világában! Teszt üzenet.');
  assert.strictEqual(msgRes.data.sender.id, testUserId);
});

test('4. Invites - Create and inspect server invite', async () => {
  const invRes = await post(`/api/invites/servers/${testServerId}`, {
    max_uses: 5,
    expires_hours: 24
  }, authToken);

  assert.strictEqual(invRes.status, 201);
  assert.ok(invRes.data.code);

  const previewRes = await get(`/api/invites/${invRes.data.code}`, authToken);
  assert.strictEqual(previewRes.status, 200);
  assert.strictEqual(previewRes.data.server.name, 'Dev Community Server');

  // Close server when done
  server.close();
  process.exit(0);
});
