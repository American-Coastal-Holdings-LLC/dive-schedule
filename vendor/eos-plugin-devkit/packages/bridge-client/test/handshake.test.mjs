import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BridgeClient, createBridgeClient, isBridgeEnvelope, BRIDGE_PROTOCOL } from '@eos/plugin-bridge';

test('isBridgeEnvelope only accepts frames carrying the protocol tag', () => {
  assert.equal(isBridgeEnvelope({ eos: BRIDGE_PROTOCOL, kind: 'request' }), true);
  assert.equal(isBridgeEnvelope({ eos: 'eos.bridge/0', kind: 'request' }), false);
  assert.equal(isBridgeEnvelope({ kind: 'request' }), false);
  assert.equal(isBridgeEnvelope(null), false);
  assert.equal(isBridgeEnvelope('not an object'), false);
});

test('stub mode: connects with no host and serves all 7 bridge methods', async () => {
  const seen = { nav: null, resize: null, modal: null, toast: null, sync: null };

  const client = await createBridgeClient({
    mode: 'stub',
    stub: {
      identityToken: 'stub.jwt.token',
      identityTokenExpiresAt: 9_999_999_999,
      themeTokens: { mode: 'dark', colors: { primary: '#000000' } },
      modalResult: { actionId: 'confirm' },
      onNavigate: (p) => (seen.nav = p),
      onResize: (p) => (seen.resize = p),
      onModal: (p) => (seen.modal = p),
      onToast: (p) => (seen.toast = p),
      onSyncUrl: (p) => (seen.sync = p),
    },
  });

  assert.equal(client.isConnected(), true);
  assert.equal(client.mode, 'stub');

  const identity = await client.getIdentityToken();
  assert.equal(identity.token, 'stub.jwt.token');
  assert.equal(identity.expiresAt, 9_999_999_999);

  const theme = await client.getThemeTokens();
  assert.equal(theme.mode, 'dark');
  assert.equal(theme.colors.primary, '#000000');

  await client.requestNavigate({ path: '/foo' });
  assert.deepEqual(seen.nav, { path: '/foo' });

  const resizeResult = await client.resize({ height: 400 });
  assert.equal(resizeResult.appliedHeight, 400);
  assert.deepEqual(seen.resize, { height: 400 });

  const modalResult = await client.openModal({ body: 'hi' });
  assert.equal(modalResult.actionId, 'confirm');
  assert.ok(seen.modal);

  await client.toast({ message: 'hello' });
  assert.deepEqual(seen.toast, { message: 'hello' });

  await client.syncUrl({ path: '/bar' });
  assert.deepEqual(seen.sync, { path: '/bar' });

  client.disconnect();
  assert.equal(client.isConnected(), false);
});

test('stub mode: default identity token is a 3-segment placeholder when unconfigured', async () => {
  const client = await createBridgeClient({ mode: 'stub' });
  const identity = await client.getIdentityToken();
  assert.equal(identity.token.split('.').length, 3);
  client.disconnect();
});

test('real mode: completes the MessageChannel handshake with a simulated host, pinning + validating origin', async () => {
  const hostOrigin = 'https://workspace.eos.example';
  const pluginWindow = new EventTarget();

  const client = new BridgeClient({
    mode: 'real',
    hostOrigin,
    windowRef: pluginWindow,
    handshakeTimeoutMs: 2000,
  });
  const connectPromise = client.connect();

  const channel = new MessageChannel();
  let hostReceivedAck = false;
  let hostReceivedRequest = null;

  channel.port1.onmessage = (event) => {
    const data = event.data;
    if (data?.kind === 'handshake/ack') {
      hostReceivedAck = true;
      return;
    }
    if (data?.kind === 'request') {
      hostReceivedRequest = data;
      channel.port1.postMessage({
        eos: BRIDGE_PROTOCOL,
        kind: 'response',
        id: data.id,
        ok: true,
        result: { token: 'real.jwt.token', expiresAt: 1234567890 },
      });
    }
  };

  // A stray message from an untrusted origin, sent before the real handshake —
  // the client must silently drop it, not treat it as the handshake init.
  pluginWindow.dispatchEvent(
    new MessageEvent('message', {
      data: { eos: BRIDGE_PROTOCOL, kind: 'handshake/init', protocolVersion: 1, nonce: 'evil' },
      origin: 'https://evil.example',
    }),
  );

  assert.equal(client.isConnected(), false, 'must not connect from a mismatched-origin handshake');

  // The real handshake init, from the correct host origin, carrying the port.
  pluginWindow.dispatchEvent(
    new MessageEvent('message', {
      data: { eos: BRIDGE_PROTOCOL, kind: 'handshake/init', protocolVersion: 1, nonce: 'abc123' },
      origin: hostOrigin,
      ports: [channel.port2],
    }),
  );

  await connectPromise;
  assert.equal(client.isConnected(), true);

  // MessagePort delivery is FIFO but asynchronous: the ack the client just
  // posted may not have reached port1's onmessage yet at the exact instant
  // connect() resolves. A real round trip forces us to wait for it, since
  // the ack (sent first) and the request (sent second) traverse the same
  // port in order — by the time the request is processed, the ack already
  // was too.
  const identity = await client.getIdentityToken();
  assert.equal(identity.token, 'real.jwt.token');
  assert.equal(hostReceivedAck, true, 'host must have received the handshake/ack over the port');
  assert.ok(hostReceivedRequest);
  assert.equal(hostReceivedRequest.method, 'getIdentityToken');
  assert.equal(hostReceivedRequest.eos, BRIDGE_PROTOCOL);

  client.disconnect();
  // The test plays "host" and owns port1 (the client only owns/closes port2
  // via disconnect()) — close it too, or the open MessagePort keeps the
  // process alive.
  channel.port1.onmessage = null;
  channel.port1.close();
});

test('real mode: connect() rejects with HANDSHAKE_TIMEOUT if the host never shows up', async () => {
  const client = new BridgeClient({
    mode: 'real',
    hostOrigin: 'https://workspace.eos.example',
    windowRef: new EventTarget(),
    handshakeTimeoutMs: 50,
  });

  await assert.rejects(() => client.connect(), (err) => {
    assert.equal(err.code, 'HANDSHAKE_TIMEOUT');
    return true;
  });
});

test('a request made before connect() resolves is rejected with NOT_CONNECTED', async () => {
  const client = new BridgeClient({ mode: 'stub' });
  await assert.rejects(() => client.getThemeTokens(), (err) => {
    assert.equal(err.code, 'NOT_CONNECTED');
    return true;
  });
});
