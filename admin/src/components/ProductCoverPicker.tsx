import { useRef, type ReactNode } from 'react';
import { Button } from 'tdesign-react';
import { IMAGE_ACCEPT } from '../lib/image-upload';

export function ProductCoverPicker({ images, disabled, onSelect, onChange, renderImage }: {
  images: string[];
  disabled: boolean;
  onSelect: (files: File[], replaceIndex?: number) => void;
  onChange: (images: string[]) => void;
  renderImage: (fileID: string, alt: string) => ReactNode;
}) {
  const addInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceIndex = useRef(0);
  return <div className="product-cover-field" role="group" aria-label="封面图片">
    <div className="product-cover-heading"><strong>封面图片（1:1）</strong></div>
    <div className="image-file-picker">
      <button type="button" disabled={disabled || images.length >= 2} onClick={() => addInput.current?.click()}>选择文件</button>
      <span>{images.length ? `已上传 ${images.length}/2 张` : '未选择文件'}</span>
    </div>
    <input ref={addInput} className="image-file-picker-input" type="file" accept={IMAGE_ACCEPT} multiple disabled={disabled || images.length >= 2} aria-label="添加封面图片" onChange={(event) => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      onSelect(files);
    }} />
    <input ref={replaceInput} className="image-file-picker-input" type="file" accept={IMAGE_ACCEPT} disabled={disabled} aria-label="更换封面图片" onChange={(event) => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      onSelect(files, replaceIndex.current);
    }} />
    <div className="product-cover-list">{images.map((fileID, index) => <div className="product-cover-card" key={index}>
      <div className="product-cover-preview">{renderImage(fileID, index === 0 ? '商品主封面预览' : '商品副封面预览')}</div>
      <div className="product-cover-actions">
        <span>{index === 0 ? '主封面' : '副封面'}</span>
        <div><Button variant="text" disabled={disabled} onClick={() => { replaceIndex.current = index; replaceInput.current?.click(); }}>更换</Button><Button variant="text" disabled={disabled} onClick={() => onChange(images.filter((_, position) => position !== index))}>删除</Button></div>
      </div>
    </div>)}</div>
  </div>;
}
