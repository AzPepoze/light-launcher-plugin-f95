/** `sessionId` is set for events from an attached tab (flattened sessions). */
type Listener = (params: any, sessionId?: string) => void;

interface SendOptions {
  timeoutMs?: number;
  /** route the command to one attached tab instead of the browser */
  sessionId?: string;
}

interface Pending {
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Tiny Chrome DevTools Protocol client over Bun's WebSocket. */
export class CdpClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Map<string, Set<Listener>>();
  private open = true;

  private constructor(private readonly ws: WebSocket) {
    ws.onmessage = (event) => {
      let message: any;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message ?? 'CDP error'));
        else pending.resolve(message.result);
        return;
      }
      if (message.method) {
        for (const listener of this.listeners.get(message.method) ?? []) {
          listener(message.params ?? {}, message.sessionId);
        }
      }
    };
    ws.onclose = () => {
      this.open = false;
      for (const [, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error('browser window closed'));
      }
      this.pending.clear();
      for (const listener of this.listeners.get('__closed') ?? []) listener({});
    };
  }

  static async connect(url: string): Promise<CdpClient> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out connecting to the browser')), 10_000);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('could not connect to the browser debug port'));
      };
    });
    return new CdpClient(ws);
  }

  get isOpen(): boolean {
    return this.open;
  }

  send<T = any>(method: string, params: Record<string, unknown> = {}, options: SendOptions = {}): Promise<T> {
    if (!this.open) return Promise.reject(new Error('browser window closed'));
    const id = this.nextId++;
    const timeoutMs = options.timeoutMs ?? 30_000;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ id, method, params, sessionId: options.sessionId }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  on(method: string, listener: Listener): () => void {
    const set = this.listeners.get(method) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(method, set);
    return () => set.delete(listener);
  }

  close(): void {
    this.open = false;
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}
