type FileUrl = { fileID?: string; fileId?: string; tempFileURL?: string };

/** Coalesce image reads and briefly reuse successful signed URLs. */
export class TempFileUrls {
  private cache = new Map<string, { url: string; expires: number }>();
  private waiting = new Map<string, { promise: Promise<string>; resolve: (url: string) => void; reject: (error: unknown) => void }>();
  private queued = new Set<string>();
  private running = false;

  constructor(private fetchUrls: (ids: string[]) => Promise<FileUrl[]>, private now = Date.now) {}

  get(id: string): Promise<string> {
    const cached = this.cache.get(id);
    if (cached && cached.expires > this.now()) return Promise.resolve(cached.url);
    this.cache.delete(id);
    const pending = this.waiting.get(id);
    if (pending) return pending.promise;
    let resolve!: (url: string) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<string>((done, fail) => { resolve = done; reject = fail; });
    this.waiting.set(id, { promise, resolve, reject });
    this.queued.add(id);
    void Promise.resolve().then(() => this.flush());
    return promise;
  }

  private async flush() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queued.size) {
        const ids = [...this.queued].slice(0, 50);
        ids.forEach((id) => this.queued.delete(id));
        try {
          const files = await this.fetchUrls(ids);
          if (!Array.isArray(files)) throw new Error('图片链接响应无效，请重试');
          for (const id of ids) {
            const pending = this.waiting.get(id)!;
            const url = files.find((file) => file && (file.fileID || file.fileId) === id)?.tempFileURL;
            this.waiting.delete(id);
            if (url && /^https?:\/\//i.test(url)) {
              this.cache.set(id, { url, expires: this.now() + 5 * 60 * 1000 });
              if (this.cache.size > 512) this.cache.delete(this.cache.keys().next().value!);
              pending.resolve(url);
            } else pending.reject(new Error('图片链接获取失败，请重试'));
          }
        } catch (error) {
          for (const id of ids) {
            this.waiting.get(id)?.reject(error);
            this.waiting.delete(id);
          }
        }
      }
    } finally { this.running = false; }
  }
}
