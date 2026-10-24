import { useEffect, useRef, useState } from "react";
import { Maximize2, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { LazySkinPhoto } from "./LazySkinPhoto";
import { ModalPortal } from "./ModalPortal";

interface ZoomableSkinPhotoProps {
  pathOrUrl?: string | null;
  alt?: string;
  className?: string;
}

export function ZoomableSkinPhoto(props: ZoomableSkinPhotoProps) {
  // A different patient's photo must never reuse the previous viewer or URL.
  return <SkinPhoto key={props.pathOrUrl} {...props} />;
}

function SkinPhoto({ pathOrUrl, alt = "Uploaded skin photo", className }: ZoomableSkinPhotoProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [failed, setFailed] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Dismiss the photo without also closing the appointment underneath it.
        event.preventDefault();
        event.stopImmediatePropagation();
        setOpen(false);
      }
      if (event.key === "Tab") {
        const buttons = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]');
        if (!buttons?.length) return;
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown, true);
    const trigger = triggerRef.current;
    return () => {
      document.removeEventListener("keydown", keydown, true);
      trigger?.focus();
    };
  }, [open]);

  return <>
    <button ref={triggerRef} type="button" disabled={!url || failed} aria-label="Enlarge uploaded skin photo"
      onClick={() => { setZoom(1); setOpen(true); }}
      className="group relative block w-full overflow-hidden rounded-xl text-left enabled:cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
      <LazySkinPhoto pathOrUrl={pathOrUrl} alt={alt} className={className} onUrlResolved={setUrl} onError={() => setFailed(true)} />
      {url && !failed && <span className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-lg bg-slate-900/80 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm group-hover:bg-blue-700"><Maximize2 className="h-3.5 w-3.5" />Click to zoom</span>}
    </button>
    {failed && <p role="status" className="mt-1 text-xs text-slate-500">The skin photo could not be loaded.</p>}
    <ModalPortal isOpen={open}>
      {open && url && <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-slate-950/90 p-2 backdrop-blur-sm sm:p-6" onClick={() => setOpen(false)}>
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Uploaded skin photo zoom viewer"
          onClick={event => event.stopPropagation()} className="flex h-[90dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/20 bg-slate-900 shadow-2xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-3 py-3 text-white sm:px-5">
            <p className="text-sm font-semibold">Uploaded Skin Photo</p>
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - 0.5))} className="rounded-lg p-2 hover:bg-white/10 disabled:opacity-30"><ZoomOut className="h-5 w-5" /></button>
              <output aria-live="polite" className="w-12 text-center text-sm tabular-nums">{Math.round(zoom * 100)}%</output>
              <button type="button" aria-label="Zoom in" disabled={zoom >= 4} onClick={() => setZoom(value => Math.min(4, value + 0.5))} className="rounded-lg p-2 hover:bg-white/10 disabled:opacity-30"><ZoomIn className="h-5 w-5" /></button>
              <button type="button" aria-label="Reset zoom" onClick={() => { setZoom(1); viewportRef.current?.scrollTo(0, 0); }} className="rounded-lg p-2 hover:bg-white/10"><RotateCcw className="h-5 w-5" /></button>
              <button ref={closeRef} type="button" aria-label="Close photo viewer" onClick={() => setOpen(false)} className="rounded-lg p-2 hover:bg-white/10"><X className="h-5 w-5" /></button>
            </div>
          </div>
          <div ref={viewportRef} tabIndex={0} role="region" aria-label="Skin photo; scroll to inspect when zoomed" className="min-h-0 flex-1 overflow-auto overscroll-contain focus-visible:outline-2 focus-visible:outline-blue-400">
            <div style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
              <img src={url} alt={alt} draggable={false} className="h-full w-full max-w-none select-none object-contain" />
            </div>
          </div>
          <p className="border-t border-white/10 px-4 py-2 text-center text-xs text-slate-300">Use + / − to zoom. Scroll or swipe to inspect the enlarged photo. Press Esc to close.</p>
        </div>
      </div>}
    </ModalPortal>
  </>;
}
