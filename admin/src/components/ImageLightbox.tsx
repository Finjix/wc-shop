import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function ImageLightbox() {
  const [image, setImage] = useState<{ src: string; alt: string } | null>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const moved = useRef(false);
  const stage = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const reset = () => setView({ scale: 1, x: 0, y: 0 });

  useEffect(() => {
    const open = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement) || target.closest('.image-lightbox')) return;
      if (!target.currentSrc || !target.naturalWidth) return;
      event.preventDefault();
      event.stopPropagation();
      reset();
      setImage({ src: target.currentSrc, alt: target.alt || '图片预览' });
    };
    document.addEventListener('click', open, true);
    return () => document.removeEventListener('click', open, true);
  }, []);

  useEffect(() => {
    if (!image) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setImage(null);
      if (event.key === 'Tab') {
        const buttons = stage.current?.parentElement?.querySelectorAll<HTMLButtonElement>('button');
        if (!buttons?.length) return;
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = stage.current!.getBoundingClientRect();
      const x = event.clientX - rect.left - rect.width / 2;
      const y = event.clientY - rect.top - rect.height / 2;
      setView((old) => {
        const scale = Math.min(8, Math.max(0.25, old.scale * Math.exp(-event.deltaY * 0.002)));
        const ratio = scale / old.scale;
        return { scale, x: x - (x - old.x) * ratio, y: y - (y - old.y) * ratio };
      });
    };
    const element = stage.current!;
    element.addEventListener('wheel', wheel, { passive: false });
    document.addEventListener('keydown', keydown);
    return () => {
      element.removeEventListener('wheel', wheel);
      document.removeEventListener('keydown', keydown);
      document.body.style.overflow = previousOverflow;
      drag.current = null;
      setDragging(false);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [image]);

  if (!image) return null;
  return createPortal(<div className="image-lightbox" role="dialog" aria-modal="true" aria-label={image.alt}>
    <div className="image-lightbox-toolbar" onClick={(event) => {
      if (event.target === event.currentTarget) setImage(null);
    }}>
      <button ref={closeButton} onClick={() => setImage(null)} aria-label="关闭图片预览">关闭</button>
    </div>
    <div ref={stage} className={`image-lightbox-stage${dragging ? ' dragging' : ''}`}
      onClick={(event) => {
        if (event.target === event.currentTarget && !moved.current) setImage(null);
      }}
      onDoubleClick={reset}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        moved.current = false;
        (event.target as HTMLElement).setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const previous = drag.current;
        if (!previous || previous.id !== event.pointerId) return;
        const dx = event.clientX - previous.x;
        const dy = event.clientY - previous.y;
        if (dx || dy) moved.current = true;
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        setView((old) => ({ ...old, x: old.x + dx, y: old.y + dy }));
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        drag.current = null; setDragging(false);
      }}
      onPointerCancel={() => { drag.current = null; setDragging(false); }}
      onLostPointerCapture={() => { drag.current = null; setDragging(false); }}>
      <img src={image.src} alt={image.alt} draggable={false} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />
    </div>
  </div>, document.body);
}
