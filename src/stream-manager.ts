import { addStream, removeMedia, updateEntry, resolveMedia, getAllEntries, setOnChange } from "./media-registry";
import { warn } from "./warnings";
import { describeMediaError } from "./media-errors";

export type StreamState = {
  name: string;
  stream: MediaStream;
  videoEl: HTMLVideoElement;
  kind: "webcam" | "screen";
  active: boolean;
};

const streams = new Map<string, StreamState>();
let onChange: (() => void) | null = null;

export function setStreamOnChange(cb: (() => void) | null) {
  onChange = cb;
}

function notify() {
  onChange?.();
}

async function makeVideoEl(stream: MediaStream): Promise<HTMLVideoElement> {
  const el = document.createElement("video");
  el.autoplay = true;
  el.muted = true;
  el.playsInline = true;
  el.srcObject = stream;
  // Explicit play() — autoplay property alone doesn't reliably start
  // programmatically created elements. Wait for playback to begin so
  // videoWidth/videoHeight are populated before the first render frame.
  await el.play();
  return el;
}

export async function startWebcam(name?: string, deviceId?: string): Promise<string> {
  const constraints: MediaStreamConstraints = {
    video: deviceId ? { deviceId: { exact: deviceId } } : true,
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);

  // Get the actual deviceId from the track for persistence
  const track = stream.getVideoTracks()[0];
  const actualDeviceId = track?.getSettings().deviceId;

  // Register in media registry if not already there
  let entry = name ? resolveMedia(name) : undefined;
  const finalName = entry ? entry.name : addStream("webcam", name, actualDeviceId).name;

  if (entry) {
    // Update deviceId if it changed
    updateEntry(finalName, { deviceId: actualDeviceId });
  }

  // Stop any existing stream with this name
  if (streams.has(finalName)) {
    stopStreamInternal(finalName);
  }

  const videoEl = await makeVideoEl(stream);
  const state: StreamState = { name: finalName, stream, videoEl, kind: "webcam", active: true };
  streams.set(finalName, state);

  // Listen for track ending
  track?.addEventListener("ended", () => {
    state.active = false;
    notify();
  });

  notify();
  return finalName;
}

export async function startScreenCapture(name?: string): Promise<string> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });

  let entry = name ? resolveMedia(name) : undefined;
  const finalName = entry ? entry.name : addStream("screen", name).name;

  // Stop any existing stream with this name
  if (streams.has(finalName)) {
    stopStreamInternal(finalName);
  }

  const videoEl = await makeVideoEl(stream);
  const state: StreamState = { name: finalName, stream, videoEl, kind: "screen", active: true };
  streams.set(finalName, state);

  // Screen capture can end when user clicks "Stop sharing"
  const track = stream.getVideoTracks()[0];
  track?.addEventListener("ended", () => {
    state.active = false;
    notify();
  });

  notify();
  return finalName;
}

function stopStreamInternal(name: string) {
  const state = streams.get(name);
  if (!state) return;
  for (const track of state.stream.getTracks()) {
    track.stop();
  }
  state.videoEl.srcObject = null;
  state.active = false;
  streams.delete(name);
}

export function stopStream(name: string) {
  stopStreamInternal(name);
  notify();
}

export function removeStream(name: string) {
  stopStreamInternal(name);
  removeMedia(name);
  notify();
}

export function getStreamVideoEl(name: string): HTMLVideoElement | null {
  const state = streams.get(name);
  if (!state || !state.active) return null;
  return state.videoEl;
}

export function isStreamActive(name: string): boolean {
  return streams.get(name)?.active ?? false;
}

export function getStreamState(name: string): StreamState | undefined {
  return streams.get(name);
}

export function getAllStreamStates(): StreamState[] {
  return Array.from(streams.values());
}

/**
 * Start a webcam stream and register it by name. Idempotent — no-op if already active.
 * The browser will prompt for camera permission on first call.
 * Use the name with `s()` after calling this.
 *
 * @param {string} name short identifier used in patterns
 * @example
 * loadCamera('cam')
 * $: s('cam')
 */
export function loadCamera(name: string): void {
  if (isStreamActive(name)) return;
  startWebcam(name).catch(err => {
    console.warn(`[loadCamera] failed for "${name}":`, err?.message);
    warn(describeMediaError(err, "Camera"));
  });
}

/**
 * Start a screen/window capture stream and register it by name. Idempotent — no-op if already active.
 * The browser will prompt to choose a screen or window on first call.
 * Use the name with `s()` after calling this.
 *
 * @param {string} name short identifier used in patterns
 * @example
 * loadScreen('scrn')
 * $: s('scrn')
 */
export function loadScreen(name: string): void {
  if (isStreamActive(name)) return;
  startScreenCapture(name).catch(err => {
    console.warn(`[loadScreen] failed for "${name}":`, err?.message);
    warn(describeMediaError(err, "Screen capture"));
  });
}

/**
 * Reconnect all persisted webcam streams on page load.
 * Screen captures cannot auto-reconnect (getDisplayMedia requires user gesture).
 * Webcams can reconnect if permission was previously granted, using the saved deviceId.
 * Failures are silently ignored — the entry stays disconnected in the sidebar.
 * @internal
 */
export async function reconnectStreams() {
  const entries = getAllEntries();
  for (const entry of entries) {
    if (entry.type !== "stream" || entry.streamKind !== "webcam") continue;
    if (streams.has(entry.name)) continue; // already active
    try {
      await startWebcam(entry.name, entry.deviceId);
    } catch {
      // Permission denied or device unavailable — leave as disconnected
    }
  }
}
