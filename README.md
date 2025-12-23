# react-optimized-scroll

A small, high-performance **virtualized scroll** React component with async loading. It fetches only the visible slice of items (plus a small buffer), measures the item height automatically and provides simple sticky loading indicators for top/bottom fetches.

## Features

* Virtualizes large lists to reduce DOM nodes
* Async data fetching via a `torrent(offset, size)` callback
* Optional custom loading component and scroll-direction-aware indicators

## Install

```bash
npm install react-optimized-scroll
# or
yarn add react-optimized-scroll
```

## Example of usage

```tsx
import React, { forwardRef } from "react";
import { OptimizedScroll } from "react-optimized-scroll";

// Define the item shape
type TodoWrapProps = { id: number; text: string };

// Create an item component that wraps your assumed TodoComponent, should accept a forwarded ref
const TodoWrap = forwardRef<HTMLDivElement, TodoWrapProps>(({ id, text }, ref) => (
  <div
    ref={ref}
    style={{
      height: 64,
      boxSizing: "border-box",
      padding: "12px",
      borderBottom: "1px solid #eee",
      display: "flex",
      alignItems: "center"
    }}
  >
    <strong style={{ width: 48 }}>{id}</strong>
    <div>{text}</div>
  </div>
));
TodoWrap.displayName = "TodoWrap";

// A fake async data provider
const fakeTorrent = async (offset: number, size: number): Promise<TodoWrapProps[]> => {
  // simulate network latency
  await new Promise((r) => setTimeout(r, 250));

  return Array.from({ length: size }).map((_, i) => ({
    id: offset + i,
    text: `Item ${offset + i}`,
  }));
};

// Use OptimizedScroll in a container with a fixed height
export default function App() {
  return (
    <div style={{ height: 600, border: "1px solid #ddd" }}>
      <OptimizedScroll<TodoWrapProps, HTMLDivElement>
        torrent={fakeTorrent}
        elemCount={10000}
        comp={TodoWrap}
        loadingComponent={<div style={{ padding: 8 }}>Loading…</div>}
        loadingThreshold={10}
      />
    </div>
  );
}
```

**Notes:**

* The parent container must have a fixed height (or constrained height) so the internal container can set `overflow` and measure scroll offset. In many layouts this is the element that wraps `OptimizedScroll`.
* The item component should have a fixed `height` for best measurement. The component measures the first rendered item via `ref` to determine `relemHeight`.

## Props / API

```ts
interface OptimizedScrollProps<T, R extends HTMLElement = HTMLElement> {
  torrent: (offset: number, size: number) => Promise<T[]>; // fetcher
  elemCount: number; // total number of items in the list
  comp: React.ForwardRefExoticComponent<T & React.RefAttributes<R>>; // item component
  loadingComponent?: React.ReactNode; // optional loading UI
  loadingThreshold?: number; // pixels of scroll change to flip 'up'/'down'
}
```

* `torrent(offset, size)` should return a `Promise` resolving to an array of `T` of length `<= size`.
* `elemCount` is the total number of items available on the `server` (or the total count you want to virtualize).

## Troubleshooting

* **Item measurement always zero**: Ensure the parent wrapper is visible and has non-zero height when `OptimizedScroll` mounts. If your item uses images or async content to grow, consider a fixed height or compute height externally.
* **Component not re-rendering or flickering**: Avoid returning different component references on every render for the `comp` prop. Define the item component once (e.g. outside of render) and pass that reference.