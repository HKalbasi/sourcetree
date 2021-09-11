import { readFile } from "fs/promises";

export type LsifId = number | string;

export type Lsif = {
  items: any[];
  map: Map<LsifId, any>;
  inVMap: Map<LsifId, any[]>;
  outVMap: Map<LsifId, any[]>;
  projectRoot: string;
  documents: any[];
  srcMap: {
      raw: Map<string, string>;
      lineSplitted: Map<string, string[]>;
  };
};


const parseMultiLineJs = (a: string) =>
  a
    .split("\n")
    .filter((x) => x != "")
    .map((x) => JSON.parse(x));

const getVertexWithLabel = (a: any[], label: string) =>
  a.filter((x) => x.type == "vertex" && x.label == label);

const getEdgeWithLabel = (a: any[], label: string) =>
  a.filter((x) => x.type == "edge" && x.label == label);

const buildItemMap = (items: any[]) => {
  const result: Map<LsifId, any> = new Map();
  items.forEach((item) => {
    result.set(item.id, item);
  });
  return result;
};

const buildInVMap = (items: any[]) => {
  const result: Map<LsifId, any[]> = new Map();
  const insert = (x: any, id: string) => {
    let cur = result.get(id) ?? [];
    result.set(id, cur);
    cur.push(x);
  };
  items.forEach((item) => {
    if (item.type != 'edge') {
      return;
    }
    if (item.inV) insert(item, item.inV);
    if (item.inVs) item.inVs.forEach((id: string)=>insert(item, id));
  });
  return result;
};


const buildOutVMap = (items: any[]) => {
  const result: Map<LsifId, any[]> = new Map();
  items.forEach((item) => {
    if (item.type != 'edge' || !item.outV) {
      return;
    }
    let cur = result.get(item.outV) ?? [];
    result.set(item.outV, cur);
    cur.push(item);
  });
  return result;
};

const buildSrcMap = async (documents: any[]) => {
  const raw: Map<string, string> = new Map();
  const lineSplitted: Map<string, string[]> = new Map();
  await Promise.all(documents.map(async (doc) => {
    const srcRaw = (await readFile(doc.uri.slice(7))).toString();
    raw.set(doc.uri, srcRaw);
    lineSplitted.set(doc.uri, srcRaw.split('\n'));
  }));
  return { raw, lineSplitted };
};

export const lsifParser = async (address: string): Promise<Lsif> => {
  const text = (await readFile(address)).toString();
  const items = parseMultiLineJs(text);
  const map = buildItemMap(items);
  const inVMap = buildInVMap(items);
  const outVMap = buildOutVMap(items);
  const { projectRoot } = getVertexWithLabel(items, "metaData")[0];
  const documents = getVertexWithLabel(items, "document");
  const srcMap = await buildSrcMap(documents);
  return {
    items, map, inVMap, outVMap, projectRoot, documents, srcMap,
  };
};

export const findRecursiveEdge = (lsif: Lsif, v: LsifId, label: string) => {
  const { outVMap, map } = lsif;
  for (;;) {
    const out = outVMap.get(v);
    if (!out) return;
    const direct = getEdgeWithLabel(out, label);
    if (direct.length > 0) return map.get(direct[0].inV);
    const next = getEdgeWithLabel(out, 'next');
    if (next.length == 0) return;
    v = next[0].inV;
  }
};
