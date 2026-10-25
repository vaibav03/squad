import type { ReactNode } from 'react';

/** Matches the web-shell gallery's `GalleryStory` shape (docs/web-api.md). */
export interface GalleryStory {
  id: string;
  title: string;
  render: () => ReactNode;
}
