import type { IconName } from '../primitives/icon-names';
import type { ReactNode } from 'react';

export interface NavItem {
  key: string;
  label: string;
  to: string;
  icon: IconName;
  order: number;
  primary?: boolean;
}

export interface LabMeta {
  /** no leading slash; start with "__" */
  path: string;
  title: string;
  description?: string;
}

export interface GalleryStory {
  id: string;
  title: string;
  render: () => ReactNode;
}

export interface SquadRouteMeta {
  key: string;
  path: string;
  title: string;
  nav?: { label: string; icon: IconName; order: number; primary?: boolean };
  fullBleed?: boolean;
  public?: boolean;
}

export interface SquadConfig {
  hubUrl: string | null;
  token: string | null;
  userId: string | null;
  mode: 'live' | 'replay' | 'mock';
}

export interface SquadSession {
  userId: string;
  name: string;
  token: string;
  avatarUrl?: string;
  /** True when `token` is a real hub bearer token (dev-login). Demo sessions have no live token. */
  live?: boolean;
}
