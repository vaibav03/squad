/** Composed pixel props (assets/pixel/composed/props) as URLs, with native sizes for integer scaling. */
export interface PropArt {
  url: string;
  w: number;
  h: number;
}
export const propArt = {
  board: { url: new URL('../../../../../assets/pixel/composed/props/signpost-board.png', import.meta.url).href, w: 32, h: 28 },
  van: { url: new URL('../../../../../assets/pixel/composed/props/van.png', import.meta.url).href, w: 128, h: 40 },
  books: { url: new URL('../../../../../assets/pixel/composed/props/books.png', import.meta.url).href, w: 15, h: 9 },
  chalkboard: { url: new URL('../../../../../assets/pixel/composed/props/chalkboard.png', import.meta.url).href, w: 48, h: 32 },
  mailbox: { url: new URL('../../../../../assets/pixel/composed/props/mailbox.png', import.meta.url).href, w: 14, h: 22 },
  map: { url: new URL('../../../../../assets/pixel/composed/props/map.png', import.meta.url).href, w: 13, h: 8 },
  lamp: { url: new URL('../../../../../assets/pixel/composed/props/lamp-post-lit.png', import.meta.url).href, w: 16, h: 40 },
} satisfies Record<string, PropArt>;
export type PropName = keyof typeof propArt;
