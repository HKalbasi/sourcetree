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
  const highByLine = highlight.split('\n');
  const key = (i: any, j: any) => `${i},${j}`;
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
  return highByLine.map((hline, i) => {
    let result = "";
    let j = 0;
    while (hline != "") {
      while (hline[0] == '<') {
        while (hline[0] != '>') {
          result += hline[0];
          hline = hline.slice(1);
        }
        result += hline[0];
        hline = hline.slice(1);
      }
      result += addsInPlace(i, j);
      j += 1;
      if (hline == '') break;
      if (hline[0] == '&') {
        while (hline[0] != ';') {
          result += hline[0];
          hline = hline.slice(1);
        }
      }
      result += hline[0];
      hline = hline.slice(1);
    }
    result += addsInPlace(i, j);
    return result;
  }).join('\n');
};
