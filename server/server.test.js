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

function options(url, requestHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname, port: u.port,
      path: u.pathname + u.search, method: 'OPTIONS',
      headers: requestHeaders,
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

function post(url, body = Buffer.alloc(0), headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const req = http.request({
      hostname: u.hostname, port: u.port,
      path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length, ...headers },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data, json: () => JSON.parse(data) }));
    });
    req.on('error', reject);
    req.end(buf);
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

function makeExecFile(exitCode, errMsg) {
  return (_cmd, args, _opts, cb) => {
    process.nextTick(() => {
      if (exitCode === 0) {
        fs.writeFileSync(args[args.length - 1], 'transcoded data');
        cb(null, '', '');
      } else {
        cb(new Error(errMsg || 'ffmpeg failed'), '', errMsg || '');
      }
    });
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

    const { server, baseURL } = await startServer({ spawnFn, execFileFn: makeExecFile(0) });
    const res = await fetch(`${baseURL}/download?v=${encodeURIComponent(videoURL)}`);
    await stopServer(server);

    assert.equal(res.status, 200);
    const data = res.json();
    assert.equal(data.url, `${baseURL}/videos/test123.mp4`);
    assert.equal(data.ready, true);
  });

  it('downloads to .orig.mp4 then transcodes to .mp4', async () => {
    const videoURL = 'https://www.youtube.com/watch?v=transcode1';
    let ytdlpOutPath, ffmpegInPath, ffmpegOutPath;

    const spawnFn = (cmd, args) => {
      const outIdx = args.indexOf('-o');
      if (outIdx !== -1) {
        ytdlpOutPath = args[outIdx + 1];
        fs.writeFileSync(ytdlpOutPath, 'original data');
      }
      return makeSpawn(0)(cmd, args);
    };

    const execFileFn = (_cmd, args, _opts, cb) => {
      ffmpegInPath = args[args.indexOf('-i') + 1];
      ffmpegOutPath = args[args.length - 1];
      fs.writeFileSync(ffmpegOutPath, 'transcoded data');
      cb(null, '', '');
    };

    const { server, baseURL } = await startServer({ spawnFn, execFileFn });
    await fetch(`${baseURL}/download?v=${encodeURIComponent(videoURL)}`);
    await stopServer(server);

    assert.ok(ytdlpOutPath?.endsWith('.orig.mp4'), 'yt-dlp should write to .orig.mp4');
    assert.equal(ffmpegInPath, ytdlpOutPath, 'ffmpeg input should be the .orig.mp4');
    assert.ok(ffmpegOutPath?.endsWith('transcode1.mp4'), 'ffmpeg output should be the final .mp4');
  });

  it('deletes .orig.mp4 after successful transcode', async () => {
    const videoURL = 'https://www.youtube.com/watch?v=cleanup1';
    let origPath;

    const spawnFn = (cmd, args) => {
      const outIdx = args.indexOf('-o');
      if (outIdx !== -1) {
        origPath = args[outIdx + 1];
        fs.writeFileSync(origPath, 'original data');
      }
      return makeSpawn(0)(cmd, args);
    };

    const { server, baseURL } = await startServer({ spawnFn, execFileFn: makeExecFile(0) });
    await fetch(`${baseURL}/download?v=${encodeURIComponent(videoURL)}`);
    await stopServer(server);

    assert.ok(origPath, 'should have captured orig path');
    assert.equal(fs.existsSync(origPath), false, '.orig.mp4 should be deleted after transcode');
  });

  it('deletes .orig.mp4 when ffmpeg fails', async () => {
    const videoURL = 'https://www.youtube.com/watch?v=cleanup2';
    let origPath;

    const spawnFn = (cmd, args) => {
      const outIdx = args.indexOf('-o');
      if (outIdx !== -1) {
        origPath = args[outIdx + 1];
        fs.writeFileSync(origPath, 'original data');
      }
      return makeSpawn(0)(cmd, args);
    };

    const { server, baseURL } = await startServer({ spawnFn, execFileFn: makeExecFile(1, 'codec not found') });
    const res = await fetch(`${baseURL}/download?v=${encodeURIComponent(videoURL)}`);
    await stopServer(server);

    assert.equal(res.status, 500);
    assert.ok(origPath, 'should have captured orig path');
    assert.equal(fs.existsSync(origPath), false, '.orig.mp4 should be deleted even when ffmpeg fails');
  });

  it('returns 500 when ffmpeg transcoding fails', async () => {
    const videoURL = 'https://www.youtube.com/watch?v=ffmpegfail' + Date.now();

    const spawnFn = (cmd, args) => {
      const outIdx = args.indexOf('-o');
      if (outIdx !== -1) fs.writeFileSync(args[outIdx + 1], 'original data');
      return makeSpawn(0)(cmd, args);
    };

    const { server, baseURL } = await startServer({ spawnFn, execFileFn: makeExecFile(1, 'codec not found') });
    const res = await fetch(`${baseURL}/download?v=${encodeURIComponent(videoURL)}`);
    await stopServer(server);

    assert.equal(res.status, 500);
    assert.match(res.json().error, /Transcode failed/);
  });

  it('passes I-frame-only flags to ffmpeg', async () => {
    const videoURL = 'https://www.youtube.com/watch?v=iframecheck';
    let ffmpegArgs;

    const spawnFn = (cmd, args) => {
      const outIdx = args.indexOf('-o');
      if (outIdx !== -1) fs.writeFileSync(args[outIdx + 1], 'fake');
      return makeSpawn(0)(cmd, args);
    };

    const execFileFn = (_cmd, args, _opts, cb) => {
      ffmpegArgs = args;
      fs.writeFileSync(args[args.length - 1], 'transcoded');
      cb(null, '', '');
    };

    const { server, baseURL } = await startServer({ spawnFn, execFileFn });
    await fetch(`${baseURL}/download?v=${encodeURIComponent(videoURL)}`);
    await stopServer(server);

    assert.ok(ffmpegArgs.includes('keyint=1:min-keyint=1:scenecut=0'), 'should pass I-frame-only x264opts');
    assert.ok(ffmpegArgs.includes('1') && ffmpegArgs[ffmpegArgs.indexOf('-g') + 1] === '1', 'should set -g 1');
    assert.ok(ffmpegArgs.includes('copy') && ffmpegArgs[ffmpegArgs.indexOf('-c:a') + 1] === 'copy', 'should copy audio');
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

    const { server, baseURL } = await startServer({ spawnFn, execFileFn: makeExecFile(0) });
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

describe('/upload', () => {
  before(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(TEST_DIR);
  });

  after(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  });

  it('responds to CORS preflight with allowed Content-Type header', async () => {
    const { server, baseURL } = await startServer({ execFileFn: makeExecFile(0) });
    const res = await options(`${baseURL}/upload`, {
      'Origin': 'http://localhost:5173',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    });
    await stopServer(server);
    assert.equal(res.status, 204);
    const allowed = res.headers['access-control-allow-headers'] ?? '';
    assert.ok(
      allowed.toLowerCase().includes('content-type') || allowed === '*',
      `Access-Control-Allow-Headers should include content-type, got: "${allowed}"`
    );
  });

  it('returns 400 when ?name= is missing', async () => {
    const { server, baseURL } = await startServer({ execFileFn: makeExecFile(0) });
    const res = await post(`${baseURL}/upload`, Buffer.from('fake video'));
    await stopServer(server);
    assert.equal(res.status, 400);
  });

  it('returns 400 for names with path traversal characters', async () => {
    const { server, baseURL } = await startServer({ execFileFn: makeExecFile(0) });
    const res = await post(`${baseURL}/upload?name=../../etc/passwd`, Buffer.from('fake'));
    await stopServer(server);
    assert.equal(res.status, 400);
  });

  it('returns 400 for names with illegal characters', async () => {
    const { server, baseURL } = await startServer({ execFileFn: makeExecFile(0) });
    const res = await post(`${baseURL}/upload?name=bad%20name!`, Buffer.from('fake'));
    await stopServer(server);
    assert.equal(res.status, 400);
  });

  it('returns { url, ready: true } on successful upload', async () => {
    const { server, baseURL } = await startServer({ execFileFn: makeExecFile(0) });
    const res = await post(`${baseURL}/upload?name=myclip.mp4`, Buffer.from('fake video data'));
    await stopServer(server);
    assert.equal(res.status, 200);
    const data = res.json();
    assert.equal(data.ready, true);
    assert.match(data.url, /\/videos\/myclip\.mp4$/);
  });

  it('passes I-frame-only flags to ffmpeg', async () => {
    let ffmpegArgs;
    const execFileFn = (_cmd, args, _opts, cb) => {
      ffmpegArgs = args;
      fs.writeFileSync(args[args.length - 1], 'transcoded');
      cb(null, '', '');
    };
    const { server, baseURL } = await startServer({ execFileFn });
    await post(`${baseURL}/upload?name=iframetest.mp4`, Buffer.from('fake'));
    await stopServer(server);
    assert.ok(ffmpegArgs.includes('keyint=1:min-keyint=1:scenecut=0'), 'should pass I-frame-only x264opts');
    assert.equal(ffmpegArgs[ffmpegArgs.indexOf('-g') + 1], '1', 'should set -g 1');
    assert.equal(ffmpegArgs[ffmpegArgs.indexOf('-c:a') + 1], 'copy', 'should copy audio');
  });

  it('deletes .orig file after successful transcode', async () => {
    let origPath;
    const execFileFn = (_cmd, args, _opts, cb) => {
      origPath = args[args.indexOf('-i') + 1];
      fs.writeFileSync(args[args.length - 1], 'transcoded');
      cb(null, '', '');
    };
    const { server, baseURL } = await startServer({ execFileFn });
    await post(`${baseURL}/upload?name=cleanup_ok.mp4`, Buffer.from('fake'));
    await stopServer(server);
    assert.ok(origPath, 'should have captured orig path');
    assert.equal(fs.existsSync(origPath), false, '.orig file should be deleted after transcode');
  });

  it('deletes .orig file and returns 500 when ffmpeg fails', async () => {
    let origPath;
    const execFileFn = (_cmd, args, _opts, cb) => {
      origPath = args[args.indexOf('-i') + 1];
      cb(new Error('codec not found'), '', 'codec not found');
    };
    const { server, baseURL } = await startServer({ execFileFn });
    const res = await post(`${baseURL}/upload?name=cleanup_fail.mp4`, Buffer.from('fake'));
    await stopServer(server);
    assert.equal(res.status, 500);
    assert.ok(origPath, 'should have captured orig path');
    assert.equal(fs.existsSync(origPath), false, '.orig file should be deleted even on failure');
  });

  it('returns existing file without re-transcoding (idempotent)', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'existing.mp4'), 'already transcoded');
    let execCalled = false;
    const execFileFn = (_cmd, _args, _opts, cb) => { execCalled = true; cb(null, '', ''); };
    const { server, baseURL } = await startServer({ execFileFn });
    const res = await post(`${baseURL}/upload?name=existing.mp4`, Buffer.from('new data'));
    await stopServer(server);
    assert.equal(res.status, 200);
    assert.equal(res.json().ready, true);
    assert.equal(execCalled, false, 'should not re-transcode existing file');
  });

  it('sets CORS headers on response', async () => {
    const { server, baseURL } = await startServer({ execFileFn: makeExecFile(0) });
    const res = await post(`${baseURL}/upload?name=corstest.mp4`, Buffer.from('fake'));
    await stopServer(server);
    assert.equal(res.headers['access-control-allow-origin'], '*');
  });
});
