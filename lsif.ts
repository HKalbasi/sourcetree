import { readFile } from "fs/promises";
import { MetaData, Vertex, Edge, Id, Document, next } from "lsif-protocol";

export type Element = Vertex | Edge;

type SafeMap<A, B> = {
  get: (x: A) => B,
  have: (x: A) => boolean,
};

export type Lsif = {
  items: Element[];
  item: SafeMap<Id, Element>;
  inV: SafeMap<Id, Element[]>;
  outV: SafeMap<Id, Element[]>;
  projectRoot: string;
  documents: Document[];
  srcMap: {
    raw: (x: string) => string;
    lineSplitted: (x: string) => string[];
  };
};


const parseMultiLineJs = (a: string) =>
  a
    .split("\n")
    .filter((x) => x != "")
    .map((x) => JSON.parse(x));

const getVertexWithLabel = (a: Element[], label: string) =>
  a.filter((x) => x.type == "vertex" && x.label == label);

const getEdgeWithLabel = (a: Element[], label: string) =>
  a.filter((x) => x.type == "edge" && x.label == label) as Edge[];

const buildItemMap = (items: Element[]) => {
  const result: Map<Id, Element> = new Map();
  items.forEach((item) => {
    result.set(item.id, item);
  });
  return result;
};

const buildInVMap = (items: Element[]) => {
  const result: Map<Id, Element[]> = new Map();
  const insert = (x: Element, id: Id) => {
    let cur = result.get(id) ?? [];
    result.set(id, cur);
    cur.push(x);
  };
  items.forEach((item: Element) => {
    if (item.type != 'edge') {
      return;
    }
    if ('inV' in item) insert(item, item.inV);
    if ('inVs' in item) item.inVs.forEach((id: Id) => insert(item, id));
  });
  return result;
};


const buildOutVMap = (items: Element[]) => {
  const result: Map<Id, Element[]> = new Map();
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

function getFromMap<A, B>(map: Map<A, B>): SafeMap<A, B> {
  return {
    get: (id: A) => {
      const x = map.get(id);
      if (!x) throw new Error(`map doesn't have ${id}`);
      return x;
    },
    have: (id: A) => map.get(id) !== undefined,
  };
}

const buildSrcMap = async (documents: Document[]) => {
  const raw: Map<string, string> = new Map();
  const lineSplitted: Map<string, string[]> = new Map();
  await Promise.all(documents.map(async (doc) => {
    const srcRaw = (await readFile(doc.uri.slice(7))).toString();
    raw.set(doc.uri, srcRaw);
    lineSplitted.set(doc.uri, srcRaw.split('\n'));
  }));
  return { raw: getFromMap(raw).get, lineSplitted: getFromMap(lineSplitted).get };
};

export const lsifParser = async (address: string): Promise<Lsif> => {
  const text = (await readFile(address)).toString();
  const items: Element[] = parseMultiLineJs(text);
  const item = getFromMap(buildItemMap(items));
  const inV = getFromMap(buildInVMap(items));
  const outV = getFromMap(buildOutVMap(items));
  const { projectRoot } = getVertexWithLabel(items, "metaData")[0] as MetaData;
  const documents = getVertexWithLabel(items, "document") as Document[];
  const srcMap = await buildSrcMap(documents);
  return {
    items, item, inV, outV, projectRoot, documents, srcMap,
  };
};

export const findRecursiveEdge = (lsif: Lsif, v: Id, label: string) => {
  const { outV, item } = lsif;
  for (; ;) {
    if (!outV.have(v)) return;
    const out = outV.get(v);
    const direct = getEdgeWithLabel(out, label).filter(Edge.is11);
    if (direct.length > 0) return item.get(direct[0].inV);
    const next = getEdgeWithLabel(out, 'next') as next[];
    if (next.length == 0) return;
    v = next[0].inV;
  }
};
