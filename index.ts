import { rm, readFile } from "fs/promises";
import { join } from "path";
import hljs from "highlight.js";
import { putInSrc, Addition, myWriteFile } from "./util";
import { distFolder } from "./paths";
import { lsifParser, Lsif, findRecursiveEdge, Element } from "./lsif";
import { buildTree, TreeNode } from "./tree";
import { templatesBuilder } from "./templates/index";
import { start } from "./debug/bench";
import MarkdownIt from "markdown-it";
import { contains, Document, item, ItemEdge, ReferenceResult, Range, Id, HoverResult } from "lsif-protocol";
import { MarkupContent, MarkedString } from "vscode-languageserver-protocol";

const markdown = MarkdownIt({
  highlight: (str, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, { language: lang }).value;
      } catch (_) { }
    }

    return ''; // use external default escaping
  }
});

const treeToHtml = (tree: TreeNode[], uri: string) => {
  const path = uri.split('/');
  const f = (t: TreeNode, p: string[], k: string): string => {
    if (t.kind === 'file') {
      const c = p[0] === t.name ? ` class="current-file"` : ``;
      return `<li${c}><a href="${k}/${t.name}.html">${t.name}</a></li>`;
    }
    return `<li>${t.name}<ul>${g(t.children, p[0] === t.name ? p.slice(1) : [], `${k}/${t.name}`)}</ul></li>`;
  };
  const g = (x: TreeNode[], p: string[], k: string) => x.map((y) => f(y, p, k)).join('');
  return `<ul>${g(tree, path, '.')}</ul>`;
};

type ItemData = string;

const isContains = (x: Element): x is contains => {
  return x.label == 'contains';
};

const getItemData = (item: Range, lsif: Lsif): ItemData => {
  const { uri } = lsif.item.get(
    lsif.inV.get(item.id).filter(isContains)[0].outV
  ) as Document;
  const path = `${lsif.uriPath(uri)}.html`;
  const url = `${path}#${item.start.line + 1}`;
  return url;
};

type Hovers = {
  [s: string]: {
    content?: Id;
    definition?: Id;
    references?: Id;
  };
};

type ObjString = {
  [s: string]: Id;
};

type References = {
  [s: string]: {
    definitions: ItemData[];
    references: ItemData[];
  };
};

type MainOptions = {
  input: string;
  output: string;
  dist?: string;
  uriMap?: string;
};

const markedStringToHtml = (x: MarkedString) => {
  if (typeof x === 'string') {
    return x;
  }
  return "\n\n```" + x.language + "\n" + x.value.trim() + "\n```\n\n";
};

const hoverToHtml = (hover: MarkupContent | MarkedString | MarkedString[]) => {
  if (typeof hover === 'string' || 'language' in hover) {
    return markdown.render(markedStringToHtml(hover));
  }
  if (hover instanceof Array) {
    return markdown.render(hover.map(markedStringToHtml).join('\n\n---\n\n'));
  }
  if (hover.kind === 'markdown') {
    return markdown.render(hover.value);
  }
  if (hover.kind === 'plaintext') {
    return `<p>${hover.value}</p>`;
  }
  throw new Error("bad hover content");
};

