import type { ClientMsg, ServerMsg } from './protocol.ts';

export interface SignalOptions {
  hello: () => ClientMsg;
  onMessage: (msg: ServerMsg) => void;
  onStatus?: (connected: boolean) => void;
}

/** WebSocket to the StageCam server that re-sends `hello` and reconnects until stopped. */
export class Signal {
  #ws: WebSocket | null = null;
  #stopped = false;
  #options: SignalOptions;

  constructor(options: SignalOptions) {
    this.#options = options;
  }

  connect(): void {
    this.#stopped = false;
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${location.host}/ws`);
    this.#ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify(this.#options.hello()));
      this.#options.onStatus?.(true);
    };
    ws.onmessage = (event) => this.#options.onMessage(JSON.parse(String(event.data)) as ServerMsg);
    ws.onclose = (event) => {
      if (this.#ws !== ws) return;
      this.#ws = null;
      this.#options.onStatus?.(false);
      if (!this.#stopped && event.code !== 4000 && event.code !== 4001 && event.code !== 4003) {
        setTimeout(() => this.connect(), 1000);
      }
    };
  }

  send(msg: ClientMsg): void {
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify(msg));
  }

  stop(): void {
    this.#stopped = true;
    this.#ws?.close();
    this.#ws = null;
  }
}
