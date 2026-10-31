import { useEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import './native-ui.css';

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'size'> & { size?: string; theme?: string; variant?: string; loading?: boolean; icon?: ReactNode };
export function Button({ size, theme, variant, loading, icon, children, className = '', disabled, ...props }: ButtonProps) {
  return <button {...props} type={props.type || 'button'} disabled={disabled || loading} aria-busy={loading || undefined} className={`t-button native-button ${theme || ''} ${variant || ''} ${size || ''} ${className}`}>{loading ? <span aria-hidden="true">◌ </span> : icon}{children}</button>;
}
type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'size' | 'value' | 'onEnter'> & { value?: string | number; size?: string; autofocus?: boolean; maxlength?: number; showLimitNumber?: boolean; onChange?: (value: string) => void; onEnter?: (value: string, context: { e: React.KeyboardEvent<HTMLInputElement> }) => void };
export function Input({ value = '', onChange, onEnter, maxlength, showLimitNumber, autofocus, size, className = '', ...props }: InputProps) {
  return <input {...props} autoFocus={autofocus ?? props.autoFocus} className={`t-input native-input ${className}`} value={value} maxLength={maxlength ?? props.maxLength} onChange={e => onChange?.(e.target.value)} onKeyDown={e => { props.onKeyDown?.(e); if (e.key === 'Enter') onEnter?.(e.currentTarget.value, { e }); }} />;
}
type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> & { onChange?: (value: string) => void; autosize?: { minRows: number; maxRows: number } };
export function Textarea({ onChange, autosize, ...props }: TextareaProps) { return <textarea {...props} rows={autosize?.minRows || props.rows} onChange={e => onChange?.(e.target.value)} />; }
export function Tag({ children, theme, variant, style, className = '' }: { children?: ReactNode; theme?: string; variant?: string; className?: string; style?: React.CSSProperties }) { return <span style={style} className={`t-tag native-tag ${theme || ''} ${className}`}>{children}</span>; }
export function Select({ value, options, placeholder, onChange, disabled, filterable }: { value?: string | number; options: { value: string | number; label: ReactNode }[]; placeholder?: string; disabled?: boolean; filterable?: boolean; onChange: (value: string) => void }) {
  const [query, setQuery] = useState('');
  const filtered = options.filter(item => !query || String(item.label).toLowerCase().includes(query.toLowerCase()) || item.value === value);
  return <div className="native-select">{filterable && <input aria-label="筛选选项" placeholder="输入名称筛选" disabled={disabled} value={query} onChange={e => setQuery(e.target.value)} />}<select disabled={disabled} value={value ?? ''} onChange={e => onChange(e.target.value)}><option value="">{placeholder || '请选择'}</option>{filtered.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>;
}
type Action = string | null | { content?: ReactNode; disabled?: boolean; loading?: boolean };
type DialogProps = { visible?: boolean; header?: ReactNode; children?: ReactNode; className?: string; closeBtn?: boolean; closeOnOverlayClick?: boolean; confirmBtn?: Action; cancelBtn?: Action; width?: string | number; placement?: string; onClose?: () => void; onConfirm?: () => void };
export function Dialog({ visible, header, children, className = '', closeBtn = true, closeOnOverlayClick = true, confirmBtn = '确定', cancelBtn = '取消', width, onClose, onConfirm }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = ref.current; if (visible && element && !element.open) element.showModal(); if (!visible) element?.close(); return () => { element?.close(); }; }, [visible]);
  const action = (item: Action | undefined, confirm: boolean) => item == null ? null : <Button theme={confirm ? 'primary' : undefined} disabled={typeof item === 'object' && item.disabled} loading={typeof item === 'object' && item.loading} onClick={confirm ? onConfirm : onClose}>{typeof item === 'string' ? item : item.content}</Button>;
  return createPortal(<dialog ref={ref} className={`t-dialog native-dialog ${className}`} style={{ width }} aria-label={typeof header === 'string' ? header : '确认操作'} onCancel={e => { e.preventDefault(); onClose?.(); }} onClick={e => { if (e.target === e.currentTarget && closeOnOverlayClick) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose?.(); } }}><div className="t-dialog__header">{header}{closeBtn && <button type="button" aria-label="关闭" onClick={onClose}>×</button>}</div><div className="t-dialog__body">{children}</div><div className="t-dialog__footer">{action(confirmBtn, true)}{action(cancelBtn, false)}</div></dialog>, document.body);
}
const showMessage = (kind: string, message: string) => { window.dispatchEvent(new CustomEvent('shop-message', { detail: { kind, message, id: Date.now() + Math.random() } })); return Promise.resolve(); };
export const MessagePlugin = { success: (message: string) => showMessage('success', message), error: (message: string) => showMessage('error', message), warning: (message: string) => showMessage('warning', message), info: (message: string) => showMessage('info', message) };
export function MessageHost() {
  const [messages, setMessages] = useState<{ id: number; kind: string; message: string }[]>([]);
  useEffect(() => { const timers = new Set<ReturnType<typeof setTimeout>>(); const receive = (event: Event) => { const item = (event as CustomEvent).detail; setMessages(old => [...old.slice(-3), item]); const timer = setTimeout(() => { setMessages(old => old.filter(row => row.id !== item.id)); timers.delete(timer); }, 3500); timers.add(timer); }; window.addEventListener('shop-message', receive); return () => { window.removeEventListener('shop-message', receive); timers.forEach(clearTimeout); }; }, []);
  return createPortal(<div className="native-messages" aria-live="polite">{messages.map(item => <div key={item.id} role={item.kind === 'error' ? 'alert' : 'status'} className={item.kind}>{item.message}</div>)}</div>, document.body);
}
