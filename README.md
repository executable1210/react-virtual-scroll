# react-virtual-scroll

A small, high-performance **virtualized scroll** React component with async loading. It fetches only the visible slice of items (plus a small buffer), measures the item height automatically and provides simple sticky loading indicators for top/bottom fetches.

## Features

* Virtualizes large lists to reduce DOM nodes
* Skeleton support
* Totally aggresive optimization having large dataset due to virtualization 

## Install

```bash
npm install react-virtual-scroll
# or
yarn add react-virtual-scroll
```

## Types

```ts
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
  // fetch callback
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

  // cache config
  useCache?: boolean;
  cacheSize?: number;
}

export interface VirtualScrollRowProps<T extends Record<string, any>> {
  torrent: (offset: number, size: number) => Promise<TorrentData<T>[]>;
  layout: { key: string, layout: VirtualScrollDataLayout<T> }; // User's default component that is in a row.
  rowLayout?: { [key: string]: VirtualScrollDataLayout<T> }; // Custom row layouts

  pageSize?: number;
  additionalHeight?: number;
  overrideHeight?: number;
  isInfinite?: boolean;

  gapX?: number;
  // NOTE: gapY is not just gap, it's paddingBottom of the internal row
  gapY?: number;

  useCache?: boolean;
  cacheSize?: number;
}
```

**Notes:**

* The parent container must have a fixed height (or constrained height) so the internal container can set `overflow` and measure scroll offset. In many layouts this is the element that wraps `VirtualScroll`.
* The item component should have a fixed `height` for best measurement. The component measures the first rendered item via `ref` to determine `relemHeight`.

## Example using single layout

```tsx
import React from 'react';

import { VirtualScroll, VirtualScrollDataLayout, TorrentData } from 'react-virtual-scroll';

// 1. Define your data type
interface MessageItem {
  id: number;
  sender: string;
  message: string;
  timestamp: string;
  avatar: string;
}

// 2. Main component (MUST use forwardRef)
const MessageComponent = React.forwardRef<HTMLDivElement, MessageItem>(
  ({ sender, message, timestamp, avatar }, ref) => {
    return (
      <div
        ref={ref}
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #eee',
          display: 'flex',
          gap: '12px',
        }}
      >
        <img
          src={avatar}
          alt={sender}
          style={{ width: 40, height: 40, borderRadius: '50%' }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{sender}</div>
          <div style={{ color: '#333', marginBottom: 4 }}>{message}</div>
          <div style={{ fontSize: 12, color: '#999' }}>{timestamp}</div>
        </div>
      </div>
    );
  }
);
MessageComponent.displayName = 'MessageComponent';

// 3. Skeleton loader (matches component height)
const MessageSkeleton = ({ style }: { style?: React.CSSProperties }) => (
  <div
    style={{
      ...style,
      padding: '12px 16px',
      borderBottom: '1px solid #eee',
      display: 'flex',
      gap: '12px',
    }}
  >
    <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#e0e0e0' }} />
    <div style={{ flex: 1 }}>
      <div style={{ height: 16, width: '30%', background: '#e0e0e0', marginBottom: 8 }} />
      <div style={{ height: 14, width: '90%', background: '#e0e0e0', marginBottom: 6 }} />
      <div style={{ height: 12, width: '20%', background: '#e0e0e0' }} />
    </div>
  </div>
);

// 4. Generate mock data
const mockMessages = Array.from({ length: 10000 }, (_, i) => ({
  id: i,
  sender: `User ${i + 1}`,
  message: `This is message number ${i + 1}. Lorem ipsum dolor sit amet.`,
  timestamp: new Date(Date.now() - i * 60000).toLocaleTimeString(),
  avatar: `https://i.pravatar.cc/40?u=${i}`,
}));

// 5. Setup layout configuration
const messageLayout: { [key: string]: VirtualScrollDataLayout<MessageItem> } = {
  message: {
    comp: MessageComponent,
    skeleton: MessageSkeleton,
    elemsCount: 10000, // Total expected items
    boundNode: (
      <MessageComponent
        id={0}
        sender="Sample User"
        message="Sample message for measurement"
        timestamp="12:00 PM"
        avatar="https://via.placeholder.com/40"
        ref={null as any} // Measurement only, ref not needed
      />
    ),
  },
};

