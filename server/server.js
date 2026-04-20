const http = require('node:http');
const { execFile, spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const YTDlpWrap = require('yt-dlp-wrap').default;
const ffmpegPath = require('ffmpeg-static');

const DEFAULT_PORT = 3456;
const DOWNLOAD_DIR = path.join(__dirname, 'videos');
const YTDLP_PATH = path.join(__dirname, 'bin', 'yt-dlp');

// Stems currently being transcoded (ffmpeg in progress)
const activeTranscodes = new Set();
// Stems that failed to transcode
const transcodeErrors = new Map();

// Shared promise wrappers around child processes

function ytdlpDownload(youtubeURL, outPath, { spawnFn = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawnFn(YTDLP_PATH, [
      '--ffmpeg-location', ffmpegPath,
      '-f', 'bv*[ext=mp4][height<=1080]+ba[ext=m4a]/bv*[height<=1080]+ba/b',
      '--merge-output-format', 'mp4',
      '-o', outPath,
      '--js-runtimes', 'node',
      youtubeURL,
    ]);
    let stderr = '';
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', code => {
      if (stderr) console.warn(`[yt-dlp] ${stderr.trim()}`);
      if (code !== 0) reject(new Error(stderr || `yt-dlp exited with code ${code}`));
      else resolve();
    });
  });
}

