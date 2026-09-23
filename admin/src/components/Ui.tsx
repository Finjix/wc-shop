import { useRef, useState, type ReactNode } from 'react';
import { Button, Loading } from 'tdesign-react';

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{children}</section>;
}

export function EmptyState({ title, action }: { title?: string; description?: string; action?: ReactNode }) {
  return <div className="empty-state">{title && <strong>{title}</strong>}{action}</div>;
}

export function LoadingState() {
  return <div className="loading-state"><Loading size="small" /> 读取中…</div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="error-state"><strong>请求失败</strong><span>{message}</span>{onRetry && <Button size="small" onClick={onRetry}>重试</Button>}</div>;
}

export function Field({ label, children, hint, fileUpload = false }: { label: string; children: ReactNode; hint?: string; fileUpload?: boolean }) {
  const content = <><span>{label}</span>{children}{hint && <small>{hint}</small>}</>;
  return fileUpload
    ? <div className="field" role="group" aria-label={label}>{content}</div>
    : <label className="field">{content}</label>;
}

export function ImageFilePicker({ onSelect, disabled = false }: { onSelect: (file: File) => void; disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('未选择文件');
  return <div className="image-file-picker">
    <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()}>选择文件</button>
    <span>{fileName}</span>
    <input ref={inputRef} className="image-file-picker-input" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" disabled={disabled} tabIndex={-1}
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) { setFileName(file.name); onSelect(file); }
      }} />
  </div>;
}

export function Table({ children, minWidth = 760 }: { children: ReactNode; minWidth?: number }) {
  return <div className="table-scroll"><table style={{ minWidth }}>{children}</table></div>;
}

export function EmptyTable({ colSpan }: { colSpan: number }) {
  return <tr><td colSpan={colSpan}><EmptyState /></td></tr>;
}

export function formatMoney(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return '—';
  return `¥${(number / 100).toFixed(2)}`;
}

export function formatDate(value: unknown) {
  if (!value) return '—';
  const date = new Date(typeof value === 'number' || /^\d+$/.test(String(value)) ? Number(value) : String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
}

export function readList<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['items', 'list', 'rows', 'records', 'data']) {
      if (Array.isArray(record[key])) return record[key] as T[];
    }
  }
  return [];
}

export function readTotal(value: unknown, fallback: number) {
  if (value && typeof value === 'object') {
    const total = (value as Record<string, unknown>).total;
    if (typeof total === 'number') return total;
  }
  return fallback;
}