// 6. Implement torrent function (simulates API)
const torrent = async (
  offset: number,
  size: number
): Promise<TorrentData<MessageItem>[]> => {
  await new Promise((resolve) => setTimeout(resolve, 450)); // Simulate network delay

  return mockMessages.slice(offset, offset + size).map((item) => ({
    lKey: 'message',
    data: item,
  }));
};

export const MessageList = () => {
  return (
    <div style={{ height: '100vh' }}>
      <VirtualScroll<MessageItem>
        torrent={torrent}
        layout={messageLayout}
        pageSize={30}      // Load 30 items per batch
        cacheSize={300}    // Keep last 300 items in memory
        useCache={true}
        isInfinite={false} // we have known items count so we don't use this
      />
    </div>
  );
};

export default function App() {
  return (
    <MessageList />
);
}
```

## Example using multiply layouts

```tsx
import React, {
  forwardRef,
  useCallback,
  useMemo
} from "react";
import {
  TorrentData,
  VirtualScroll
} from "@/components/VirtualScroll.tsx";

interface BaseData { id: number; timestamp: string; }
interface CardData extends BaseData { title: string; imageUrl: string; likes: number; }
interface ListData extends BaseData { name: string; description: string; status: "online" | "offline" | "busy"; }
interface DetailData extends BaseData { author: string; content: string; tags: string[]; }
interface CompactData extends BaseData { event: string; priority: "low" | "medium" | "high"; }

