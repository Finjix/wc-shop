import { useEffect, useId, useRef, useState, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
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
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const anchor = open ? trigger.current?.getBoundingClientRect() : undefined;
  const openAbove = !!anchor && window.innerHeight - anchor.bottom < 280 && anchor.top > 280;
  const filtered = options.filter(item => String(item.label).toLowerCase().includes(query.trim().toLowerCase()));
  const selected = options.find(item => String(item.value) === String(value));
  const close = () => { setOpen(false); setQuery(''); setActive(0); };
  const choose = (next: string | number) => { onChange(String(next)); close(); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    search.current?.focus({ preventScroll: true });
    const reposition = () => close();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', reposition);
    const scroller = root.current?.closest('.t-dialog__body');
    scroller?.addEventListener('scroll', reposition);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', reposition);
      scroller?.removeEventListener('scroll', reposition);
    };
  }, [open]);
  useEffect(() => { if (disabled) close(); }, [disabled]);
  useEffect(() => {
    if (open) {
      const option = document.getElementById(`${listId}-${active}`);
      const list = option?.parentElement;
      if (option && list) {
        if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
        else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
      }
    }
  }, [active, open, listId]);
  if (!filterable) return <div className="native-select"><select disabled={disabled} value={value ?? ''} onChange={e => onChange(e.target.value)}><option value="">{placeholder || '请选择'}</option>{options.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>;
  return <div className="native-select native-select--searchable" ref={root}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) close(); }}
    onKeyDown={event => {
      if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); trigger.current?.focus(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!open) { setActive(0); setOpen(true); }
        else setActive(old => Math.max(0, Math.min(filtered.length - 1, old + (event.key === 'ArrowDown' ? 1 : -1))));
      }
      if (event.key === 'Enter' && open) { event.preventDefault(); if (filtered[active]) choose(filtered[active].value); }
    }}>
    <button ref={trigger} type="button" role="combobox" className="native-select-trigger" disabled={disabled}
      aria-expanded={open} aria-controls={listId} aria-haspopup="listbox"
      onClick={() => { if (open) close(); else { setActive(0); setOpen(true); } }}>
      <span>{selected?.label ?? placeholder ?? '请选择'}</span><span aria-hidden="true">⌄</span>
    </button>
    {open && <div className="native-select-menu" style={anchor ? { position: 'fixed', left: anchor.left, right: 'auto', width: anchor.width, boxSizing: 'border-box', top: openAbove ? 'auto' : anchor.bottom + 4, bottom: openAbove ? window.innerHeight - anchor.top + 4 : 'auto' } : undefined}>
      <input ref={search} className="native-input" aria-label="筛选选项" placeholder="输入名称筛选"
        role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls={listId}
        aria-activedescendant={filtered[active] ? `${listId}-${active}` : undefined}
        value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} />
      <div id={listId} role="listbox" className="native-select-options">
        {filtered.map((item, index) => <button key={item.value} id={`${listId}-${index}`} type="button" role="option"
          aria-selected={String(item.value) === String(value)} className={index === active ? 'active' : ''}
          onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(item.value)}>{item.label}</button>)}
        {!filtered.length && <div className="native-select-empty" role="status">暂无匹配的快递公司</div>}
      </div>
    </div>}
  </div>;
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
