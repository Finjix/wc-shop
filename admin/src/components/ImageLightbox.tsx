import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { INITIAL_LIGHTBOX_VIEW, zoomLightbox, type LightboxView } from '../lib/lightbox-zoom';

export function ImageLightbox() {
  const [image, setImage] = useState<{ src: string; alt: string } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [view, setView] = useState(INITIAL_LIGHTBOX_VIEW);
  const viewRef = useRef(INITIAL_LIGHTBOX_VIEW);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const changeView = (next: LightboxView) => {
    viewRef.current = next;
    setView(next);
  };

  useEffect(() => {
    const open = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement) || target.closest('.image-lightbox')) return;
      if (!target.currentSrc || !target.naturalWidth) return;
      event.preventDefault();
      event.stopPropagation();
      changeView(INITIAL_LIGHTBOX_VIEW);
      drag.current = null;
      suppressClick.current = false;
      setDragging(false);
      setImage({ src: target.currentSrc, alt: target.alt || '图片预览' });
    };
    document.addEventListener('click', open, true);
    return () => document.removeEventListener('click', open, true);
  }, []);

  useEffect(() => {
    if (!image) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const previousGutter = document.documentElement.style.scrollbarGutter;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.scrollbarGutter = 'auto';
    stage.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setImage(null);
      if (event.key === 'Tab') {
        event.preventDefault();
        stage.current?.focus();
      }
    };
    const element = stage.current;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      changeView(zoomLightbox(viewRef.current, delta));
    };
    // Native non-passive listener also blocks browser/page scrolling during zoom.
    element?.addEventListener('wheel', wheel, { passive: false });
    document.addEventListener('keydown', keydown);
    return () => {
      element?.removeEventListener('wheel', wheel);
      document.removeEventListener('keydown', keydown);
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.scrollbarGutter = previousGutter;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [image]);

  if (!image) return null;
  return createPortal(
    <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={image.alt}>
      <div ref={stage} tabIndex={-1} className={`image-lightbox-stage${view.scale > 1 ? ' zoomed' : ''}${dragging ? ' dragging' : ''}`}
        aria-label="鼠标滚轮缩放，放大后拖动查看，单击或按 Escape 关闭"
        onPointerDown={(event) => {
          if (event.button !== 0 || viewRef.current.scale <= 1) return;
          suppressClick.current = false;
          drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
            x: viewRef.current.x, y: viewRef.current.y, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.pointerId !== event.pointerId) return;
          const dx = event.clientX - current.startX;
          const dy = event.clientY - current.startY;
          if (!current.moved && Math.hypot(dx, dy) < 3) return;
          current.moved = true;
          changeView({ ...viewRef.current, x: current.x + dx, y: current.y + dy });
        }}
        onPointerUp={(event) => {
          const current = drag.current;
          if (!current || current.pointerId !== event.pointerId) return;
          suppressClick.current = current.moved;
          drag.current = null;
          setDragging(false);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { drag.current = null; suppressClick.current = false; setDragging(false); }}
        onClick={(event) => {
          if (suppressClick.current) { suppressClick.current = false; return; }
          if (event.target === event.currentTarget) setImage(null);
        }}>
        <img src={image.src} alt={image.alt} draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />
      </div>
    </div>,
    document.body,
  );
}
