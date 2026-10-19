const processor = require('./processor');
Component({
  lifetimes: {
    attached() { this.prepared = new Map(); this.closed = false; },
    detached() {
      this.closed = true;
      for (const path of this.prepared.keys()) wx.getFileSystemManager().unlink({ filePath: path, fail() {} });
      this.prepared.clear();
    },
  },
  methods: {
    async prepare(files, quality, max = 4) {
      const result = [];
      const errors = [];
      for (const file of files.slice(0, max)) {
        const path = file.url || file.tempFilePath || file.path;
        if (this.prepared.has(path)) { result.push(this.prepared.get(path)); continue; }
        try {
          const prepared = await processor.prepare(file, quality);
          if (this.closed) {
            wx.getFileSystemManager().unlink({ filePath: prepared.url, fail() {} });
            throw new Error('页面已关闭');
          }
          this.prepared.set(prepared.url, prepared);
          result.push(prepared);
        } catch (error) { errors.push(error.message || '图片处理失败'); }
      }
      return { files: result, error: errors[0] };
    },
  },
});
