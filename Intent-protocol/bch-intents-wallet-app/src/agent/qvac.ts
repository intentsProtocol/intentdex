/**
 * QVAC on the phone: a small catalogue of models, downloading them, choosing the one in use, loading it, and
 * talking to it through the shared LlmClient.
 *
 * `@qvac/sdk` runs the model in its own Bare worker (not the WDK worklet). Nothing it sees is secret: prompts
 * carry balances and token names, never a key. After a model is downloaded it is read from the phone's storage,
 * so everything here works with the network off.
 *
 * Whether a model is on the phone is asked of QVAC (`getModelInfo`), not remembered by the app, so a download
 * that was interrupted, or files that were cleared, show as they are.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { File, Paths } from 'expo-file-system';
import { create } from 'zustand';
import {
  cancel, close, completion, downloadAsset, getModelInfo, loadModel, unloadModel,
  LLAMA_3_2_1B_INST_Q4_0, QWEN3_1_7B_INST_Q4, QWEN3_4B_INST_Q4_K_M, QWEN3_600M_INST_Q4, VERBOSITY,
} from '@qvac/sdk';
import type { ChatMessage, ChatOptions, LlmClient, LlmEvent } from '@bch-intents/wallet-core/agent';

// ── catalogue ───────────────────────────────────────────────────────────────

export type ModelId = 'qwen3-0.6b' | 'llama3.2-1b' | 'qwen3-1.7b' | 'qwen3-4b';

export interface ModelEntry {
  id: ModelId;
  descriptor: { name: string };
  name: string;
  maker: string;
  bytes: number;
  /** 1–4: how well it understands requests and picks tools. */
  smarts: number;
  /** 1–4: how fast it answers on a phone. */
  speed: number;
  /** Phone memory it wants, in GB. */
  minRamGb: number;
}

export const CATALOG: ModelEntry[] = [
  { id: 'qwen3-0.6b', descriptor: QWEN3_600M_INST_Q4, name: 'Qwen3 0.6B', maker: 'Alibaba Qwen', bytes: 382_156_480, smarts: 1, speed: 4, minRamGb: 3 },
  { id: 'llama3.2-1b', descriptor: LLAMA_3_2_1B_INST_Q4_0, name: 'Llama 3.2 1B', maker: 'Meta', bytes: 773_025_920, smarts: 2, speed: 3, minRamGb: 4 },
  { id: 'qwen3-1.7b', descriptor: QWEN3_1_7B_INST_Q4, name: 'Qwen3 1.7B', maker: 'Alibaba Qwen', bytes: 1_056_782_912, smarts: 3, speed: 3, minRamGb: 4 },
  { id: 'qwen3-4b', descriptor: QWEN3_4B_INST_Q4_K_M, name: 'Qwen3 4B', maker: 'Alibaba Qwen', bytes: 2_497_280_000, smarts: 4, speed: 2, minRamGb: 8 },
];
export const entryOf = (id: ModelId) => CATALOG.find(m => m.id === id)!;

/** Phone memory in GB (Samsung S24: about 7.4). */
export const phoneRamGb = () => (Device.totalMemory ?? 0) / 1e9;

/** The best model this phone runs comfortably. */
export function recommendedModel(): ModelId {
  const ram = phoneRamGb();
  if (ram > 0 && ram < 4) return 'qwen3-0.6b';
  return 'qwen3-1.7b';
}

// ── state ───────────────────────────────────────────────────────────────────

export type FileState = 'unknown' | 'absent' | 'partial' | 'downloading' | 'ready' | 'error';
export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface ModelFiles {
  state: FileState;
  /** Bytes on the phone (or downloaded so far). */
  bytes: number;
  total: number;
  /** Bytes per second over the last few seconds of a download. */
  speed: number;
  /** When the download started; for the "still connecting" hint. */
  startedAt?: number;
  error?: string;
  requestId?: string;
  paths?: string[];
}

interface ModelState {
  inited: boolean;
  files: Record<ModelId, ModelFiles>;
  /** The model the assistant uses; null until one is downloaded and chosen. */
  activeId: ModelId | null;
  /** Where to run it. CPU by default: on the Exynos S24 the GPU read prompts at under 20 tokens/s. */
  devicePref: 'cpu' | 'gpu';
  setDevice(device: 'cpu' | 'gpu'): Promise<void>;
  load: LoadState;
  loadError: string;
  loadedId: ModelId | null;
  modelId: string | null;
  device: 'gpu' | 'cpu' | null;
  tokensPerSecond: number | null;
  init(): Promise<void>;
  refresh(id?: ModelId): Promise<void>;
  download(id: ModelId): Promise<void>;
  cancelDownload(id: ModelId): Promise<void>;
  remove(id: ModelId): Promise<void>;
  use(id: ModelId): Promise<void>;
  /** Loads the model in use into memory; resolves once it can answer. */
  ensureLoaded(): Promise<string>;
  unload(): Promise<void>;
}

