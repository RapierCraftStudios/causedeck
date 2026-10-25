// TEMPORARY (diag/e2e-556, do not merge): event-loop and Postgres-connect instrumentation, active
// only when E2E_DIAG=1. Output goes to stdout with a `[diag]` prefix; the harness timestamps lines.
import { monitorEventLoopDelay } from 'node:perf_hooks';
import os from 'node:os';
import net from 'node:net';

const iso = () => new Date().toISOString();

export function startE2eDiag(): void {
  const port = process.env.PORT ?? '?';
  const log = (msg: string) => console.log(`[diag] ${iso()} pid=${String(process.pid)} port=${port} ${msg}`);
  log('diag start');

  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();
  let lastCpu = process.cpuUsage();
  setInterval(() => {
    const cpu = process.cpuUsage(lastCpu);
    lastCpu = process.cpuUsage();
    const [l1] = os.loadavg();
    log(
      `loop p50=${(h.percentile(50) / 1e6).toFixed(1)}ms p99=${(h.percentile(99) / 1e6).toFixed(1)}ms max=${(h.max / 1e6).toFixed(1)}ms ` +
        `cpu_user=${(cpu.user / 1000).toFixed(0)}ms cpu_sys=${(cpu.system / 1000).toFixed(0)}ms load1=${String(l1)} rss=${String(Math.round(process.memoryUsage().rss / 1e6))}MB`,
    );
    h.reset();
  }, 5000).unref();

  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    const stall = now - last - 100;
    if (stall > 1000) log(`STALL ${String(stall)}ms (loop blocked, ended now)`);
    last = now;
  }, 100).unref();

  const origConnect = net.Socket.prototype.connect as (...a: unknown[]) => net.Socket;
  let seq = 0;
  net.Socket.prototype.connect = function patched(this: net.Socket, ...args: unknown[]) {
    const first = args[0];
    const p = typeof first === 'object' && first !== null ? (first as { port?: number }).port : first;
    if (Number(p) === 5432) {
      const id = ++seq;
      const t0 = Date.now();
      log(`pg#${String(id)} connect start`);
      let gotData = false;
      this.once('connect', () => log(`pg#${String(id)} tcp connected +${String(Date.now() - t0)}ms`));
      this.on('data', () => {
        if (!gotData) {
          gotData = true;
          log(`pg#${String(id)} first data +${String(Date.now() - t0)}ms`);
        }
      });
      this.once('error', (e: Error) => log(`pg#${String(id)} error ${e.message} +${String(Date.now() - t0)}ms`));
      this.once('close', () => log(`pg#${String(id)} close +${String(Date.now() - t0)}ms`));
    }
    return origConnect.apply(this, args);
  } as typeof net.Socket.prototype.connect;
}
