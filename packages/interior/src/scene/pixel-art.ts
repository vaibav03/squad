/** Tiny runtime pixel sprites (markers, shadow) so they obey the palette and need no files. */
export const PALETTE: Record<string, string> = {
  '0': '#070f1f', // ink
  '1': '#fff2c4', // moon
  '2': '#e0485a', // alert
  '3': '#5fcf8a', // ok
  '4': '#ffc857', // glow
  '5': '#f08a3a', // ember
  '6': '#c9d4e4', // wall-lit
};

/** '.' transparent; other chars index PALETTE. */
export const SPRITES: Record<string, string[]> = {
  'mark.alert': [
    '..000..',
    '.02220.',
    '.02220.',
    '.02220.',
    '.02220.',
    '..020..',
    '..000..',
    '.02220.',
    '.02220.',
    '..000..',
  ],
  'mark.check': [
    '.......00.',
    '......0330',
    '.....0330.',
    '0...0330..',
    '03.0330...',
    '0330330...',
    '.03330....',
    '..030.....',
    '...0......',
  ],
  'mark.wait': [
    '.00000000.',
    '0666666660',
    '0640640640',
    '0666666660',
    '.00000000.',
    '...000....',
    '....0.....',
  ],
};
