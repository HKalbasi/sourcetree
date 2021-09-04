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
      const a = additionMap.get(key(i, j));
      if (a) {
        result += a.join('');
        //console.log(i, j, a);
      }
      j += 1;
      if (hline[0] == '&') {
        while (hline[0] != ';') {
          result += hline[0];
          hline = hline.slice(1);
        }
      }
      result += hline[0];
      hline = hline.slice(1);
    }
    return result;
  }).join('\n');
};
