import { fft, getFftState } from './fft-audio';
import { getAllStreamStates } from './stream-manager';

const BTN_STYLE = "background:#333;color:#ccc;border:1px solid #555;padding:4px 10px;border-radius:3px;cursor:pointer;font-size:14px;";
const LABEL_STYLE = "color:#888;font-size:12px;margin-bottom:4px;display:block;";
const SECTION_STYLE = "padding:8px;border-bottom:1px solid #333;";

function btn(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.style.cssText = BTN_STYLE;
  b.addEventListener('click', onClick);
  return b;
}

function label(text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.textContent = text;
  s.style.cssText = LABEL_STYLE;
  return s;
}

function section(): HTMLDivElement {
  const d = document.createElement('div');
  d.style.cssText = SECTION_STYLE;
  return d;
}

function slider(min: number, max: number, step: number, value: number, onChange: (v: number) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.style.cssText = 'width:100%;margin:2px 0 6px;';
  input.addEventListener('input', () => onChange(parseFloat(input.value)));
  return input;
}

function sliderRow(labelText: string, min: number, max: number, step: number, value: number, onChange: (v: number) => void): HTMLDivElement {
  const wrap = document.createElement('div');
  const lbl = document.createElement('span');
  lbl.style.cssText = 'color:#888;font-size:11px;';
  const input = slider(min, max, step, value, (v) => { lbl.textContent = ` ${v.toFixed(2)}`; onChange(v); });
  lbl.textContent = ` ${value.toFixed(2)}`;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:4px;';
  const labelEl = document.createElement('span');
  labelEl.textContent = labelText;
  labelEl.style.cssText = 'color:#888;font-size:12px;width:60px;flex-shrink:0;';
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
  srcRow.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;';

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
  statusEl.style.cssText = 'margin-top:6px;font-size:12px;color:#666;';
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
  meterCanvas.style.cssText = 'width:100%;height:40px;display:block;background:#111;border-radius:3px;';
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
    note.style.cssText = 'color:#555;font-size:12px;';
    note.textContent = 'No mic devices found (grant permission first)';
    section.appendChild(note);
    return;
  }

  const select = document.createElement('select');
  select.style.cssText = 'width:100%;background:#1a1a1a;color:#ccc;border:1px solid #444;padding:4px;border-radius:3px;font-size:13px;';
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
    note.style.cssText = 'color:#555;font-size:12px;';
    note.textContent = 'No active screen captures (use loadScreen or Videos tab)';
    section.appendChild(note);
    return;
  }

  for (const s of streams) {
    const hasTracks = s.stream.getAudioTracks().length > 0;
    const row = document.createElement('div');
    row.style.cssText = `display:flex;align-items:center;gap:6px;margin:3px 0;cursor:${hasTracks ? 'pointer' : 'default'};`;
    const dot = document.createElement('span');
    dot.textContent = hasTracks ? '◎' : '○';
    dot.style.color = hasTracks ? '#8a8' : '#555';
    dot.style.fontSize = '12px';
    const name = document.createElement('span');
    name.textContent = s.name + (hasTracks ? '' : ' (no audio)');
    name.style.cssText = `font-size:13px;color:${hasTracks ? '#ccc' : '#555'};`;
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
