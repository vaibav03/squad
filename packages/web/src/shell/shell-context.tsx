import { createContext, useContext, type ReactNode } from 'react';

export interface ShellApi {
  setTitle: (title: string) => void;
  setActions: (actions: ReactNode) => void;
  setFullBleed: (v: boolean) => void;
}
const noop = () => {};
export const ShellContext = createContext<ShellApi>({ setTitle: noop, setActions: noop, setFullBleed: noop });
export const useShell = (): ShellApi => useContext(ShellContext);
