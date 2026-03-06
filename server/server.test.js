const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createServer } = require('./server.js');

const TEST_DIR = path.join(__dirname, '.test-videos');

function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: opts.headers || {} }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body, json: () => JSON.parse(body) }));
    });
    req.on('error', reject);
  });
}

function makeSpawn(exitCode, stderrData) {
  return (_cmd, _args) => {
    const proc = new EventEmitter();
    proc.stderr = new EventEmitter();
    process.nextTick(() => {
      if (stderrData) proc.stderr.emit('data', stderrData);
      proc.emit('close', exitCode);
    });
    return proc;
  };
}

function startServer(opts) {
  const server = createServer({ port: 0, downloadDir: TEST_DIR, ...opts });
  return new Promise(resolve => {
    server.listen(0, () => {
      const baseURL = `http://localhost:${server.address().port}`;
      resolve({ server, baseURL });
    });
  });
}

function stopServer(server) {
  return new Promise(resolve => server.close(resolve));
}

describe('/download', () => {
  before(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(TEST_DIR);
  });

  after(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  });

  it('returns 400 when ?v= is missing', async () => {
    const { server, baseURL } = await startServer({ spawnFn: makeSpawn(0) });
    const res = await fetch(`${baseURL}/download`);
    await stopServer(server);
    assert.equal(res.status, 400);
    assert.equal(res.json().error, 'Missing ?v= parameter');
  });

  it('returns file path on successful download', async () => {
    const videoURL = 'https://www.youtube.com/watch?v=test123';

    const spawnFn = (cmd, args) => {
      const outIdx = args.indexOf('-o');
      if (outIdx !== -1) fs.writeFileSync(args[outIdx + 1], 'fake mp4 data');
      return makeSpawn(0)(cmd, args);
    };

    const { server, baseURL } = await startServer({ spawnFn });
    const res = await fetch(`${baseURL}/download?v=${encodeURIComponent(videoURL)}`);
    await stopServer(server);

    assert.equal(res.status, 200);
    const data = res.json();
    assert.equal(data.url, `${baseURL}/videos/test123.mp4`);
    assert.equal(data.ready, true);
  });

  it('returns cached file without re-downloading', async () => {
    const videoURL = 'https://www.youtube.com/watch?v=cached';
    fs.writeFileSync(path.join(TEST_DIR, 'cached.mp4'), 'cached data');

    let spawned = false;
    const spawnFn = () => { spawned = true; return makeSpawn(0)(); };

    const { server, baseURL } = await startServer({ spawnFn });
    const res = await fetch(`${baseURL}/download?v=${encodeURIComponent(videoURL)}`);
    await stopServer(server);

    assert.equal(res.status, 200);
    assert.equal(res.json().ready, true);
    assert.equal(spawned, false, 'should not have spawned yt-dlp for cached file');
  });

  it('returns 500 when yt-dlp fails', async () => {
    const { server, baseURL } = await startServer({ spawnFn: makeSpawn(1, 'ERROR: video not found') });
    const videoURL = 'https://www.youtube.com/watch?v=fail' + Date.now();
    const res = await fetch(`${baseURL}/download?v=${encodeURIComponent(videoURL)}`);
    await stopServer(server);

    assert.equal(res.status, 500);
    assert.match(res.json().error, /video not found/);
  });

  it('extracts ID from youtu.be short URLs', async () => {
    const videoURL = 'https://youtu.be/aGMOFLgB1CU';

    const spawnFn = (cmd, args) => {
      const outIdx = args.indexOf('-o');
      if (outIdx !== -1) fs.writeFileSync(args[outIdx + 1], 'fake');
      return makeSpawn(0)(cmd, args);
    };

    const { server, baseURL } = await startServer({ spawnFn });
    const res = await fetch(`${baseURL}/download?v=${encodeURIComponent(videoURL)}`);
    await stopServer(server);

    assert.equal(res.status, 200);
    assert.equal(res.json().url, `${baseURL}/videos/aGMOFLgB1CU.mp4`);
  });

  it('sets CORS headers', async () => {
    const { server, baseURL } = await startServer({ spawnFn: makeSpawn(1) });
    const res = await fetch(`${baseURL}/download?v=https://youtube.com/watch?v=cors`);
    await stopServer(server);

    assert.equal(res.headers['access-control-allow-origin'], '*');
  });
});

describe('/videos serving', () => {
  before(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(TEST_DIR);
  });

  after(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  });

  it('serves a downloaded mp4 file', async () => {
    const id = 'aGMOFLgB1CU';
    fs.writeFileSync(path.join(TEST_DIR, `${id}.mp4`), 'fake video content');

    const { server, baseURL } = await startServer({});
    const res = await fetch(`${baseURL}/videos/${id}.mp4`);
    await stopServer(server);

    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'video/mp4');
    assert.equal(res.body, 'fake video content');
  });

  it('supports range requests', async () => {
    const id = 'dQw4w9WgXcQ';
    fs.writeFileSync(path.join(TEST_DIR, `${id}.mp4`), '0123456789');

    const { server, baseURL } = await startServer({});
    const res = await fetch(`${baseURL}/videos/${id}.mp4`, { headers: { range: 'bytes=2-5' } });
    await stopServer(server);

    assert.equal(res.status, 206);
    assert.equal(res.body, '2345');
    assert.match(res.headers['content-range'], /bytes 2-5\/10/);
  });

  it('returns 404 for missing files', async () => {
    const { server, baseURL } = await startServer({});
    const res = await fetch(`${baseURL}/videos/nonexistent.mp4`);
    await stopServer(server);

    assert.equal(res.status, 404);
  });

  it('rejects invalid filenames', async () => {
    const { server, baseURL } = await startServer({});
    const res = await fetch(`${baseURL}/videos/bad!name.mp4`);
    await stopServer(server);

    assert.equal(res.status, 400);
  });

  it('rejects path traversal', async () => {
    const { server, baseURL } = await startServer({});
    const res = await fetch(`${baseURL}/videos/../etc/passwd`);
    await stopServer(server);

    assert.notEqual(res.status, 200);
  });
});
