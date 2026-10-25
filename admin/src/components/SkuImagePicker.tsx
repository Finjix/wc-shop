import { useEffect, useRef, useState } from 'react';
import { adminApi } from '../lib/api';
import { IMAGE_ACCEPT } from '../lib/image-upload';

function storedFileName(fileID: string) {
  if (fileID.startsWith('blob:') || fileID.startsWith('data:')) return '图片文件';
  try {
    const url = /^https?:/i.test(fileID) ? new URL(fileID) : null;
    const path = url?.searchParams.get('fileID') || url?.pathname || fileID;
    return decodeURIComponent(path.split('/').pop() || '图片文件');
  } catch { return '图片文件'; }
}

export function SkuImagePicker({ fileID, disabled, onSelect }: {
  fileID: string;
  disabled: boolean;
  onSelect: (file: File) => Promise<string | undefined>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<{ fileID: string; name: string } | null>(null);
  const [resolved, setResolved] = useState<{ fileID: string; url: string } | null>(null);
  const directUrl = /^(https?:|blob:|data:)/i.test(fileID) ? fileID : '';
  const imageUrl = directUrl || (resolved?.fileID === fileID ? resolved.url : '');
  const fileName = selectedFile?.fileID === fileID ? selectedFile.name : storedFileName(fileID);
  useEffect(() => {
    let active = true;
    if (/^(cloud|local):\/\//i.test(fileID)) {
      void adminApi.getTempFileUrl(fileID).then((url) => { if (active) setResolved({ fileID, url }); }).catch(() => { if (active) setResolved({ fileID, url: '' }); });
    }
    return () => { active = false; };
  }, [fileID]);
  return <div className="sku-image-picker image-file-picker">
    <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()}>选择文件</button>
    {fileID ? <button type="button" className="sku-image-filename" disabled={disabled || !imageUrl} data-image-preview={imageUrl} data-image-alt={fileName} title={imageUrl ? '点击预览大图' : '图片暂不可预览'}>{fileName}</button> : <span>未选择文件</span>}
    <input ref={inputRef} className="image-file-picker-input" type="file" accept={IMAGE_ACCEPT} disabled={disabled} aria-label="选择 SKU 图片" onChange={(event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) void onSelect(file).then((nextFileID) => { if (nextFileID) setSelectedFile({ fileID: nextFileID, name: file.name }); });
    }} />
  </div>;
}
