const http = require('node:http');
const { execFile, spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const YTDlpWrap = require('yt-dlp-wrap').default;
const ffmpegPath = require('ffmpeg-static');

const DEFAULT_PORT = 3456;
const DOWNLOAD_DIR = path.join(__dirname, 'videos');
const YTDLP_PATH = path.join(__dirname, 'bin', 'yt-dlp');

if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);
if (!fs.existsSync(path.join(__dirname, 'bin'))) fs.mkdirSync(path.join(__dirname, 'bin'));

function parseURL(req, port) {
  return new URL(req.url, `http://localhost:${port}`);
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
}

function json(res, status, data) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function handleGetURL(req, res, { port }) {
  const url = parseURL(req, port);
  const videoURL = url.searchParams.get('v');
  if (!videoURL) return json(res, 400, { error: 'Missing ?v= parameter' });

  execFile(YTDLP_PATH, [
    '--ffmpeg-location', ffmpegPath,
    '-f', 'bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b',
    '--get-url',
    '--no-warnings',
    videoURL,
  ], { timeout: 30000 }, (err, stdout, stderr) => {
    if (err) return json(res, 500, { error: stderr || err.message });
    const urls = stdout.trim().split('\n').filter(Boolean);
    json(res, 200, {
      video: urls[0],
      audio: urls[1] || null,
      muxed: urls.length === 1,
    });
  });
}

function handleDownload(req, res, { port, downloadDir, spawnFn, execFileFn }) {
  const url = parseURL(req, port);
  const videoURL = url.searchParams.get('v');
  if (!videoURL) return json(res, 400, { error: 'Missing ?v= parameter' });

  let id;
  try {
    const parsed = new URL(videoURL);
    id = parsed.searchParams.get('v') || parsed.pathname.split('/').pop();
  } catch {
    id = videoURL;
  }
  if (!id || !/^[\w-]+$/.test(id)) return json(res, 400, { error: 'Could not extract video ID' });
  const origPath = path.join(downloadDir, `${id}.orig.mp4`);
  const outPath = path.join(downloadDir, `${id}.mp4`);

  const fileURL = `http://localhost:${port}/videos/${id}.mp4`;

  if (fs.existsSync(outPath)) {
    return json(res, 200, { url: fileURL, ready: true });
  }

  const proc = spawnFn(YTDLP_PATH, [
    '--ffmpeg-location', ffmpegPath,
    '-f', 'bv*[ext=mp4][height<=1080]+ba[ext=m4a]/bv*[height<=1080]+ba/b',
    '--merge-output-format', 'mp4',
    '-o', origPath,
    '--no-warnings',
    videoURL,
  ]);

  let stderr = '';
  proc.stderr.on('data', d => stderr += d);
  proc.on('close', code => {
    if (code !== 0) {
      fs.unlink(origPath, () => {});
      return json(res, 500, { error: stderr || `yt-dlp exited with code ${code}` });
    }
    console.log(`Transcoding ${id} to I-frame-only...`);
    execFileFn(ffmpegPath, [
      '-i', origPath,
      '-c:v', 'libx264',
      '-x264opts', 'keyint=1:min-keyint=1:scenecut=0',
      '-g', '1',
      '-preset', 'ultrafast',
      '-c:a', 'copy',
      '-y',
      outPath,
    ], { timeout: 600000 }, (err) => {
      fs.unlink(origPath, () => {});
      if (err) return json(res, 500, { error: `Transcode failed: ${err.message}` });
      console.log(`Transcoded ${id}`);
      json(res, 200, { url: fileURL, ready: true });
    });
  });
}

function handleServeVideo(req, res, { port, downloadDir }) {
  const url = parseURL(req, port);
  const filename = path.basename(url.pathname);
  if (!/^[\w-]+\.mp4$/.test(filename)) return json(res, 400, { error: 'Invalid filename' });

  const filePath = path.join(downloadDir, filename);
  if (!fs.existsSync(filePath)) return json(res, 404, { error: 'Not found' });

  const stat = fs.statSync(filePath);
  const range = req.headers.range;

  cors(res);

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': 'video/mp4',
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

function createServer(opts = {}) {
  const port = opts.port || DEFAULT_PORT;
  const downloadDir = opts.downloadDir || DOWNLOAD_DIR;
  const spawnFn = opts.spawnFn || spawn;
  const execFileFn = opts.execFileFn || execFile;

  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

  const ctx = { port, downloadDir, spawnFn, execFileFn };

  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }

    const actualPort = server.address()?.port || port;
    ctx.port = actualPort;
    const url = parseURL(req, actualPort);

    if (req.method === 'GET' && url.pathname === '/url') return handleGetURL(req, res, ctx);
    if (req.method === 'GET' && url.pathname === '/download') return handleDownload(req, res, ctx);
    if (req.method === 'GET' && url.pathname.startsWith('/videos/')) return handleServeVideo(req, res, ctx);

    json(res, 404, { error: 'Not found' });
  });

  return server;
}

async function main() {
  if (!fs.existsSync(YTDLP_PATH)) {
    console.log('Downloading yt-dlp binary...');
    await YTDlpWrap.downloadFromGithub(YTDLP_PATH);
    console.log('yt-dlp downloaded.');
  }

  console.log(`Using yt-dlp: ${YTDLP_PATH}`);
  console.log(`Using ffmpeg: ${ffmpegPath}`);

  const server = createServer();
  server.listen(DEFAULT_PORT, () => {
    console.log(`YouTube video server running on http://localhost:${DEFAULT_PORT}`);
    console.log(`
Endpoints:
  GET /url?v=YOUTUBE_URL        — get direct MP4 URL (expires, IP-locked)
  GET /download?v=YOUTUBE_URL   — download video locally, returns serve path
  GET /videos/<id>.mp4          — serve a downloaded video (supports range requests)
`);
  });
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { createServer };