const PREF_KEY = 'agent_model_v2';
const CTX_SIZE = 4096;
const log = (...a: unknown[]) => console.log('[agent:model]', ...a);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const emptyFiles = (): Record<ModelId, ModelFiles> =>
  Object.fromEntries(CATALOG.map(m => [m.id, { state: 'unknown', bytes: 0, total: m.bytes, speed: 0 }])) as Record<ModelId, ModelFiles>;

/**
 * QVAC reads its config from the app's documents folder on a phone. Warnings and errors only: chattier logging
 * floods the bridge between the worker and the app.
 */
function writeQvacConfig() {
  try {
    const file = new File(Paths.document, 'qvac.config.json');
    const body = JSON.stringify({ loggerLevel: 'warn', loggerConsoleOutput: false, httpConnectionTimeoutMs: 30_000 });
    if (!file.exists) file.create();
    if (file.textSync() !== body) file.write(body);
  } catch (e) { log('could not write qvac.config.json', errText(e)); }
}

let loading: Promise<string> | null = null;

/**
 * QVAC's worker can drop its connection — seen on the S24 right after a download was cancelled: every later call
 * failed with CHANNEL_CLOSED or "No plugins registered". `close()` resets the client; the next call starts a
 * fresh worker. The loaded model went with the old one.
 */
const BROKEN = /CHANNEL_CLOSED|Channel closed|No plugins registered|WorkerCrashed|WorkerShutdown|worker (crashed|exited|shut)/i;
let resetting: Promise<void> | null = null;
async function resetClient(): Promise<void> {
  log('QVAC connection lost; starting it again');
  resetting ??= close().catch(() => {}).finally(() => { resetting = null; }) as Promise<void>;
  await resetting;
  useModel.setState({ modelId: null, loadedId: null, load: 'idle', device: null });
}
async function withRecovery<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (!BROKEN.test(errText(e))) throw e;
    await resetClient();
    return fn();
  }
}

/** Errors worth trying the other source for: the network, not the file. */
const RETRYABLE = /timed? ?out|TIMEOUT|ECONN|ENOTFOUND|network|fetch failed|registry/i;

/**
 * The same model file over plain HTTPS from Hugging Face, where the QVAC registry mirrors it from:
 * registry path `unsloth/Qwen3-1.7B-GGUF/resolve/<rev>/<file>` → huggingface.co/<same, with resolve>.
 */
