/** Cache development-server images as temporary files, never as HTTP image sources. */
export class LocalImageFiles {
  private files = new Map<string, Promise<string>>();
  private queued: Array<() => void> = [];
  private active = 0;

  private drain() {
    while (this.active < 4 && this.queued.length) this.queued.shift()!();
  }

  get(url: string): Promise<string> {
    const cached = this.files.get(url);
    if (cached) return cached;
    const task = new Promise<string>((resolve, reject) => {
      this.queued.push(() => {
        this.active++;
        const complete = () => { this.active--; this.drain(); };
        try {
          wx.downloadFile({
            url,
            success(result) {
              if (result.statusCode === 200 && result.tempFilePath) resolve(result.tempFilePath);
              else reject(new Error('本地图片下载失败，请重试'));
            },
            fail: reject,
            complete,
          });
        } catch (error) { complete(); reject(error); }
      });
      this.drain();
    }).catch((error) => { this.files.delete(url); throw error; });
    this.files.set(url, task);
    // Bound bookkeeping; WeChat owns and expires the downloaded temporary files.
    if (this.files.size > 128) this.files.delete(this.files.keys().next().value!);
    return task;
  }
}
