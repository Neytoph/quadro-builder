import { placementMemo, placementCached, placementBounds } from './incrementalPlacement.js';

// 后台计算受影响的候选；等待期间保留已经确认不受变更影响的安装点。
export class PanelMountQueue {
  constructor(onReady, onError) {
    this.onReady = onReady;
    this.onError = onError;
    this.results = new Map();
    this.partial = new Map();
    this.requestId = 0;
  }

  /** @param {import('./model.js').BuildModel|null} [model] */
  get(data, panelId, options, model = null) {
    if (this.disposed) return null;
    const snapshot = JSON.stringify(data);
    if (snapshot !== this.snapshot) {
      this.snapshot = snapshot;
      for(const [key,mounts] of this.results)this.partial.set(key,mounts);
      for(const [key,mounts] of this.partial){
        const kept=model?mounts.filter(m=>placementCached(model,'worker-mount:'+key+':'+JSON.stringify(m))):[];
        if(kept.length)this.partial.set(key,kept);else this.partial.delete(key);
      }
      while(this.partial.size>8)this.partial.delete(this.partial.keys().next().value);
      this.results.clear();
      this.failedKey = null;
    }
    const key = JSON.stringify([panelId, options]);
    this.requested = { snapshot, key };
    if (this.results.has(key)) {
      this.waiting = null;
      const mounts=this.results.get(key);
      if(model)for(const mount of mounts)placementMemo(model,'worker-mount:'+key+':'+JSON.stringify(mount),
        ()=>({bounds:placementBounds(model,mount),ids:new Set([mount.a,mount.b,...(mount.supportTubes||[])].filter(Boolean))}),()=>true);
      return mounts;
    }
    if (this.failedKey === key) return null;
    if (this.running?.snapshot !== snapshot || this.running?.key !== key) {
      this.waiting = { snapshot, key, model: structuredClone(data), panelId, options: { ...options } };
      this.start();
    } else this.waiting = null;
    return this.partial.get(key)?.length ? this.partial.get(key) : null;
  }

  start() {
    if (this.running || !this.waiting || this.disposed) return;
    const job = this.waiting;
    this.waiting = null;
    this.running = { ...job, requestId: ++this.requestId };
    try {
      if (!this.worker) {
        const worker = new Worker(new URL('./panelMounts.worker.js', import.meta.url), { type: 'module' });
        this.worker = worker;
        worker.addEventListener('message', event => { if (this.worker === worker) this.complete(event.data); });
        worker.addEventListener('error', event => { if (this.worker === worker) this.fail(new Error(event.message)); });
        worker.addEventListener('messageerror', () => { if (this.worker === worker) this.fail(new Error('Panel mount response could not be decoded')); });
      }
      this.timer = setTimeout(() => this.fail(new Error('Panel mount computation timed out')), 30_000);
      this.worker.postMessage({ type: 'compute', requestId: this.running.requestId, model: job.model, panelId: job.panelId, options: job.options });
    } catch (error) {
      this.fail(error);
    }
  }

  complete(message) {
    if (this.disposed || !this.running || message.requestId !== this.running.requestId) return;
    if (message.type === 'error') { this.fail(new Error(message.error)); return; }
    if (message.type !== 'result' || !Array.isArray(message.mounts)) {
      this.fail(new Error('Invalid panel mount response')); return;
    }
    const job = this.running;
    clearTimeout(this.timer);
    this.running = null;
    if (job.snapshot === this.snapshot) {
      this.results.set(job.key, message.mounts);
      this.partial.delete(job.key);
      if (this.results.size > 8) this.results.delete(this.results.keys().next().value);
    }
    if (this.requested?.snapshot === job.snapshot && this.requested.key === job.key) this.onReady();
    this.start();
  }

  fail(error) {
    if (this.disposed) return;
    const job = this.running;
    clearTimeout(this.timer);
    this.worker?.terminate();
    this.worker = null;
    this.running = null;
    if (job && this.requested?.snapshot === job.snapshot && this.requested.key === job.key) {
      this.failedKey = job.key;
      this.onError(error);
    }
    this.start();
  }

  cancel() {
    this.requested = null;
    this.waiting = null;
  }

  retry() { this.failedKey = null; }

  dispose() {
    this.disposed = true;
    this.cancel();
    clearTimeout(this.timer);
    this.worker?.terminate();
    this.worker = null;
    this.running = null;
    this.results.clear();
    this.partial.clear();
  }
}