// ==================== LAYOUT 1: CARD COMPONENT (150px) ====================
const CardComponent = forwardRef<HTMLDivElement, CardData>((props, ref) => {
  return (
    <div
      ref= { ref }
      style = {{
        height: "150px",
        display: "flex",
        border: "1px solid #e0e0e0",
        borderRadius: "8px",
        overflow: "hidden",
        background: "white",
        boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
      }
      }
    >
      <img src={ props.imageUrl } alt = { props.title } style = {{ width: "150px", height: "150px", objectFit: "cover" }} />
      < div style = {{ padding: "16px", flex: 1, display: "flex", flexDirection: "column" }}>
        <h3 style={ { margin: "0 0 8px 0", fontSize: "16px" } }> { props.title } </h3>
        < p style = {{ margin: "auto 0 8px 0", color: "#666", fontSize: "14px" }}>
          ID: { props.id } • { props.timestamp }
        </p>
        < div style = {{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={ { color: "#e91e63" } }>♥ { props.likes } </span>
          < button
            style = {{
              marginLeft: "auto",
              padding: "6px 12px",
              background: "#1976d2",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            View Details
          </button>
        </div>
      </div>
    </div>
  );
});

const CardSkeleton = ({ style }: { style?: CSSProperties }) => (
  <div
    style= {{
      ...style,
      height: "150px",
      display: "flex",
      border: "1px solid #e0e0e0",
      borderRadius: "8px",
      background: "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)",
      backgroundSize: "200% 100%",
      animation: "loading 1.5s infinite",
    }}
  >
    <div style={ { width: "150px", height: "150px", background: "#e0e0e0" } } />
    < div style = {{ padding: "16px", flex: 1 }}>
      <div style={ { height: "20px", width: "60%", background: "#e0e0e0", marginBottom: "12px" } } />
      < div style = {{ height: "14px", width: "80%", background: "#e0e0e0", marginBottom: "8px" }} />
      < div style = {{ height: "14px", width: "50%", background: "#e0e0e0", marginBottom: "16px" }} />
      < div style = {{ height: "32px", width: "100px", background: "#e0e0e0", marginLeft: "auto" }} />
    </div>
    < style > {`@keyframes loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
  </div>
);

// ==================== LAYOUT 2: LIST ITEM (80px) ====================
const ListComponent = forwardRef<HTMLDivElement, ListData>((props, ref) => {
  const statusColor = { online: "#4caf50", offline: "#9e9e9e", busy: "#ff9800" }[props.status];
  return (
    <div
      ref= { ref }
      style = {{
        height: "80px",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        borderBottom: "1px solid #eee",
        background: "white",
      }
      }
    >
      <div
        style={{
          width: "40px",
          height: "40px",
          borderRadius: "50%",
          background: "#1976d2",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontWeight: "bold",
          marginRight: "12px",
        }}
      >
        { props.name.charAt(0) }
      </div>
      < div style = {{ flex: 1 }}>
        <div style={ { fontWeight: "500", marginBottom: "4px" } }> { props.name } </div>
        < div style = {{ fontSize: "14px", color: "#666" }}> { props.description } </div>
      </div>
      < div style = {{ display: "flex", alignItems: "center", gap: "8px" }}>
        <div style={ { width: "8px", height: "8px", borderRadius: "50%", background: statusColor } } />
        < span style = {{ fontSize: "14px", textTransform: "capitalize" }}> { props.status } </span>
      </div>
    </div>
  );
});

const ListSkeleton = ({ style }: { style?: CSSProperties }) => (
  <div
    style= {{
      ...style,
      height: "80px",
      display: "flex",
      alignItems: "center",
      padding: "0 16px",
      borderBottom: "1px solid #eee",
      background: "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0e0 75%)",
      backgroundSize: "200% 100%",
      animation: "loading 1.5s infinite",
    }}
  >
    <div style={ { width: "40px", height: "40px", borderRadius: "50%", background: "#e0e0e0", marginRight: "12px" } } />
    < div style = {{ flex: 1 }}>
      <div style={ { height: "16px", width: "200px", background: "#e0e0e0", marginBottom: "8px" } } />
      < div style = {{ height: "14px", width: "300px", background: "#e0e0e0" }} />
    </div>
  </div>
);

// ==================== LAYOUT 3: DETAIL POST (300px) ====================
const DetailComponent = forwardRef<HTMLDivElement, DetailData>((props, ref) => {
  return (
    <div
      ref= { ref }
      style = {{
        height: "300px",
        padding: "20px",
        border: "1px solid #ddd",
        borderRadius: "8px",
        background: "white",
        marginBottom: "16px",
        display: "flex",
        flexDirection: "column",
      }
      }
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: "12px" }}>
        <div
          style={
            {
              width: "48px",
              height: "48px",
              borderRadius: "50%",
              background: "#673ab7",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontWeight: "bold",
              marginRight: "12px",
            }
          }
        >
          { props.author.charAt(0) }
        </div>
        < div >
          <div style={ { fontWeight: "500" } }> { props.author } </div>
          < div style = {{ fontSize: "14px", color: "#666" }}> { props.timestamp } </div>
        </div>
      </div>
      < div style = {{ flex: 1, overflow: "auto", marginBottom: "12px" }}>
        <p style={ { lineHeight: "1.6", margin: 0 } }> { props.content } </p>
      </div>
      < div style = {{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {
          props.tags.map((tag, i) => (
            <span
              key= { i }
              style = {{ padding: "4px 8px", background: "#e3f2fd", color: "#1976d2", borderRadius: "12px", fontSize: "12px" }}
            >
            #{ tag }
</span>
          ))}
      </div>
    </div>
  );
});

const DetailSkeleton = ({ style }: { style?: CSSProperties }) => (
  <div
    style= {{
      ...style,
      height: "300px",
      padding: "20px",
      border: "1px solid #ddd",
      borderRadius: "8px",
      background: "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)",
      backgroundSize: "200% 100%",
      animation: "loading 1.5s infinite",
    }}
  >
    <div style={ { display: "flex", alignItems: "center", marginBottom: "12px" } }>
      <div style={ { width: "48px", height: "48px", borderRadius: "50%", background: "#e0e0e0", marginRight: "12px" } } />
      < div >
        <div style={ { height: "16px", width: "120px", background: "#e0e0e0", marginBottom: "4px" } } />
        < div style = {{ height: "14px", width: "80px", background: "#e0e0e0" }} />
      </div>
    </div>
    < div style = {{ height: "180px", marginBottom: "12px" }}>
      {
        [...Array(6)].map((_, i) => (
          <div key= { i } style = {{ height: "14px", background: "#e0e0e0", marginBottom: "8px" }} />
        ))}
    </div>
    < div style = {{ display: "flex", gap: "8px" }}>
      {
        [...Array(4)].map((_, i) => (
          <div key= { i } style = {{ height: "24px", width: "60px", background: "#e0e0e0", borderRadius: "12px" }} />
        ))}
    </div>
  </div>
);

// ==================== LAYOUT 4: COMPACT NOTIFICATION (60px) ====================
const CompactComponent = forwardRef<HTMLDivElement, CompactData>((props, ref) => {
  const priorityColor = { low: "#4caf50", medium: "#ff9800", high: "#f44336" }[props.priority];
  return (
    <div
      ref= { ref }
      style = {{
        height: "60px",
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        background: "#f5f5f5",
        borderLeft: `4px solid ${priorityColor}`,
        marginBottom: "2px",
      }
      }
    >
      <div style={{ flex: 1, fontSize: "14px" }}> { props.event } </div>
      < div
        style = {{ padding: "4px 8px", background: priorityColor, color: "white", borderRadius: "4px", fontSize: "12px", textTransform: "uppercase" }}
      >
        { props.priority }
      </div>
    </div>
  );
});

const CompactSkeleton = ({ style }: { style?: CSSProperties }) => (
  <div
    style= {{
      ...style,
      height: "60px",
      display: "flex",
      alignItems: "center",
      padding: "0 12px",
      background: "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)",
      backgroundSize: "200% 100%",
      animation: "loading 1.5s infinite",
      borderLeft: "4px solid #e0e0e0",
      marginBottom: "2px",
    }}
  >
    <div style={ { flex: 1, height: "14px", background: "#e0e0e0", marginRight: "12px" } } />
    < div style = {{ height: "20px", width: "60px", background: "#e0e0e0", borderRadius: "4px" }} />
  </div>
);

// ==================== PRE-COMPUTED MOCK DATA ====================
const createPrecomputedData = (total: number) => {
  const data: TorrentData<any>[] = [];

  for (let i = 0; i < total; i++) {
    const timestamp = new Date(Date.now() - i * 60000).toLocaleString();

    if (i % 15 === 0) {
      data.push({
        lKey: "card",
        data: {
          id: i,
          timestamp,
          title: `Gallery Item #${i}`,
          imageUrl: `https://picsum.photos/150/150?random=${i}`,
          likes: (i * 7) % 1000,
        },
      });
    } else if ((i - 5) % 25 === 0) {
      data.push({
        lKey: "detail",
        data: {
          id: i,
          timestamp,
          author: `User${i % 100}`,
          content: `This is a detailed post with index ${i}. It contains much more content that requires a larger container. ${"Lorem ipsum dolor sit amet. ".repeat(10)}`,
          tags: ["react", "virtual-scroll", "performance", `tag-${i % 100}`],
        },
      });
    } else if ((i - 8) % 10 === 0) {
      const priorities: ("low" | "medium" | "high")[] = ["low", "medium", "high"];
      data.push({
        lKey: "compact",
        data: {
          id: i,
          timestamp,
          event: `System event #${i} occurred at ${timestamp}`,
          priority: priorities[i % 3],
        },
      });
    } else {
      const statuses: ("online" | "offline" | "busy")[] = ["online", "offline", "busy"];
      data.push({
        lKey: "list",
        data: {
          id: i,
          timestamp,
          name: `Item-${i}`,
          description: `Description for item number ${i}`,
          status: statuses[i % 3],
        },
      });
    }
  }

  return data;
};