function ffmpegTranscode(inPath, outPath, { execFileFn = execFile, streamingFlags = false } = {}) {
  const movflags = streamingFlags ? '+frag_keyframe+empty_moov' : '+faststart';
  return new Promise((resolve, reject) => {
    execFileFn(ffmpegPath, [
      '-i', inPath,
      '-c:v', 'libx264',
      '-x264opts', 'keyint=1:min-keyint=1:scenecut=0',
      '-g', '1',
      '-preset', 'medium',
      '-movflags', movflags,
      '-c:a', 'aac',
      '-y',
      outPath,
    ], { timeout: 600000 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);
if (!fs.existsSync(path.join(__dirname, 'bin'))) fs.mkdirSync(path.join(__dirname, 'bin'));

function parseURL(req, port) {
  return new URL(req.url, `http://localhost:${port}`);
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
    '--js-runtimes', 'node',
    videoURL,
  ], { timeout: 30000 }, (err, stdout, stderr) => {
    if (stderr) console.warn(`[yt-dlp /url] ${stderr.trim()}`);
    if (err) {
      console.error(`[500] /url failed for ${videoURL}: ${stderr || err.message}`);
      return json(res, 500, { error: stderr || err.message });
    }
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

  console.log(`Downloading YouTube video: ${videoURL}`);
  ytdlpDownload(videoURL, origPath, { spawnFn }).then(() => {
    console.log(`Transcoding ${id} to I-frame-only...`);
    return ffmpegTranscode(origPath, outPath, { execFileFn }).catch(err => {
      throw new Error(`Transcode failed: ${err.message}`);
    });
  }).then(() => {
    fs.unlink(origPath, () => {});
    console.log(`Transcoded ${id}`);
    json(res, 200, { url: fileURL, ready: true });
  }).catch(err => {
    fs.unlink(origPath, () => {});
    console.error(`[500] /download failed for ${videoURL}: ${err.message}`);
    json(res, 500, { error: err.message });
  });
}

function handleUpload(req, res, { port, downloadDir, execFileFn }) {
  const url = parseURL(req, port);
  const rawName = url.searchParams.get('name');
  if (!rawName) return json(res, 400, { error: 'Missing ?name= parameter' });
  if (!/^[\w.-]+$/.test(rawName)) return json(res, 400, { error: 'Invalid name: use only letters, digits, underscores, hyphens, and dots' });

  // Use the name as-is (with extension stripped) as the file stem
  const stem = rawName.replace(/\.[^.]+$/, '');
  const origPath = path.join(downloadDir, `${stem}.orig.mp4`);
  const outPath = path.join(downloadDir, `${stem}.mp4`);
  const fileURL = `http://localhost:${port}/videos/${stem}.mp4`;

  if (fs.existsSync(outPath)) {
    return json(res, 200, { url: fileURL, ready: true });
  }

  console.log(`Receiving upload: ${stem}`);
  const writeStream = fs.createWriteStream(origPath);
  req.pipe(writeStream);
  writeStream.on('error', (err) => {
    console.error(`[500] /upload write failed for ${stem}: ${err.message}`);
    json(res, 500, { error: `Write failed: ${err.message}` });
  });
  writeStream.on('finish', () => {
    console.log(`Transcoding uploaded ${stem} to I-frame-only...`);
    activeTranscodes.add(stem);
    transcodeErrors.delete(stem);
    // Respond immediately so the frontend can start streaming the growing file
    json(res, 200, { url: fileURL, ready: false });
    ffmpegTranscode(origPath, outPath, { execFileFn, streamingFlags: true }).then(() => {
      activeTranscodes.delete(stem);
      fs.unlink(origPath, () => {});
      console.log(`Transcoded uploaded ${stem}`);
    }).catch(err => {
      activeTranscodes.delete(stem);
      fs.unlink(origPath, () => {});
      console.error(`/upload transcode failed for ${stem}: ${err.message}`);
      transcodeErrors.set(stem, err.message);
      fs.unlink(outPath, () => {});
    });
  });
}

function streamTranscodingFile(filePath, stem, _req, res) {
  cors(res);
  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Transfer-Encoding': 'chunked',
    'Cache-Control': 'no-cache',
  });

  let position = 0;
  let cancelled = false;
  res.on('close', () => { cancelled = true; });

  const pump = () => {
    if (cancelled) return;
    fs.stat(filePath, (err, stat) => {
      if (cancelled) return;
      if (err) { res.end(); return; }
      if (position < stat.size) {
        const stream = fs.createReadStream(filePath, { start: position, end: stat.size - 1 });
        position = stat.size;
        stream.on('data', chunk => { if (!cancelled) res.write(chunk); });
        stream.on('end', () => {
          if (cancelled) return;
          if (activeTranscodes.has(stem)) setTimeout(pump, 50);
          else res.end();
        });
        stream.on('error', () => { if (!cancelled) res.end(); });
      } else {
        if (activeTranscodes.has(stem)) setTimeout(pump, 50);
        else res.end();
      }
    });
  };

  pump();
}

function handleServeVideo(req, res, { port, downloadDir }) {
  const url = parseURL(req, port);
  const filename = path.basename(url.pathname);
  if (!/^[\w-]+\.mp4$/.test(filename)) return json(res, 400, { error: 'Invalid filename' });

  const stem = filename.replace(/\.mp4$/, '');
  const filePath = path.join(downloadDir, filename);

  if (activeTranscodes.has(stem)) {
    // File is being written by ffmpeg — stream it live
    if (!fs.existsSync(filePath)) {
      // ffmpeg hasn't created the output file yet; wait briefly and retry
      setTimeout(() => handleServeVideo(req, res, { port, downloadDir }), 100);
      return;
    }
    return streamTranscodingFile(filePath, stem, req, res);
  }

  if (!fs.existsSync(filePath)) return json(res, 404, { error: 'Not found' });

  const stat = fs.statSync(filePath);
  if (stat.size === 0) return json(res, 503, { error: 'File not ready' });

  const range = req.headers.range;
  cors(res);

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const startParsed = parseInt(parts[0], 10);
    const start = Number.isFinite(startParsed) ? startParsed : 0;
    const endParsed = parseInt(parts[1], 10);
    const end = (Number.isFinite(endParsed) && endParsed >= 0) ? endParsed : stat.size - 1;
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

function handleReadyCheck(req, res, { downloadDir, port }) {
  const url = parseURL(req, port);
  const stem = path.basename(url.pathname);
  if (!/^[\w-]+$/.test(stem)) return json(res, 400, { error: 'Invalid stem' });
  const error = transcodeErrors.get(stem);
  if (error) return json(res, 200, { ready: false, error });
  const ready = !activeTranscodes.has(stem) && fs.existsSync(path.join(downloadDir, `${stem}.mp4`));
  json(res, 200, { ready });
}

function createServer(opts = {}) {
  const port = opts.port || DEFAULT_PORT;
  const downloadDir = opts.downloadDir || DOWNLOAD_DIR;
  const spawnFn = opts.spawnFn || spawn;
  const execFileFn = opts.execFileFn || execFile;

  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

  const ctx = { port, downloadDir, spawnFn, execFileFn };

  const server = http.createServer((req, res) => {
    try {
    if (req.method === 'OPTIONS') {
      cors(res);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.writeHead(204);
      return res.end();
    }

    const actualPort = server.address()?.port || port;
    ctx.port = actualPort;
    const url = parseURL(req, actualPort);

    if (req.method === 'GET' && url.pathname === '/url') return handleGetURL(req, res, ctx);
    if (req.method === 'GET' && url.pathname === '/download') return handleDownload(req, res, ctx);
    if (req.method === 'POST' && url.pathname === '/upload') return handleUpload(req, res, ctx);
    if (req.method === 'GET' && url.pathname.startsWith('/videos/')) return handleServeVideo(req, res, ctx);
    if (req.method === 'GET' && url.pathname.startsWith('/ready/')) return handleReadyCheck(req, res, ctx);

    json(res, 404, { error: 'Not found' });
    } catch (err) {
      console.error('Unhandled request error:', err);
      if (!res.headersSent) json(res, 500, { error: 'Internal server error' });
    }
  });

  return server;
}

// ── CLI commands ──────────────────────────────────────────────────────────────

async function cmdDownload(youtubeURL, { transcode = true } = {}) {
  let id;
  try {
    const parsed = new URL(youtubeURL);
    id = parsed.searchParams.get('v') || parsed.pathname.split('/').pop();
  } catch {
    id = youtubeURL;
  }
  if (!id || !/^[\w-]+$/.test(id)) throw new Error(`Could not extract a usable ID from: ${youtubeURL}`);

  const outPath = path.join(DOWNLOAD_DIR, `${id}.mp4`);
  if (fs.existsSync(outPath)) {
    console.log(`Already exists: ${outPath}`);
    console.log(`URL: http://localhost:${DEFAULT_PORT}/videos/${id}.mp4`);
    return;
  }

  if (transcode) {
    const origPath = path.join(DOWNLOAD_DIR, `${id}.orig.mp4`);
    console.log(`Downloading ${youtubeURL} ...`);
    await ytdlpDownload(youtubeURL, origPath);
    console.log(`Transcoding to I-frame-only...`);
    await ffmpegTranscode(origPath, outPath);
    fs.unlink(origPath, () => {});
  } else {
    console.log(`Downloading ${youtubeURL} (no transcode)...`);
    await ytdlpDownload(youtubeURL, outPath);
  }
  console.log(`Done: ${outPath}`);
  console.log(`URL: http://localhost:${DEFAULT_PORT}/videos/${id}.mp4`);
}

async function cmdAdd(filePath, { name, transcode = true } = {}) {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  const stem = (name || path.basename(filePath)).replace(/\.[^.]+$/, '');
  if (!/^[\w.-]+$/.test(stem)) throw new Error(`Invalid name "${stem}": use only letters, digits, underscores, hyphens, and dots`);

  const outPath = path.join(DOWNLOAD_DIR, `${stem}.mp4`);
  if (fs.existsSync(outPath)) {
    console.log(`Already exists: ${outPath}`);
    console.log(`URL: http://localhost:${DEFAULT_PORT}/videos/${stem}.mp4`);
    return;
  }

  if (transcode) {
    console.log(`Transcoding ${filePath} to I-frame-only...`);
    await ffmpegTranscode(filePath, outPath);
  } else {
    console.log(`Copying ${filePath} ...`);
    fs.copyFileSync(filePath, outPath);
  }
  console.log(`Done: ${outPath}`);
  console.log(`URL: http://localhost:${DEFAULT_PORT}/videos/${stem}.mp4`);
}

async function cmdTranscode(stem) {
  const cleanStem = stem.replace(/\.mp4$/, '');
  const sourcePath = path.join(DOWNLOAD_DIR, `${cleanStem}.mp4`);
  if (!fs.existsSync(sourcePath)) throw new Error(`File not found: ${sourcePath}`);

  const origPath = path.join(DOWNLOAD_DIR, `${cleanStem}.orig.mp4`);
  fs.renameSync(sourcePath, origPath);
  console.log(`Transcoding ${cleanStem}.mp4 to I-frame-only...`);
  try {
    await ffmpegTranscode(origPath, sourcePath);
    fs.unlink(origPath, () => {});
    console.log(`Done: ${sourcePath}`);
    console.log(`URL: http://localhost:${DEFAULT_PORT}/videos/${cleanStem}.mp4`);
  } catch (err) {
    // Restore original on failure
    fs.renameSync(origPath, sourcePath);
    throw err;
  }
}

function parseCLIArgs(argv) {
  // Returns { command, args, flags } or null if no subcommand
  const [cmd, ...rest] = argv;
  if (!['download', 'add', 'transcode'].includes(cmd)) return null;
  const flags = { transcode: true };
  const args = [];
  for (const arg of rest) {
    if (arg === '--no-transcode') flags.transcode = false;
    else args.push(arg);
  }
  return { command: cmd, args, flags };
}

async function runCLI(parsed) {
  const { command, args, flags } = parsed;
  if (command === 'download') {
    if (!args[0]) throw new Error('Usage: server.js download <youtube-url> [--no-transcode]');
    await cmdDownload(args[0], { transcode: flags.transcode });
  } else if (command === 'add') {
    if (!args[0]) throw new Error('Usage: server.js add <file> [name] [--no-transcode]');
    await cmdAdd(args[0], { name: args[1], transcode: flags.transcode });
  } else if (command === 'transcode') {
    if (!args[0]) throw new Error('Usage: server.js transcode <stem>');
    await cmdTranscode(args[0]);
  }
}

// ── Server entrypoint ─────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(YTDLP_PATH)) {
    console.log('Downloading yt-dlp binary...');
    await YTDlpWrap.downloadFromGithub(YTDLP_PATH);
    console.log('yt-dlp downloaded.');
  }

  console.log(`Using yt-dlp: ${YTDLP_PATH}`);
  console.log(`Using ffmpeg: ${ffmpegPath}`);

  // Log yt-dlp version and environment diagnostics at startup
  execFile(YTDLP_PATH, ['--version'], (err, stdout) => {
    if (err) console.warn(`Could not get yt-dlp version: ${err.message}`);
    else console.log(`yt-dlp version: ${stdout.trim()}`);
  });

  const server = createServer();
  server.listen(DEFAULT_PORT, () => {
    console.log(`YouTube video server running on http://localhost:${DEFAULT_PORT}`);
    console.log(`
Endpoints:
  GET /url?v=YOUTUBE_URL        — get direct MP4 URL (expires, IP-locked)
  GET /download?v=YOUTUBE_URL   — download video locally, returns serve path
  POST /upload?name=foo.mp4     — upload a local file, re-encode as I-frame-only MP4
  GET /videos/<id>.mp4          — serve a video (supports range requests; streams while transcoding)
  GET /ready/<stem>             — check if a transcoding job is complete
`);
  });
}

if (require.main === module) {
  const parsed = parseCLIArgs(process.argv.slice(2));
  if (parsed) {
    // CLI mode: ensure yt-dlp is available for download commands, then run
    const needsYtdlp = parsed.command === 'download';
    (async () => {
      if (needsYtdlp && !fs.existsSync(YTDLP_PATH)) {
        console.log('Downloading yt-dlp binary...');
        await YTDlpWrap.downloadFromGithub(YTDLP_PATH);
        console.log('yt-dlp downloaded.');
      }
      await runCLI(parsed);
    })().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
  } else {
    main().catch(err => { console.error(err); process.exit(1); });
  }
}

module.exports = { createServer, cmdDownload, cmdAdd, cmdTranscode, parseCLIArgs };
