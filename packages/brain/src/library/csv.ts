/** Small RFC 4180 reader: quoted fields, doubled quotes, CRLF/LF, embedded newlines in quotes. */
export function parseCsv(text: string): {
  rows: string[][];
  lines: number[];
  unterminated: boolean;
} {
  const src = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  const lines: number[] = []; // 1-based source line where each row starts
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  let any = false;
  const endRow = () => {
    row.push(field);
    field = '';
    if (!(row.length === 1 && row[0]!.trim() === '')) {
      rows.push(row);
      lines.push(rowLine);
    }
    row = [];
    any = false;
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (!any) {
      rowLine = line;
      any = true;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      if (src[i + 1] === '\n') i++;
      endRow();
      line++;
    } else if (ch === '\n') {
      endRow();
      line++;
    } else field += ch;
  }
  if (any || field !== '' || row.length > 0) endRow();
  return { rows, lines, unterminated: quoted };
}
