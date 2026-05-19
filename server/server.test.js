const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createServer, cmdTranscodeAll } = require('./server.js');

const TEST_DIR = path.join(__dirname, '.test-videos');
const TEST_IMAGES_DIR = path.join(__dirname, '.test-images');

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
    assert.ok(ffmpegArgs.includes('aac') && ffmpegArgs[ffmpegArgs.indexOf('-c:a') + 1] === 'aac', 'should encode audio as aac');
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
    assert.equal(data.ready, false, 'upload responds immediately with ready:false; poll /ready/<stem> for completion');
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
    assert.equal(ffmpegArgs[ffmpegArgs.indexOf('-c:a') + 1], 'aac', 'should encode audio as aac');
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

  it('deletes .orig file when ffmpeg fails (upload always returns 200 immediately)', async () => {
    let origPath;
    // Upload responds 200 immediately and transcodes async; ffmpeg failure is reported via /ready/<stem>
    const execFileFn = (_cmd, args, _opts, cb) => {
      origPath = args[args.indexOf('-i') + 1];
      cb(new Error('codec not found'), '', 'codec not found');
    };
    const { server, baseURL } = await startServer({ execFileFn });
    const res = await post(`${baseURL}/upload?name=cleanup_fail.mp4`, Buffer.from('fake'));
    // Wait briefly for the async transcode to fail and clean up
    await new Promise(r => setTimeout(r, 50));
    await stopServer(server);
    assert.equal(res.status, 200, 'upload always returns 200 immediately regardless of transcode outcome');
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

describe('/images serving', () => {
  before(() => {
    if (fs.existsSync(TEST_IMAGES_DIR)) fs.rmSync(TEST_IMAGES_DIR, { recursive: true });
    fs.mkdirSync(TEST_IMAGES_DIR);
  });

  after(() => {
    if (fs.existsSync(TEST_IMAGES_DIR)) fs.rmSync(TEST_IMAGES_DIR, { recursive: true });
  });

  it('serves a PNG with correct content-type', async () => {
    fs.writeFileSync(path.join(TEST_IMAGES_DIR, 'test.png'), 'fake png data');
    const { server, baseURL } = await startServer({ imagesDir: TEST_IMAGES_DIR });
    const res = await fetch(`${baseURL}/images/test.png`);
    await stopServer(server);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/png');
    assert.equal(res.body, 'fake png data');
  });

  it('serves a JPG with correct content-type', async () => {
    fs.writeFileSync(path.join(TEST_IMAGES_DIR, 'photo.jpg'), 'fake jpg data');
    const { server, baseURL } = await startServer({ imagesDir: TEST_IMAGES_DIR });
    const res = await fetch(`${baseURL}/images/photo.jpg`);
    await stopServer(server);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/jpeg');
  });

  it('serves a WEBP with correct content-type', async () => {
    fs.writeFileSync(path.join(TEST_IMAGES_DIR, 'anim.webp'), 'fake webp data');
    const { server, baseURL } = await startServer({ imagesDir: TEST_IMAGES_DIR });
    const res = await fetch(`${baseURL}/images/anim.webp`);
    await stopServer(server);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/webp');
  });

  it('returns 404 for missing files', async () => {
    const { server, baseURL } = await startServer({ imagesDir: TEST_IMAGES_DIR });
    const res = await fetch(`${baseURL}/images/nonexistent.png`);
    await stopServer(server);
    assert.equal(res.status, 404);
  });

  it('rejects unsupported extensions', async () => {
    const { server, baseURL } = await startServer({ imagesDir: TEST_IMAGES_DIR });
    const res = await fetch(`${baseURL}/images/script.exe`);
    await stopServer(server);
    assert.equal(res.status, 400);
  });

  it('rejects path traversal', async () => {
    const { server, baseURL } = await startServer({ imagesDir: TEST_IMAGES_DIR });
    const res = await fetch(`${baseURL}/images/../etc/passwd`);
    await stopServer(server);
    assert.notEqual(res.status, 200);
  });

  it('sets CORS headers', async () => {
    fs.writeFileSync(path.join(TEST_IMAGES_DIR, 'cors.png'), 'data');
    const { server, baseURL } = await startServer({ imagesDir: TEST_IMAGES_DIR });
    const res = await fetch(`${baseURL}/images/cors.png`);
    await stopServer(server);
    assert.equal(res.headers['access-control-allow-origin'], '*');
  });
});

describe('cmdTranscodeAll', () => {
  const TEST_ALL_DIR = path.join(__dirname, '.test-transcode-all');

  // Builds an execFileFn that handles both ffmpeg I-frame check (pipe:1 output) and ffmpeg transcode.
  // For the I-frame check: non-empty stdout means a non-I-frame was found (not I-frame-only).
  // Files whose stems are listed in nonIFrameStems are treated as not I-frame-only.
  function makeExecFileForAll({ nonIFrameStems = [] } = {}) {
    return (cmd, args, _opts, cb) => {
      if (args.includes('pipe:1')) {
        const iIdx = args.indexOf('-i');
        const stem = path.basename(args[iIdx + 1], '.mp4');
        cb(null, nonIFrameStems.includes(stem) ? 'x' : '', '');
      } else {
        fs.writeFileSync(args[args.length - 1], 'transcoded');
        cb(null, '', '');
      }
    };
  }

  before(() => {
    if (fs.existsSync(TEST_ALL_DIR)) fs.rmSync(TEST_ALL_DIR, { recursive: true });
    fs.mkdirSync(TEST_ALL_DIR);
  });

  afterEach(() => {
    const files = fs.readdirSync(TEST_ALL_DIR);
    for (const f of files) fs.rmSync(path.join(TEST_ALL_DIR, f), { force: true });
  });

  after(() => {
    if (fs.existsSync(TEST_ALL_DIR)) fs.rmSync(TEST_ALL_DIR, { recursive: true });
  });

  it('transcodes files that are not I-frame-only', async () => {
    fs.writeFileSync(path.join(TEST_ALL_DIR, 'mixed.mp4'), 'original');
    let transcoded = [];
    const execFileFn = (cmd, args, _opts, cb) => {
      if (args.includes('pipe:1')) { cb(null, 'x', ''); } // non-empty = non-I-frame found
      else { transcoded.push(path.basename(args[args.length - 1])); fs.writeFileSync(args[args.length - 1], 'transcoded'); cb(null, '', ''); }
    };
    await cmdTranscodeAll({ downloadDir: TEST_ALL_DIR, execFileFn });
    assert.ok(transcoded.some(f => f === 'mixed.mp4'), 'should transcode the non-I-frame-only file');
  });

  it('skips files that are already I-frame-only', async () => {
    fs.writeFileSync(path.join(TEST_ALL_DIR, 'good.mp4'), 'original');
    let transcodeCallCount = 0;
    const execFileFn = (cmd, args, _opts, cb) => {
      if (args.includes('pipe:1')) { cb(null, '', ''); } // empty = I-frame-only
      else { transcodeCallCount++; fs.writeFileSync(args[args.length - 1], 'transcoded'); cb(null, '', ''); }
    };
    await cmdTranscodeAll({ downloadDir: TEST_ALL_DIR, execFileFn });
    assert.equal(transcodeCallCount, 0, 'should not call ffmpeg transcode for I-frame-only file');
  });

  it('skips .orig.mp4 files', async () => {
    fs.writeFileSync(path.join(TEST_ALL_DIR, 'leftover.orig.mp4'), 'original');
    let checkCalled = false;
    const execFileFn = (cmd, args, _opts, cb) => {
      if (args.includes('pipe:1')) { checkCalled = true; cb(null, '', ''); }
      else { fs.writeFileSync(args[args.length - 1], 'transcoded'); cb(null, '', ''); }
    };
    await cmdTranscodeAll({ downloadDir: TEST_ALL_DIR, execFileFn });
    assert.equal(checkCalled, false, 'should not check .orig.mp4 files');
  });

  it('handles empty directory without error', async () => {
    await cmdTranscodeAll({ downloadDir: TEST_ALL_DIR, execFileFn: makeExecFileForAll() });
  });

  it('continues after a single file fails to check', async () => {
    fs.writeFileSync(path.join(TEST_ALL_DIR, 'bad.mp4'), 'x');
    fs.writeFileSync(path.join(TEST_ALL_DIR, 'good.mp4'), 'x');
    let transcoded = [];
    const execFileFn = (cmd, args, _opts, cb) => {
      if (args.includes('pipe:1')) {
        const iIdx = args.indexOf('-i');
        const stem = path.basename(args[iIdx + 1], '.mp4');
        if (stem === 'bad') cb(new Error('check failed'), '', 'check failed');
        else cb(null, 'x', ''); // non-empty = needs transcode
      } else {
        transcoded.push(path.basename(args[args.length - 1]));
        fs.writeFileSync(args[args.length - 1], 'transcoded');
        cb(null, '', '');
      }
    };
    await cmdTranscodeAll({ downloadDir: TEST_ALL_DIR, execFileFn });
    assert.ok(transcoded.some(f => f === 'good.mp4'), 'should still transcode the other file');
  });

  it('handles missing directory without error', async () => {
    await cmdTranscodeAll({ downloadDir: path.join(__dirname, '.nonexistent-dir'), execFileFn: makeExecFileForAll() });
  });
});