export const main = async ({ input, output, dist, uriMap }: MainOptions) => {
  let bench = start('Reading files and cleaning');
  const lsif = await lsifParser(input, uriMap);
  const { item, uriPath, documents, srcMap, outV } = lsif;
  const templates = await templatesBuilder();
  const fileTree = buildTree(documents.map((x) => uriPath(x.uri)));
  await rm(output, { recursive: true, force: true });
  await myWriteFile(
    join(output, 'index.html'),
    templates.welcome({
      tree: treeToHtml(fileTree, 'never$#.gav'),
    }),
  );
  await myWriteFile(join(output, '_dist', 'main.css'), (await readFile(join(distFolder, 'main.css'))).toString());
  await myWriteFile(join(output, '_dist', 'main.js'), (await readFile(join(distFolder, 'main.js'))).toString());
  await myWriteFile(join(output, '.nojekyll'), '');
  bench.end();
  bench = start('Parsing lsif dump');
  const refs: Set<Id> = new Set();
  const lsifParsed = await Promise.all(documents
    .map(async (doc) => {
      const additions: Addition[] = [];
      const hovers: Hovers = {};
      const data: ObjString = {};
      const setDataLazy = (key: Id, lazy: () => string) => {
        if (key in data) return;
        data[key] = lazy();
      };
      outV.get(doc.id).forEach((edge) => {
        const path = uriPath(doc.uri);
        if (edge.label != 'contains') {
          return;
        }
        for (const id of edge.inVs) {
          const v = item.get(id) as Range;
          if (v.start.character === v.end.character && v.start.line === v.end.line) {
            continue;
          }
          let hoverContent: Id | undefined = undefined;
          let definitionPlace: Id | undefined = undefined;
          let ref = undefined;
          const defVertex = findRecursiveEdge(lsif, v.id, 'textDocument/definition');
          if (defVertex) {
            const defItemEdge = outV.get(defVertex.id)[0] as item;
            const defItem = item.get(defItemEdge.inVs[0]) as Range;
            if (defItem.id != v.id) {
              setDataLazy(defItem.id, () => getItemData(defItem, lsif));
              definitionPlace = defItem.id;
            }
          }
          const hoverVertex = findRecursiveEdge(lsif, v.id, 'textDocument/hover') as HoverResult | undefined;
          if (hoverVertex) {
            setDataLazy(hoverVertex.id, () => hoverToHtml(hoverVertex.result.contents));
            hoverContent = hoverVertex.id;
          }
          const refVertex = findRecursiveEdge(lsif, v.id, 'textDocument/references');
          if (refVertex) {
            refs.add(refVertex.id);
            ref = refVertex.id;
          }
          if (hoverContent || definitionPlace || ref) {
            hovers[`x${v.id}`] = {
              content: hoverContent,
              definition: definitionPlace,
              references: ref,
            };
            additions.push({
              position: v.start,
              text: `<span id="lsif${v.id}">`
            });
            additions.push({
              position: v.end,
              text: '</span>',
            });
          }
        }
      });
      const relPath = uriPath(doc.uri);
      const destPath = join(output, relPath);
      await myWriteFile(destPath + ".hover.json", JSON.stringify({ hovers, data }));
      return { destPath, doc, additions };
    }));
  bench.end();
  bench = start('Create find references files');
  const refFolder = join(output, '_data', 'refs');
  for (const id of refs) {
    const edge = outV.get(id) as ItemEdge<ReferenceResult, Range>[];
    const defEdge = edge.filter((x) => x.property === 'definitions');
    const refEdge = edge.filter((x) => x.property === 'references');
    await myWriteFile(`${refFolder}/${id}.json`, JSON.stringify({
      definitions: defEdge.flatMap((e) => {
        return e.inVs.map((x: Id) => {
          return getItemData(item.get(x) as Range, lsif);
        });
      }),
      references: refEdge.flatMap((e) => {
        return e.inVs.map((x: Id) => {
          return getItemData(item.get(x) as Range, lsif);
        });
      }),
    }));
  }
  bench.end();
  bench = start('Syntax highlighting');
  const highlighted = lsifParsed.map((x) => {
    const srcRaw = srcMap.raw(x.doc.uri);
    const highlighted = hljs.highlight(srcRaw, { language: x.doc.languageId }).value;
    return { ...x, highlighted };
  });
  bench.end();
  bench = start('Adding additions');
  const added = highlighted.map((x) => {
    const src = putInSrc(x.highlighted, x.additions);
    return { ...x, src };
  });
  bench.end();
  bench = start('Templating with EJS');
  const generated = added.map(({ doc, destPath, src }) => {
    const path = uriPath(doc.uri);
    const pathSplitted = path.split('/');
    const filename = pathSplitted.slice(-1)[0];
    const depth = pathSplitted.length - 1;
    const html = templates.source({
      src, filename,
      tree: treeToHtml(fileTree, path),
      distPath: dist ? dist : `_dist/`,
      basePath: `./${'../'.repeat(depth)}`,
    });
    return { html, destPath, src };
  });
  bench.end();
  bench = start('Writing generated files');
  await Promise.all(generated.map(async ({ destPath, html, src }) => {
    await myWriteFile(destPath + ".html", html);
    await myWriteFile(destPath + ".src.html", src);
  }));
  bench.end();
};
