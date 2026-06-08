import { fft, getFftState } from './fft-audio';
import { getAllStreamStates } from './stream-manager';

function btn(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.className = 'pd-btn';
  b.addEventListener('click', onClick);
  return b;
}

function label(text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.textContent = text;
  s.className = 'audio-label';
  return s;
}

function section(): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'audio-section';
  return d;
}

function slider(min: number, max: number, step: number, value: number, onChange: (v: number) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.className = 'audio-slider';
  input.addEventListener('input', () => onChange(parseFloat(input.value)));
  return input;
}

function sliderRow(labelText: string, min: number, max: number, step: number, value: number, onChange: (v: number) => void): HTMLDivElement {
  const wrap = document.createElement('div');
  const lbl = document.createElement('span');
  lbl.className = 'audio-slider-val';
  const input = slider(min, max, step, value, (v) => { lbl.textContent = ` ${v.toFixed(2)}`; onChange(v); });
  lbl.textContent = ` ${value.toFixed(2)}`;
  const row = document.createElement('div');
  row.className = 'audio-slider-row';
  const labelEl = document.createElement('span');
  labelEl.textContent = labelText;
  labelEl.className = 'audio-slider-label';
  row.appendChild(labelEl);
  row.appendChild(lbl);
  wrap.appendChild(row);
  wrap.appendChild(input);
  return wrap;
}

export function setupAudioTab(container: HTMLElement): void {
  container.innerHTML = '';

  // ── Source section ───────────────────────────────────────────────────────
  const srcSection = section();
  srcSection.appendChild(label('Audio source'));

  const srcRow = document.createElement('div');
  srcRow.className = 'audio-src-row';

  const micBtn = btn('Microphone', async () => {
    try {
      await fft.setSource('mic');
      renderDevices(deviceSection);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showStatus(statusEl, `Error: ${msg}`, true);
    }
  });

  const sysBtn = btn('System audio', async () => {
    try {
      await fft.setSource('system');
      showStatus(statusEl, 'System audio active');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showStatus(statusEl, `Error: ${msg}`, true);
    }
  });

  srcRow.appendChild(micBtn);
  srcRow.appendChild(sysBtn);
  srcSection.appendChild(srcRow);

  // Status indicator
  const statusEl = document.createElement('div');
  statusEl.className = 'audio-status';
  const state = getFftState();
  statusEl.textContent = state.active ? '● Active' : '○ Inactive — access fft in a pattern to start';
  srcSection.appendChild(statusEl);
  container.appendChild(srcSection);

  // ── Device picker ────────────────────────────────────────────────────────
  const deviceSection = section();
  deviceSection.appendChild(label('Microphone input'));
  container.appendChild(deviceSection);
  renderDevices(deviceSection);

  // ── Screen streams ───────────────────────────────────────────────────────
  const screenSection = section();
  screenSection.appendChild(label('Screen stream audio'));
  container.appendChild(screenSection);
  renderScreenStreams(screenSection, statusEl);

  // ── Config sliders ───────────────────────────────────────────────────────
  const configSection = section();
  configSection.appendChild(label('Configuration'));
  configSection.appendChild(sliderRow('Smooth', 0, 1, 0.01, state.config.smooth, v => fft.setSmooth(v)));
  configSection.appendChild(sliderRow('Cutoff', 0, 0.02, 0.001, state.config.cutoff, v => fft.setCutoff(v)));
  configSection.appendChild(sliderRow('Scale', 0, 2, 0.01, state.config.scale, v => fft.setScale(v)));
  configSection.appendChild(sliderRow('Bins', 1, 16, 1, state.config.bins, v => fft.setBins(v)));
  container.appendChild(configSection);

  // ── Live bin meter ───────────────────────────────────────────────────────
  const meterSection = section();
  meterSection.appendChild(label('Level meter'));
  const meterCanvas = document.createElement('canvas');
  meterCanvas.width = 200;
  meterCanvas.height = 40;
  meterCanvas.className = 'audio-meter';
  meterSection.appendChild(meterCanvas);
  container.appendChild(meterSection);
  startMeterLoop(meterCanvas, statusEl);
}