// ==================== MAIN APP COMPONENT ====================
function VirtualScrollExample() {
  const ITEMSCOUNT = 1000;
  const masterData = useMemo(() => createPrecomputedData(ITEMSCOUNT), []);

  // Define multiple layouts with fixed heights
  const layouts: { [key: string]: VirtualScrollDataLayout<any> } = useMemo(() => {
    return {
      card: {
        comp: CardComponent as any,
        skeleton: CardSkeleton,
        elemsCount: Math.ceil(ITEMSCOUNT / 15),
        boundNode: <div style={ { height: "150px", width: "100%", background: "#f0f0f0" } }> <div style={ { padding: "16px" } }> Card Layout Measure < /div></div >,
      },
      list: {
        comp: ListComponent as any,
        skeleton: ListSkeleton,
        elemsCount: Math.ceil(ITEMSCOUNT * 10 / 15),
        boundNode: <div style={{ height: "80px", width: "100%", background: "#f0f0f0" }}> <div style={ { padding: "16px" } }> List Layout Measure < /div></div >,
      },
      detail: {
        comp: DetailComponent as any,
        skeleton: DetailSkeleton,
        elemsCount: Math.ceil(ITEMSCOUNT / 25),
        boundNode: <div style={ { height: "300px", width: "100%", background: "#f0f0f0" } }> <div style={ { padding: "16px" } }> Detail Layout Measure < /div></div >,
      },
      compact: {
        comp: CompactComponent as any,
        skeleton: CompactSkeleton,
        elemsCount: Math.ceil(ITEMSCOUNT / 10),
        boundNode: <div style={ { height: "60px", width: "100%", background: "#f0f0f0" } }> <div style={ { padding: "16px" } }> Compact Layout Measure < /div></div >,
      },
    };
  }, []);

// Slice-based torrent function with EOF detection
  const torrent = useCallback(
    async (offset: number, size: number): Promise<TorrentData<any>[]> => {
      // Simulate network delay based on offset (deterministic)
      await new Promise((resolve) => setTimeout(resolve, 300 + (offset % 3) * 100));

      // Return empty array when offset is beyond data length (EOF signal)
      if (offset >= masterData.length) {
        return [];
      }

      // Slice the pre-computed data
      return masterData.slice(offset, offset + size);
    },
    [masterData]
  );

  return (
    <div style= {{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={ { flex: 1, background: "#fafafa" } }>
        <VirtualScroll
          torrent={ torrent }
          layout = { layouts }
          pageSize = { 25}
          isInfinite = { false}
          useCache = { true}
          cacheSize = { 500}
        />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <VirtualScrollExample  />
  );
}
```

## Example using VirtualScrollRow

```tsx
const ItemCard = React.forwardRef<HTMLDivElement, { title: string; color: string }>(
  ({ title, color }, ref) => (
    <div
      ref={ref}
      style={{
        width: 200,
        height: 150,
        background: color,
        border: '2px solid #333',
        borderRadius: 8,
        padding: 16,
        boxSizing: 'border-box',
        flex: '0 0 auto',
      }}
    >
      <h3>{title}</h3>
    </div>
  )
);
ItemCard.displayName = 'ItemCard';

const ItemSkeleton = () => (
  <div
    style={{
      width: 200,
      height: 150,
      background: '#e0e0e0',
      borderRadius: 8,
    }}
  />
);

// Title Row (fixed: 50px height, full width)
const TitleRow = React.forwardRef<HTMLDivElement, { text: string }>(
  ({ text }, ref) => (
    <div style={{height: "70px"}}>
      <div
        ref={ref}
        style={{
          height: 50,
          width: '100%',
          background: '#2c3e50',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          padding: '0 20px',
          fontSize: 18,
          fontWeight: 'bold',
        }}
      >
        {text}
      </div>
    </div>
  )
);
TitleRow.displayName = 'TitleRow';

const TitleSkeleton = () => (
  <div
    style={{
      height: 50,
      width: '100%',
      background: '#bdc3c7',
    }}
  />
);

// ==================== Mock Data & Torrent ====================

const TOTAL_ITEMS = 1000;

// Simulate mixed data: titles and regular items
const generateMixedData = () => {
  const items: Array<{ type: 'item'; title: string; color: string } | { type: 'title'; text: string }> = [];

  for (let i = 0; i < TOTAL_ITEMS; i++) {
    // Add a title every 20 items
    if (i % 20 === 0) {
      items.push({
        type: 'title' as const,
        text: `Section ${Math.floor(i / 20) + 1}`,
      });
    }

    items.push({
      type: 'item' as const,
      title: `Item ${i + 1}`,
      color: i % 2 === 0 ? '#3498db' : '#e74c3c',
    });
  }

  return items;
};

const allData = generateMixedData();

const mockTorrent = async (offset: number, size: number) => {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 450));

  const items = allData.slice(offset, offset + size);

  return items.map((item, index) => {
    if (item.type === 'title') {
      return {
        lKey: 'title',
        data: { text: item.text },
      };
    }
    return {
      lKey: 'item',
      data: { title: item.title, color: item.color },
    };
  });
};

// ==================== Usage Example ====================

export function GalleryExample() {
  return (
    <div style={{ height: '100vh', padding: 20 }}>
      <h1>VirtualScrollRow Multi-Layout Demo</h1>

      <div style={{ height: 'calc(100% - 60px)', border: '1px solid #ccc' }}>
        <VirtualScrollRow
          torrent={mockTorrent}

          layout={{
            key: 'item',
            layout: {
              comp: ItemCard,
              skeleton: ItemSkeleton,
              elemsCount: TOTAL_ITEMS,
              boundNode: (
                <div style={{ width: 200, height: 150 }}>
                  <div style={{ width: 200, height: 150, background: '#f0f0f0' }} />
                </div>
              ),
            },
          }}

          rowLayout={{
            title: {
              comp: TitleRow as any,
              skeleton: TitleSkeleton,
              elemsCount: Math.ceil(TOTAL_ITEMS / 20),
              boundNode: (
                <div style={{ height: 70, width: '100%', background: '#f0f0f0' }} />
              ),
            },
          }}

          gapX={16}
          gapY={24}
          pageSize={40}
        />
      </div>
    </div>
  );
}

function App() {
  return (
    <GalleryExample  />
);
```