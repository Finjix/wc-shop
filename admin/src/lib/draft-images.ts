export class DraftImages {
  private entries = new Map<string, { file: File; uploaded?: string }>();
  private disposed = false;
  private generation = 0;

  constructor(private deps: {
    prepare: (file: File) => Promise<File>;
    upload: (file: File) => Promise<string>;
    cleanup: (ids: string[]) => Promise<unknown>;
    createUrl: (file: File) => string;
    revokeUrl: (url: string) => void;
  }) {}

  async select(file: File) {
    const generation = this.generation;
    const prepared = await this.deps.prepare(file);
    if (this.disposed || generation !== this.generation) throw new Error('编辑页面已关闭');
    const url = this.deps.createUrl(prepared);
    this.entries.set(url, { file: prepared });
    return url;
  }

  async upload<T>(value: T): Promise<T> {
    const generation = this.generation;
    const walk = async (item: unknown): Promise<unknown> => {
      if (typeof item === 'string') {
        const entry = this.entries.get(item);
        if (!entry) {
          if (item.startsWith('blob:')) throw new Error('图片草稿已失效，请重新选择');
          return item;
        }
        if (!entry.uploaded) entry.uploaded = await this.deps.upload(entry.file);
        if (this.disposed || generation !== this.generation) {
          await this.deps.cleanup([entry.uploaded]).catch(() => undefined);
          throw new Error('编辑页面已关闭');
        }
        return entry.uploaded;
      }
      if (Array.isArray(item)) {
        const result = [];
        for (const child of item) result.push(await walk(child));
        return result;
      }
      if (item && typeof item === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(item)) result[key] = await walk(child);
        return result;
      }
      return item;
    };
    return await walk(value) as T;
  }

  commit(value: unknown) {
    const saved = JSON.stringify(value);
    for (const entry of this.entries.values()) {
      if (entry.uploaded && saved.includes(JSON.stringify(entry.uploaded))) entry.uploaded = undefined;
    }
    void this.discard();
  }

  // A timed-out save may have committed. Server cleanup rechecks references.
  async discard() {
    this.generation++;
    const ids = [...new Set([...this.entries.values()].flatMap((entry) => entry.uploaded ? [entry.uploaded] : []))];
    for (const url of this.entries.keys()) this.deps.revokeUrl(url);
    this.entries.clear();
    for (let offset = 0; offset < ids.length; offset += 5) {
      await this.deps.cleanup(ids.slice(offset, offset + 5)).catch(() => undefined);
    }
  }

  dispose() { this.disposed = true; void this.discard(); }
  activate() { this.disposed = false; }
}
