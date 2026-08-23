import type { ReactNode } from 'react';
import { Button, Loading } from 'tdesign-react';

export function PageIntro({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="page-intro"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>;
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{children}</section>;
}

export function EmptyState({ title = '暂无数据', description = '云端数据库当前为空，创建数据后会显示在这里。', action }: { title?: string; description?: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">○</div><strong>{title}</strong><span>{description}</span>{action}</div>;
}

export function LoadingState() {
  return <div className="loading-state"><Loading size="small" /> 正在从 CloudBase 读取...</div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="error-state"><strong>请求失败</strong><span>{message}</span>{onRetry && <Button size="small" onClick={onRetry}>重试</Button>}</div>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function Table({ children, minWidth = 760 }: { children: ReactNode; minWidth?: number }) {
  return <div className="table-scroll"><table style={{ minWidth }}>{children}</table></div>;
}

export function EmptyTable({ colSpan, children = '暂无云端数据' }: { colSpan: number; children?: ReactNode }) {
  return <tr><td colSpan={colSpan}><EmptyState title={String(children)} /></td></tr>;
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
