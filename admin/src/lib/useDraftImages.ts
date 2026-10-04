import { useEffect, useMemo, useState } from 'react';
import { adminApi } from './api';
import { prepareImageUpload } from './image-upload';
import { DraftImages } from './draft-images';

export function useDraftImages(folder: string) {
  const [processing, setProcessing] = useState(0);
  const images = useMemo(() => new DraftImages({
    prepare: prepareImageUpload,
    upload: (file) => adminApi.uploadPrepared(file, folder),
    cleanup: (fileList) => adminApi.call('storage.cleanup', { fileList }),
    createUrl: (file) => URL.createObjectURL(file),
    revokeUrl: (url) => URL.revokeObjectURL(url),
  }), [folder]);
  useEffect(() => { images.activate(); return () => images.dispose(); }, [images]);
  return { images, processing: processing > 0, select: async (file: File) => {
    setProcessing((count) => count + 1);
    try { return await images.select(file); }
    finally { setProcessing((count) => count - 1); }
  } };
}
