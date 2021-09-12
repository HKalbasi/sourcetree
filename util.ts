import { dirname } from "path";
import { mkdir, writeFile } from "fs/promises";

export const myWriteFile = async (path: string, content: string) => {
  const folder = dirname(path);
  await mkdir(folder, { recursive: true });
  await writeFile(path, content);
};

export type Addition = {
  position: {
    line: number;
    character: number;
  };
  text: string;
};

export const putInSrc = (highlight: string, additions: Addition[]) => {
  const key = (i: number, j: number) => `${i},${j}`;
  const additionMap = new Map();
  const addsInPlace = (i: number, j: number) => {
    const a = additionMap.get(key(i, j));
    if (a) {
      return a.join('');
    }
    return '';
  };
  additions.forEach((add) => {
    const p = add.position;
    const k = key(p.line, p.character);
    let cur = additionMap.get(k) ?? [];
    additionMap.set(k, cur);
    cur.push(add.text);
  });
  let result = "";
  let i = 0;
  let j = 0;
  let hline = highlight;
  let p = 0;
  while (p < hline.length) {
    while (hline[p] == '<') {
      while (hline[p] != '>') {
        result += hline[p];
        p += 1;
      }
      result += hline[p];
      p += 1;
    }
    result += addsInPlace(i, j);
    j += 1;
    if (p >= hline.length) break;
    if (hline[p] == '\n') {
      result += hline[p];
      p += 1;
      j = 0;
      i += 1;
      continue;  
    }
    if (hline[p] == '&') {
      while (hline[p] != ';') {
        result += hline[p];
        p += 1;
      }
    }
    result += hline[p];
    p += 1;
  }
  result += addsInPlace(i, j);
  return result;
};