function showStatus(el: HTMLElement, msg: string, isError = false): void {
  el.textContent = msg;
  el.style.color = isError ? '#c44' : '#6a6';
  if (!isError) setTimeout(() => { el.style.color = '#666'; el.textContent = '● Active'; }, 3000);
}

async function renderDevices(section: HTMLElement): Promise<void> {
  // Clear existing device entries (but keep label)
  Array.from(section.children).forEach(c => {
    if ((c as HTMLElement).tagName !== 'SPAN') section.removeChild(c);
  });

  let devices: MediaDeviceInfo[] = [];
  try {
    devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
  } catch { return; }

  if (devices.length === 0) {
    const note = document.createElement('div');
    note.className = 'audio-note';
    note.textContent = 'No mic devices found (grant permission first)';
    section.appendChild(note);
    return;
  }

  const select = document.createElement('select');
  select.className = 'audio-select';
  for (const d of devices) {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `Microphone (${d.deviceId.slice(0, 8)}...)`;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => {
    fft.setSource(select.value).catch(e => console.warn('[fft] device switch failed:', e));
  });
  section.appendChild(select);
}

function renderScreenStreams(section: HTMLElement, statusEl: HTMLElement): void {
  Array.from(section.children).forEach(c => {
    if ((c as HTMLElement).tagName !== 'SPAN') section.removeChild(c);
  });

  const streams = getAllStreamStates().filter(s => s.kind === 'screen' && s.active);
  if (streams.length === 0) {
    const note = document.createElement('div');
    note.className = 'audio-note';
    note.textContent = 'No active screen captures (use loadScreen or Videos tab)';
    section.appendChild(note);
    return;
  }

  for (const s of streams) {
    const hasTracks = s.stream.getAudioTracks().length > 0;
    const row = document.createElement('div');
    row.className = 'audio-stream-row';
    row.style.cursor = hasTracks ? 'pointer' : 'default';
    const dot = document.createElement('span');
    dot.textContent = hasTracks ? '◎' : '○';
    dot.className = 'audio-stream-dot';
    dot.style.color = hasTracks ? '#8a8' : '#555';
    const name = document.createElement('span');
    name.textContent = s.name + (hasTracks ? '' : ' (no audio)');
    name.className = 'audio-stream-name';
    name.style.color = hasTracks ? '#ccc' : '#555';
    row.appendChild(dot);
    row.appendChild(name);
    if (hasTracks) {
      row.addEventListener('click', () => {
        fft.setSource(`screen:${s.name}`).catch(e => {
          showStatus(statusEl, `Error: ${e instanceof Error ? e.message : e}`, true);
        });
      });
    }
    section.appendChild(row);
  }
}

function startMeterLoop(canvas: HTMLCanvasElement, statusEl: HTMLElement): void {
  const ctx = canvas.getContext('2d')!;
  let rafId: number;
  let lastActiveState = false;

  function draw() {
    rafId = requestAnimationFrame(draw);
    const state = getFftState();

    // Update status text and colour when active state changes
    if (state.active !== lastActiveState) {
      lastActiveState = state.active;
      statusEl.textContent = state.active ? '● Active' : '○ Inactive';
      statusEl.style.color = state.active ? '#6a6' : '#666';
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!state.active || state.bins.length === 0) {
      ctx.fillStyle = '#333';
      ctx.fillRect(0, 15, canvas.width, 10);
      return;
    }

    const bins = state.bins;
    const barW = canvas.width / bins.length;
    for (let i = 0; i < bins.length; i++) {
      const h = Math.round(bins[i] * canvas.height);
      const hue = 120 * (1 - i / Math.max(1, bins.length - 1));
      ctx.fillStyle = `hsl(${hue},70%,45%)`;
      ctx.fillRect(i * barW + 1, canvas.height - h, barW - 2, h);
    }
  }

  draw();

  // Clean up when the tab container is removed from DOM
  const observer = new MutationObserver(() => {
    if (!canvas.isConnected) { cancelAnimationFrame(rafId); observer.disconnect(); }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
