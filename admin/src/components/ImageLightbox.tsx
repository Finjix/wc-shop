import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function ImageLightbox() {
  const [image, setImage] = useState<{ src: string; alt: string } | null>(null);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const open = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement) || target.closest('.image-lightbox')) return;
      if (!target.currentSrc || !target.naturalWidth) return;
      event.preventDefault();
      event.stopPropagation();
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
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.scrollbarGutter = previousGutter;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [image]);

  if (!image) return null;
  return createPortal(
    <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={image.alt}>
      <div ref={stage} tabIndex={-1} className="image-lightbox-stage"
        onClick={(event) => {
          if (event.target === event.currentTarget) setImage(null);
        }}>
        <img src={image.src} alt={image.alt} draggable={false} />
      </div>
    </div>,
    document.body,
  );
}
