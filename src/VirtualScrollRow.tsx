import React, {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { VirtualScroll, VirtualScrollDataLayout, TorrentData, VirtualScrollBaseProps } from "./VirtualScroll";

export interface VirtualScrollRowProps<T extends Record<string, any>> extends VirtualScrollBaseProps {
  torrent: (offset: number, size: number) => Promise<TorrentData<T>[]>;
  layout: { key: string, layout: VirtualScrollDataLayout<T> }; // User's default component that is in a row, we should know bound here to calculate amount of elements should be in a row. layout.elemsCount is not count of rows here.
  rowLayout?: { [key: string]: VirtualScrollDataLayout<T> }; // this one user layout is rendered instead of internal row. So it's just passed into VirtualScroll::layout. layout.elemsCount is count of rows. Do not handle it anyway's, it's user's responsibilty for this.

  // just passed into VirtualScroll
  pageSize?: number;
  additionalHeight?: number;
  overrideHeight?: number;
  isInfinite?: boolean;

  gapX?: number;
  // NOTE: gapY is not just gap, it's paddingBottom of the internal row
  gapY?: number;

  // just passed into VirtualScroll
  useCache?: boolean;
  cacheSize?: number;
}

interface RowData<T> {
  items: TorrentData<T>[];
}

export function VirtualScrollRow<T extends Record<string, any>>({
  torrent,
  layout: itemLayout,
  rowLayout = {},
  pageSize = 20,
  additionalHeight = 0,
  isInfinite = false,
  gapX = 0,
  gapY = 0,
  useCache = true,
  cacheSize = 1000,
  wrapperClasses = "",
  wrapperStyle = {},
  containerClasses = "",
  containerStyle = {},
  innerContainerStyle,
  innerContainerClasses
}: VirtualScrollRowProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);

  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);

  // measured width of one item (including padding/border as rendered)
  const [itemWidth, setItemWidth] = useState<number>(0);
  // number of items that fit per row
  const [itemsPerRow, setItemsPerRow] = useState<number>(1);
  const [isReady, setIsReady] = useState(false);

  // measure itemWidth and itemsPerRow; account for gapX
  useEffect(() => {
    if (!containerEl || !measureRef.current) return;

    const measure = () => {
      const cw = containerEl.clientWidth;
      const sampleItem = measureRef.current!.firstElementChild as HTMLElement | null;
      const measuredItemWidth = sampleItem ? (sampleItem.offsetWidth || sampleItem.getBoundingClientRect().width) : 0;

      // fallback if measurement failed
      const safeItemWidth = measuredItemWidth > 0 ? measuredItemWidth : 100;

      // compute how many items fit: floor((container + gap) / (item + gap))
      const count = Math.max(1, Math.floor((cw + gapX) / (safeItemWidth + gapX)));

      // compute adjusted itemWidth so count * item + (count - 1) * gapX <= container width
      // we keep measured width but ensure no overflow by taking min(measured, available)
      const totalGaps = (count - 1) * gapX;
      const maxItemWidth = Math.max(1, Math.floor((cw - totalGaps) / count));

      setItemWidth(Math.min(safeItemWidth, maxItemWidth));
      setItemsPerRow(count);
      setIsReady(true);
    };

    measure();

    const ro = new ResizeObserver(() => measure());
    ro.observe(containerEl);
    window.addEventListener("resize", measure);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [containerEl, gapX]);

  // Component wrappers: wrap each user item in a fixed-width container to prevent overflow
  const RowComponent = useMemo(() => {
    const ItemComp = itemLayout.layout.comp;
    const Comp = forwardRef<HTMLDivElement, RowData<T>>(({ items }, ref) => (
      <div
        ref={ref}
        style={{
          display: "flex",
          flexDirection: "row",
          gap: `${gapX}px`,
          paddingBottom: `${gapY}px`,
          width: "100%",
          boxSizing: "border-box",
          alignItems: "flex-start",
          overflow: "hidden",
        }}
      >
        {items.map((tData, index) => (
          <div
            key={index}
            style={{
              flex: "0 0 auto",
              width: itemWidth,
              boxSizing: "border-box",
              overflow: "hidden",
            }}
          >
            <ItemComp {...(tData.data as any)} />
          </div>
        ))}
      </div>
    ));
    Comp.displayName = "RowComponent";
    return Comp;
  }, [itemLayout, gapX, gapY, itemWidth]);

  // Row skeleton (wrap skeletons similarly)
  const RowSkeleton = useMemo(() => {
    const Skel = itemLayout.layout.skeleton;
    const Skeleton = ({ style }: { style?: React.CSSProperties }) => {
      const count = itemsPerRow || 1;
      const effW = itemWidth > 0 ? itemWidth : 100;
      return (
        <div
          style={{
            ...style,
            display: "flex",
            flexDirection: "row",
            gap: `${gapX}px`,
            paddingBottom: `${gapY}px`,
            overflow: "hidden",
            boxSizing: "border-box",
          }}
        >
          {Array.from({ length: count }).map((_, i) => (
            <div key={i} style={{ flex: "0 0 auto", width: effW, boxSizing: "border-box" }}>
              <Skel />
            </div>
          ))}
        </div>
      );
    };
    Skeleton.displayName = "RowSkeleton";
    return Skeleton;
  }, [itemLayout, itemsPerRow, itemWidth, gapX, gapY]);

  // ---------- Element -> Row mapping (stable, deterministic) ----------
  const rowsRef = useRef<TorrentData<any>[]>([]);
  const pendingChunkRef = useRef<TorrentData<T>[]>([]);
  const elementCursorRef = useRef(0);
  const endReachedRef = useRef(false);
  const pendingFetchId = useRef(0);
  const fetchingRef = useRef(false);

  useEffect(() => {
    // reset caches when key or itemsPerRow change
    rowsRef.current = [];
    pendingChunkRef.current = [];
    elementCursorRef.current = 0;
    endReachedRef.current = false;
    pendingFetchId.current += 1;
  }, [itemsPerRow, torrent, itemLayout.key]);

  const ensureRows = useCallback(
    async (neededRows: number) => {
      if (rowsRef.current.length >= neededRows) return;

      while (rowsRef.current.length < neededRows && !endReachedRef.current) {
        if (fetchingRef.current) {
          // slight backoff while another fetch resolves
          await new Promise((r) => setTimeout(r, 8));
          continue;
        }

        fetchingRef.current = true;
        const thisFetchId = ++pendingFetchId.current;

        try {
          const need = neededRows - rowsRef.current.length;
          const fetchElems = Math.max(need * Math.max(1, itemsPerRow), pageSize * Math.max(1, itemsPerRow), Math.max(1, itemsPerRow) * 5);
          const offset = elementCursorRef.current;
          const resp = await torrent(offset, fetchElems);

          // stale result check
          if (thisFetchId !== pendingFetchId.current) continue;

          elementCursorRef.current += resp.length;
          if (resp.length === 0) {
            endReachedRef.current = true;
            if (pendingChunkRef.current.length > 0) {
              rowsRef.current.push({ lKey: itemLayout.key, data: { items: pendingChunkRef.current } });
              pendingChunkRef.current = [];
            }
            break;
          }

          for (const el of resp) {
            if (el.lKey === itemLayout.key) {
              pendingChunkRef.current.push(el);
              if (pendingChunkRef.current.length === itemsPerRow) {
                rowsRef.current.push({ lKey: itemLayout.key, data: { items: pendingChunkRef.current } });
                pendingChunkRef.current = [];
              }
            } else {
              if (pendingChunkRef.current.length > 0) {
                rowsRef.current.push({ lKey: itemLayout.key, data: { items: pendingChunkRef.current } });
                pendingChunkRef.current = [];
              }
              rowsRef.current.push(el);
            }
            if (rowsRef.current.length >= neededRows) break;
          }

          // if response smaller than requested, finalize pending partial row
          if (resp.length < fetchElems && pendingChunkRef.current.length > 0) {
            rowsRef.current.push({ lKey: itemLayout.key, data: { items: pendingChunkRef.current } });
            pendingChunkRef.current = [];
          }

          // Repair element cursor defensively: compute authoritative sum of consumed elements
          // (1 for special rows, itemsPerRow for full item rows, or partial length)
          // Build counts on the fly:
          let consumed = 0;
          for (const row of rowsRef.current) {
            if (row.lKey === itemLayout.key) {
              consumed += Array.isArray((row.data as any).items) ? (row.data as any).items.length : itemsPerRow;
            } else {
              consumed += 1;
            }
          }
          // also add pending chunk elements that have been read from source but not yet pushed
          consumed += pendingChunkRef.current.length;
          if (elementCursorRef.current !== consumed) {
            // align cursor
            elementCursorRef.current = consumed;
          }
        } finally {
          fetchingRef.current = false;
        }
      }
    },
    [torrent, itemsPerRow, pageSize, itemLayout.key]
  );

  const rowTorrent = useCallback(
    async (rowOffset: number, rowSize: number) => {
      if (itemsPerRow === 0) return [];
      const needed = rowOffset + rowSize;
      await ensureRows(needed);
      const out: TorrentData<any>[] = [];
      for (let i = rowOffset; i < needed; i++) {
        if (i < rowsRef.current.length) out.push(rowsRef.current[i]);
        else if (i === rowsRef.current.length && pendingChunkRef.current.length > 0)
          out.push({ lKey: itemLayout.key, data: { items: pendingChunkRef.current } });
        else break;
      }
      return out;
    },
    [ensureRows, itemsPerRow, itemLayout.key]
  );

  const internalLayout = useMemo(() => {
    if (!isReady) return {};
    const totalElements = itemLayout.layout.elemsCount || 0;
    const rowsCount = Math.ceil(totalElements / Math.max(1, itemsPerRow));
    return {
      [itemLayout.key]: {
        comp: RowComponent as any,
        skeleton: RowSkeleton,
        elemsCount: rowsCount,
        boundNode: (
          <div style={{ display: "flex", flexDirection: "row", paddingBottom: gapY }}>
            {itemLayout.layout.boundNode}
          </div>
        ),
      },
      ...rowLayout,
    };
  }, [isReady, itemsPerRow, itemLayout, rowLayout, RowComponent, RowSkeleton, gapY]);

  return (
    <div
      ref={(el) => {
        containerRef.current = el;
        setContainerEl(el);
      }}
      style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden" }}
    >
      <div
        ref={measureRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          visibility: "hidden",
          pointerEvents: "none",
          zIndex: -1,
        }}
      >
        {itemLayout.layout.boundNode}
      </div>

      {!isReady ? (
        <div style={{ padding: 20, color: "#666" }}>Loading...</div>
      ) : (
        <VirtualScroll
          layout={internalLayout as any}
          torrent={rowTorrent as any}
          pageSize={pageSize}
          additionalHeight={additionalHeight}
          isInfinite={isInfinite}
          useCache={useCache}
          cacheSize={cacheSize}
          containerClasses={containerClasses}
          containerStyle={containerStyle}
          wrapperClasses={wrapperClasses}
          wrapperStyle={wrapperStyle}
          innerContainerStyle={innerContainerStyle}
          innerContainerClasses={innerContainerClasses}
        />
      )}
    </div>
  );
}