function httpSource(m: ModelEntry): Record<string, unknown> | null {
  const d = m.descriptor as unknown as { name: string; registryPath?: string; expectedSize?: number; sha256Checksum?: string; engine?: string; addon?: string };
  if (!d.registryPath || !/^[\w.-]+\/[\w.-]+-GGUF\/(blob|resolve)\//i.test(d.registryPath)) return null;
  const path = d.registryPath.replace(/\/blob\//, '/resolve/');
  return { src: `https://huggingface.co/${path}`, name: d.name, expectedSize: d.expectedSize, sha256Checksum: d.sha256Checksum, engine: d.engine, addon: d.addon };
}

export const useModel = create<ModelState>((set, get) => {
  const patch = (id: ModelId, p: Partial<ModelFiles>) => set(s => ({ files: { ...s.files, [id]: { ...s.files[id], ...p } } }));
  let deviceChosen = false;
  const savePref = () => AsyncStorage.setItem(PREF_KEY, JSON.stringify({ activeId: get().activeId, device: get().devicePref, deviceChosen })).catch(() => {});

  return {
    inited: false,
    files: emptyFiles(),
    activeId: null,
    devicePref: 'cpu',
    load: 'idle',
    loadError: '',
    loadedId: null,
    modelId: null,
    device: null,
    tokensPerSecond: null,

    async init() {
      if (get().inited) return;
      writeQvacConfig();
      let activeId: ModelId | null = null;
      let devicePref: 'cpu' | 'gpu' = 'cpu';
      try {
        const raw = await AsyncStorage.getItem(PREF_KEY);
        const pref = raw ? (JSON.parse(raw) as { activeId?: string; device?: string }) : {};
        if (CATALOG.some(m => m.id === pref.activeId)) activeId = pref.activeId as ModelId;
        // Only a choice made with the switch counts: early builds saved GPU without asking, and on the S24 it
        // read prompts ten times slower than the CPU.
        if (pref.device === 'gpu' && (pref as { deviceChosen?: boolean }).deviceChosen) devicePref = 'gpu';
      } catch { /* none chosen */ }
      set({ inited: true, activeId, devicePref });
      log('init; ram', phoneRamGb().toFixed(1), 'GB; active', activeId);
      await get().refresh();
      // A chosen model that is no longer on the phone is not in use.
      if (activeId && get().files[activeId].state !== 'ready') { set({ activeId: null }); savePref(); }
    },

    async refresh(id) {
      for (const m of id ? [entryOf(id)] : CATALOG) {
        if (get().files[m.id].state === 'downloading') continue;
        try {
          const t0 = Date.now();
          log('getModelInfo…', m.id);
          const info = await withRecovery(() => getModelInfo({ name: m.descriptor.name } as never)) as unknown as {
            isCached: boolean; actualSize?: number; expectedSize: number; cacheFiles?: { path: string; isCached: boolean; actualSize?: number }[];
          };
          log('getModelInfo ok', m.id, Date.now() - t0, 'ms', info.isCached);
          const bytes = info.actualSize ?? info.cacheFiles?.reduce((s, f) => s + (f.actualSize ?? 0), 0) ?? 0;
          patch(m.id, {
            state: info.isCached ? 'ready' : bytes > 0 ? 'partial' : 'absent',
            bytes: info.isCached ? info.expectedSize : bytes, total: info.expectedSize || m.bytes,
            paths: info.cacheFiles?.map(f => f.path), error: undefined,
          });
        } catch (e) {
          log('getModelInfo failed', m.id, errText(e));
          patch(m.id, { state: 'absent' });
        }
      }
    },

    async download(id) {
      const m = entryOf(id);
      if (get().files[id].state === 'downloading') return;
      const startedAt = Date.now();
      patch(id, { state: 'downloading', startedAt, speed: 0, error: undefined });
      log('download start', id);
      // Progress arrives for every chunk, thousands of times a second on fast Wi-Fi. The screen is told at most
      // four times a second; anything more re-renders for nothing and starves the app.
      let lastAt = startedAt;
      let lastBytes = get().files[id].bytes;
      let lastPaint = 0;
      let latest = { done: lastBytes, total: m.bytes };
      const onProgress = (p: { downloaded?: number; total?: number; percentage?: number }) => {
        const total = p.total || m.bytes;
        latest = { done: p.downloaded ?? ((p.percentage ?? 0) / 100) * total, total };
        const now = Date.now();
        if (now - lastPaint < 250) return;
        lastPaint = now;
        const update: Partial<ModelFiles> = { bytes: latest.done, total };
        const dt = (now - lastAt) / 1000;
        if (dt >= 1) {
          const rate = Math.max(0, (latest.done - lastBytes) / dt);
          const prev = get().files[id].speed;
          update.speed = prev ? prev * 0.6 + rate * 0.4 : rate;
          lastAt = now; lastBytes = latest.done;
          if (Math.floor(now / 10_000) !== Math.floor((now - 1000) / 10_000)) log('progress', id, Math.round((latest.done / total) * 100), '%');
        }
        patch(id, update);
      };
      // The QVAC registry first; if it times out, the same file from Hugging Face (QVAC checks its checksum).
      const sources = [m.descriptor, httpSource(m)].filter(Boolean);
      try {
        let lastError: unknown = null;
        for (const [i, assetSrc] of sources.entries()) {
          if (i > 0) log('registry failed, trying', (assetSrc as { src: string }).src);
          try {
            await withRecovery(() => {
              const run = downloadAsset({ assetSrc, onProgress, requireHttpChecksum: true } as never) as Promise<string> & { requestId?: string };
              patch(id, { requestId: run.requestId });
              return run;
            });
            lastError = null;
            break;
          } catch (e) {
            lastError = e;
            if (/cancel/i.test(errText(e)) || !RETRYABLE.test(errText(e))) break;
          }
        }
        if (lastError) throw lastError;
        log('download done', id, Math.round((Date.now() - startedAt) / 1000), 's');
        patch(id, { state: 'ready', bytes: m.bytes, requestId: undefined, speed: 0 });
        await get().refresh(id);
        if (!get().activeId) { set({ activeId: id }); savePref(); }
      } catch (e) {
        const cancelled = /cancel/i.test(errText(e));
        log('download failed', id, errText(e));
        patch(id, { state: cancelled ? 'partial' : 'error', error: cancelled ? undefined : errText(e), requestId: undefined, speed: 0 });
        if (cancelled) await get().refresh(id);
      }
    },

    async cancelDownload(id) {
      const requestId = get().files[id].requestId;
      if (requestId) await cancel({ requestId } as never).catch(e => log('cancel failed', errText(e)));
      // Cancelling a download has left the worker unusable on the phone; start a clean one.
      await resetClient();
    },

    async remove(id) {
      if (get().loadedId === id) await get().unload();
      for (const p of get().files[id].paths ?? []) {
        try { const f = new File(p.startsWith('file://') ? p : `file://${p}`); if (f.exists) f.delete(); } catch (e) { log('delete failed', p, errText(e)); }
      }
      if (get().activeId === id) { set({ activeId: null }); savePref(); }
      await get().refresh(id);
      log('removed', id, get().files[id].state);
    },

    async setDevice(device) {
      if (get().devicePref === device) return;
      await get().unload();
      set({ devicePref: device, load: 'idle', loadError: '' });
      deviceChosen = true;
      savePref();
    },

    async use(id) {
      if (get().files[id].state !== 'ready') return;
      if (get().loadedId && get().loadedId !== id) await get().unload();
      set({ activeId: id, load: 'idle', loadError: '' });
      savePref();
    },

    ensureLoaded() {
      const { modelId, load, activeId, loadedId } = get();
      if (!activeId) return Promise.reject(new Error('No model is chosen.'));
      if (modelId && load === 'ready' && loadedId === activeId) return Promise.resolve(modelId);
      if (loading) return loading;
      loading = (async () => {
        set({ load: 'loading', loadError: '' });
        const m = entryOf(activeId);
        const tryLoad = (device: 'gpu' | 'cpu') => withRecovery(() => loadModel({
          modelSrc: m.descriptor,
          ...(httpSource(m) ? { fallbackSrc: (httpSource(m) as { src: string }).src } : null),
          modelConfig: { ctx_size: CTX_SIZE, tools: true, device, verbosity: VERBOSITY.ERROR },
        } as never) as Promise<string>);
        const t0 = Date.now();
        try {
          const first = get().devicePref;
          const other = first === 'cpu' ? 'gpu' : 'cpu';
          let device: 'gpu' | 'cpu' = first;
          let id: string;
          try { id = await tryLoad(first); } catch (e) { log(first, 'load failed, trying', other, errText(e)); device = other; id = await tryLoad(other); }
          log('loaded', activeId, 'on', device, 'in', Date.now() - t0, 'ms');
          set({ load: 'ready', modelId: id, loadedId: activeId, device });
          return id;
        } catch (e) {
          log('load failed', activeId, errText(e));
          set({ load: 'error', loadError: errText(e) });
          throw e;
        } finally {
          loading = null;
        }
      })();
      return loading;
    },

    async unload() {
      const { modelId } = get();
      set({ modelId: null, loadedId: null, load: 'idle', device: null });
      if (modelId) await unloadModel({ modelId, clearStorage: false } as never).catch(() => {});
    },
  };
});

// ── the agent's door ───────────────────────────────────────────────────────

type QvacEvent = { type: string; [k: string]: unknown };

export const qvacLlm: LlmClient = {
  async *chat(messages: ChatMessage[], options: ChatOptions = {}): AsyncIterable<LlmEvent> {
    const modelId = await useModel.getState().ensureLoaded();
    const useTools = options.toolChoice !== 'none' && !!options.tools?.length;
    const run = completion({
      modelId,
      stream: true,
      history: messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.toolCalls ? { toolCalls: m.toolCalls.map(c => ({ id: c.id, name: c.name, arguments: c.arguments })) } : null),
        ...(m.toolCallId ? { toolCallId: m.toolCallId, toolName: m.toolName } : null),
      })),
      ...(useTools ? { tools: options.tools!.map(t => ({ type: 'function' as const, name: t.name, description: t.description, parameters: t.parameters })) } : null),
      generationParams: {
        ...(options.temperature !== undefined ? { temp: options.temperature } : null),
        ...(options.maxTokens ? { predict: options.maxTokens } : null),
        // Qwen3 thinks before answering unless told not to; a tool call needs no thinking.
        reasoning_budget: 0,
        ...(useTools ? { tool_choice: options.toolChoice ?? 'auto', parallel_tool_calls: false } : null),
      },
    } as never) as unknown as { events: AsyncIterable<QvacEvent>; requestId?: string };

    const onAbort = () => { if (run.requestId) cancel({ requestId: run.requestId } as never).catch(() => {}); };
    options.signal?.addEventListener('abort', onAbort);
    try {
      for await (const ev of run.events) {
        if (ev.type === 'contentDelta') yield { type: 'text', delta: String(ev.text ?? '') };
        else if (ev.type === 'toolCall') yield { type: 'toolCall', call: ev.call as { id: string; name: string; arguments: Record<string, unknown> } };
        else if (ev.type === 'toolError') {
          const err = ev.error as { message?: string } | undefined;
          log('tool error', err?.message);
          yield { type: 'toolError', message: err?.message ?? 'tool error' };
        } else if (ev.type === 'completionStats') {
          const stats = ev.stats as { tokensPerSecond?: number } | undefined;
          log('stats', JSON.stringify(stats));
          if (stats?.tokensPerSecond) useModel.setState({ tokensPerSecond: stats.tokensPerSecond });
        }
      }
      yield { type: 'done' };
    } catch (e) {
      if (BROKEN.test(errText(e))) await resetClient();
      throw e;
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
    }
  },
};
