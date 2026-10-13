import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { observeQuotaSkeletonColumns } from '@/features/quota/skeletonColumns';

const element = {} as HTMLElement;
let tracks: string;
const resizeCallbacks = new Set<() => void>();
const browserGlobals = ['getComputedStyle', 'ResizeObserver'] as const;
let originalGlobals: Array<PropertyDescriptor | undefined>;

beforeEach(() => {
  tracks = '200px 200px 200px 200px';
  resizeCallbacks.clear();
  originalGlobals = browserGlobals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperties(globalThis, {
    getComputedStyle: {
      configurable: true,
      value: () => ({ gridTemplateColumns: tracks }),
    },
    ResizeObserver: {
      configurable: true,
      value: class {
        constructor(private callback: () => void) {}

        observe() {
          resizeCallbacks.add(this.callback);
        }

        disconnect() {
          resizeCallbacks.delete(this.callback);
        }
      },
    },
  });
});

afterEach(() => {
  browserGlobals.forEach((key, index) => {
    const descriptor = originalGlobals[index];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  });
});

const resizeTo = (nextTracks: string) => {
  tracks = nextTracks;
  resizeCallbacks.forEach((callback) => callback());
};

describe('quota skeleton columns', () => {
  test('follows the content grid when its container shrinks and grows', () => {
    const columns: number[] = [];
    const stop = observeQuotaSkeletonColumns(element, (count) => columns.push(count));

    resizeTo('326px');
    resizeTo('180.5px 180.5px');
    resizeTo('190px 190px 190px 190px 190px');

    expect(columns).toEqual([4, 1, 2, 5]);
    stop();
  });

  test('stops updating after the loading layout is removed', () => {
    const columns: number[] = [];
    const stop = observeQuotaSkeletonColumns(element, (count) => columns.push(count));
    stop();

    resizeTo('326px');

    expect(columns).toEqual([4]);
  });
});
