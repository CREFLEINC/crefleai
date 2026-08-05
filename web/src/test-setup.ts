import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";

// Node 22+의 실험적 localStorage 전역(--localstorage-file 미지정 시 메서드가 없음)이
// jsdom 환경에서 window.localStorage까지 가리므로, 동작하는 인메모리 구현으로 교체한다.
const store = new Map<string, string>();
const localStorageStub: Storage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => void store.set(key, String(value)),
  removeItem: (key) => void store.delete(key),
  clear: () => void store.clear(),
  key: (index) => [...store.keys()][index] ?? null,
  get length() {
    return store.size;
  },
};
Object.defineProperty(window, "localStorage", {
  value: localStorageStub,
  configurable: true,
});

beforeEach(() => localStorageStub.clear());
