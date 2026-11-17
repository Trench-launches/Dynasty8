/**
 * Fallback while a page's listings load from the database. Pages read the database per
 * request (src/lib/catalogue.ts), so each page wraps its data in <Suspense> with this
 * fallback. The boundary has to live inside the page: on client navigation, Next.js only
 * re-renders below the layout the two routes share, so a root loading.tsx would never show.
 */
export function PageLoading() {
  return (
    <div className="grid min-h-dvh flex-1 place-items-center bg-background" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <div className="size-10 animate-spin rounded-full border-2 border-[#dee2e6] border-t-sunset" />
        <p className="font-display text-2xl tracking-[0.2em] text-[#6c757d]">Loading listings</p>
      </div>
    </div>
  );
}
