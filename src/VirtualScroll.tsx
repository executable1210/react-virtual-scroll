import React, {
  ForwardRefExoticComponent,
  ReactNode,
  RefAttributes,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export interface VirtualScrollDataLayout<T extends Record<string, any>> {
  comp: ForwardRefExoticComponent<T & RefAttributes<HTMLElement>>; // user component
  skeleton: React.ComponentType<{ style?: React.CSSProperties }>; // user skeleton
  elemsCount: number; // count of elements in torrent, this need for calculating height or width(for VirtualScrollRow) of container. For VirtualScrollRow this is not number of rows as well.

  // needs for measurement the height for container
  boundNode: ReactNode;
}

export interface TorrentData<T> {
  lKey: string;
  data: T;
};

export interface VirtualScrollProps<
  T extends Record<string, any>
> {
  torrent: (offset: number, size: number) => Promise<TorrentData<T>[]>;
  // elemCount: number;
  layout: { [key: string]: VirtualScrollDataLayout<T> };

  // custom batch of items per render
  pageSize?: number;
  additionalHeight?: number;
  overrideHeight?: number;

  // use this when there's no known count of elements
  // progressive height
  isInfinite?: boolean;

  useCache?: boolean;
  cacheSize?: number;
}

const BUFFER = 5;

export function VirtualScroll<T extends Record<string, any>>({
  torrent,
  layout,
  pageSize = 20,
  overrideHeight = 0,
  additionalHeight = 0,
  useCache = true,
  cacheSize = 1000,
  isInfinite = false,
}: VirtualScrollProps<T>) {
  const contRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);

  const maxLoadedCountRef = useRef(0);

  const elemCount = Object.values(layout).reduce(
    (sum, item) => sum + item.elemsCount,
    0
  );

  /* -------------------- layout height measurement -------------------- */
  const [layoutHeights, setLayoutHeights] = useState<Record<string, number>>({});
  const [defaultHeight, setDefaultHeight] = useState(0);

  /* -------------------- infinite state -------------------- */
  const [resolvedCount, setResolvedCount] = useState<number | null>(null);

  /* -------------------- cache -------------------- */
  const [itemsMap, setItemsMap] = useState<Record<number, TorrentData<T>>>({});
  const itemsRef = useRef(itemsMap);
  useEffect(() => {
    itemsRef.current = itemsMap;
  }, [itemsMap]);

  /* -------------------- per-index heights -------------------- */
  const heightsRef = useRef<Record<number, number>>({});
  const prefixRef = useRef<number[]>([0]);
  const totalDeltaRef = useRef(0);

  /* -------------------- viewport and scroll -------------------- */
  const [viewportHeight, setViewportHeight] = useState<number | string>("100%");
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    if (!contRef.current?.parentElement) return;
    setViewportHeight(
      contRef.current.parentElement.getBoundingClientRect().height
    );
  }, []);

  const layoutKeys = useMemo(() => Object.keys(layout), [layout]);
  const layoutEntries = useMemo(
    () => layoutKeys.map((k) => [k, layout[k]] as [string, VirtualScrollDataLayout<T>]),
    [layout, layoutKeys]
  );

  /* -------------------- measure layout boundNodes -------------------- */
  useLayoutEffect(() => {
    if (!measureRef.current) return;

    const children = Array.from(measureRef.current.children) as HTMLElement[];
    const lh: Record<string, number> = {};

    layoutKeys.forEach((k, i) => {
      lh[k] = children[i]?.getBoundingClientRect().height ?? 0;
    });

    setLayoutHeights(lh);
    const entries = layoutEntries;
    const values = entries.map(([k]) => lh[k] ?? 0);
    const totalElems = entries.reduce((s, [, l]) => s + (l.elemsCount || 0), 0);

    let weightedDefault = 0;
    if (totalElems > 0) {
      weightedDefault =
        entries.reduce((acc, [k, l]) => acc + (lh[k] ?? 0) * (l.elemsCount || 0), 0) /
        totalElems;
    } else {
      weightedDefault = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    }

    setDefaultHeight(weightedDefault);

    heightsRef.current = {};
    prefixRef.current = [0];
    totalDeltaRef.current = 0;
  }, [layout, layoutKeys, layoutEntries]);

  /* -------------------- prefix helpers -------------------- */
  const ensurePrefix = (index: number) => {
    const pref = prefixRef.current;
    for (let i = pref.length; i <= index; i++) {
      const h = heightsRef.current[i - 1] ?? defaultHeight;
      pref[i] = pref[i - 1] + h;
    }
  };

  const topForIndex = (index: number) => {
    if (index <= 0) return 0;
    ensurePrefix(index);
    return prefixRef.current[index];
  };

  const setIndexHeight = (index: number, h: number) => {
    const prev = heightsRef.current[index] ?? defaultHeight;
    const delta = h - prev;
    if (!delta) return;

    heightsRef.current[index] = h;
    totalDeltaRef.current += delta;

    const pref = prefixRef.current;
    for (let i = index + 1; i < pref.length; i++) {
      pref[i] += delta;
    }
  };

  /* -------------------- fetching -------------------- */
  const fetchItems = useCallback(
    async (offset: number, size: number) => {
      if (resolvedCount !== null && offset >= resolvedCount) return;

      const data = await torrent(offset, size);

      if (isInfinite) {
        if (data.length === 0) {
          setResolvedCount((prev) => (prev === null ? offset : Math.min(prev, offset)));
          return;
        }
        if (data.length < size) {
          const newTotal = offset + data.length;
          setResolvedCount((prev) => (prev === null ? newTotal : Math.min(prev, newTotal)));
        }
      }

      const fetched: Record<number, TorrentData<T>> = {};
      data.forEach((item, i) => {
        const idx = offset + i;
        if (resolvedCount !== null && idx >= resolvedCount) return;

        fetched[idx] = item;
        const h = layoutHeights[item.lKey] ?? defaultHeight;
        setIndexHeight(idx, h);
      });

      setItemsMap((prev) => {
        const merged = useCache ? { ...prev, ...fetched } : fetched;

        const currentMaxIndex = Math.max(...Object.keys(merged).map(Number), -1);
        const currentCount = currentMaxIndex + 1;
        maxLoadedCountRef.current = Math.max(maxLoadedCountRef.current, currentCount);

        if (useCache && Object.keys(merged).length > cacheSize) {
          const keys = Object.keys(merged)
            .map(Number)
            .sort((a, b) => Math.abs(a - offset) - Math.abs(b - offset));
          const keep = new Set(keys.slice(0, cacheSize));
          const next: Record<number, TorrentData<T>> = {};
          keys.forEach((k) => keep.has(k) && (next[k] = merged[k]));
          return next;
        }
        return merged;
      });
    },
    [
      torrent,
      layoutHeights,
      defaultHeight,
      isInfinite,
      resolvedCount,
      useCache,
      cacheSize,
    ]
  );

  /* -------------------- visible range -------------------- */
  const computeRange = useCallback(() => {
    if (!contRef.current || !defaultHeight) return null;

    const scrollTopVal = scrollTop;
    const vh = typeof viewportHeight === "number" ? viewportHeight : 0;

    let idx = Math.max(0, Math.floor(scrollTopVal / defaultHeight));
    while (idx > 0 && topForIndex(idx) > scrollTopVal) idx--;
    while (topForIndex(idx + 1) <= scrollTopVal) idx++;

    let acc = 0;
    let end = idx;

    const limit = resolvedCount ?? Number.MAX_SAFE_INTEGER;

    while (end < limit && acc < vh) {
      acc += heightsRef.current[end] ?? defaultHeight;
      end++;
    }

    return {
      start: Math.max(0, idx - BUFFER),
      size: Math.max(pageSize, end - idx + BUFFER * 2),
    };
  }, [scrollTop, defaultHeight, viewportHeight, resolvedCount, pageSize]);

  /* -------------------- scroll listener -------------------- */
  useEffect(() => {
    if (!contRef.current) return;
    const onScroll = () => setScrollTop(contRef.current!.scrollTop);
    contRef.current.addEventListener("scroll", onScroll, { passive: true });
    return () => contRef.current?.removeEventListener("scroll", onScroll);
  }, []);

  /* -------------------- fetch on scroll -------------------- */
  useEffect(() => {
    if (!defaultHeight) return;
    const r = computeRange();
    if (r) fetchItems(r.start, r.size);
  }, [scrollTop, defaultHeight, computeRange, fetchItems]);

  /* -------------------- initial fetch -------------------- */
  useEffect(() => {
    if (!defaultHeight) return;
    fetchItems(0, pageSize);
  }, [defaultHeight, fetchItems, pageSize]);

  /* -------------------- container height calculation -------------------- */
  const maxLoadedIndex = useMemo(() => {
    const indices = Object.keys(itemsMap).map(Number);
    return indices.length > 0 ? Math.max(...indices) : -1;
  }, [itemsMap]);

  const knownCount = useMemo(() => {
    if (isInfinite) {
      if (resolvedCount !== null) return resolvedCount;
      return Math.max(maxLoadedCountRef.current, maxLoadedIndex + 1);
    }
    return elemCount;
  }, [isInfinite, resolvedCount, elemCount, maxLoadedIndex]);

  const totalHeight = useMemo(() => {
    return knownCount * defaultHeight + totalDeltaRef.current + additionalHeight;
  }, [knownCount, defaultHeight, additionalHeight]);

  /* -------------------- render -------------------- */
  if (!defaultHeight) {
    return (
      <div ref={contRef} style={{ height: viewportHeight, overflowY: "auto" }}>
        <div
          ref={measureRef}
          style={{ position: "absolute", visibility: "hidden" }}
        >
          {/* render in the same stable order as layoutKeys */}
          {layoutKeys.map((k) => (
            <div key={k}>{layout[k].boundNode}</div>
          ))}
        </div>
      </div>
    );
  }

  const r = computeRange();
  const start = r?.start ?? 0;
  const size = r?.size ?? pageSize;

  const effectiveCount = isInfinite
    ? resolvedCount ?? Number.MAX_SAFE_INTEGER
    : elemCount;

  const visible = Array.from({ length: size }, (_, i) => start + i).filter(
    (i) => i < effectiveCount
  );

  const firstLayoutKey = layoutKeys[0];

  return (
    <div
      ref={contRef}
      style={{ height: viewportHeight, overflowY: "auto", position: "relative" }}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        {visible.map((index) => {
          const item = itemsMap[index];
          const entry = item ? layout[item.lKey] : layout[firstLayoutKey];
          const top = topForIndex(index);
          const h = heightsRef.current[index] ?? defaultHeight;

          return (
            <div
              key={index}
              style={{ position: "absolute", top, height: h, left: 0, right: 0 }}
            >
              {!item ? (
                <entry.skeleton style={{ height: "100%" }} />
              ) : (
                <entry.comp {...item.data} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}