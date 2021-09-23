import { rm } from "fs/promises";
import { join, relative } from "path";
import hljs from "highlight.js";
import { putInSrc, Addition, myWriteFile } from "./util";
import fsExtra from "fs-extra";
import { distFolder } from "./paths";
import { lsifParser, Lsif, findRecursiveEdge, Element } from "./lsif";
import { buildTree, TreeNode } from "./tree";
import { templatesBuilder } from "./templates/index";
import { start } from "./debug/bench";
import MarkdownIt from "markdown-it";
import { contains, Document, item, ItemEdge, ReferenceResult, Range, Id, HoverResult } from "lsif-protocol";
import { MarkupContent, MarkedString, Position } from "vscode-languageserver-protocol";
import { HtmlValidate } from "html-validate";
import { isEnabled } from "./debug/flags";

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

const myRelative = (path1: string, path2: string) => {
  if (path1 == path2) return '';
  const s1 = path1.split('/');
  const s2 = path2.split('/');
  let i = 0;
  while (s1[i] == s2[i]) i += 1;
  const k1 = s1.slice(i);
  const k2 = s2.slice(i);
  return `./${'../'.repeat(k1.length - 1)}${k2.join('/')}`;
};

const treeToHtml = (tree: TreeNode[], uri: string) => {
  const path = uri.split('/');
  const pre = '../'.repeat(path.length - 1);
  const f = (t: TreeNode, p: string[], k: string): string => {
    if (t.kind === 'file') {
      const c = p[0] === t.name ? ` class="current-file"` : ``;
      return `<li${c}><a href="${pre}${k}/${t.name}.html">${t.name}</a></li>`;
    }
    return `<li>${t.name}<ul>${g(t.children, p[0] === t.name ? p.slice(1) : [], `${k}/${t.name}`)}</ul></li>`;
  };
  const g = (x: TreeNode[], p: string[], k: string) => x.map((y) => f(y, p, k)).join('');
  return `<ul>${g(tree, path, '.')}</ul>`;
};

type ItemData = {
  filename: string;
  url: string;
  position: {
    start: Position;
    end: Position;
  };
  srcLine: string;
};

const isContains = (x: Element): x is contains => {
  return x.label == 'contains';
};

const getItemData = (item: Range, lsif: Lsif, currentPath: string): ItemData => {
  const position = {
    start: item.start,
    end: item.end,
  };
  const { uri } = lsif.item.get(
    lsif.inV.get(item.id).filter(isContains)[0].outV
  ) as Document;
  const path = lsif.uriPath(uri);
  let relPath = currentPath === path ? '' : `${myRelative(currentPath, path)}.html`;
  const url = `${relPath}#${item.start.line + 1}`;
  const filename: string = path.split('/').slice(-1)[0];
  const srcLine = lsif.srcMap.lineSplitted(uri)[item.start.line];
  return { filename, url, position, srcLine };
};

type Hovers = {
  [s: string]: {
    content?: Id;
    definition?: Id;
    references: boolean;
  };
};

type ObjString = {
  [s: string]: string;
};

type References = {
  [s: string]: {
    definition: ItemData;
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

const htmlValidate = new HtmlValidate();

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
  await fsExtra.copy(distFolder, join(output, '_dist'));
  await myWriteFile(join(output, '.nojekyll'), '');
  bench.end();
  bench = start('Parsing lsif dump');
  const lsifParsed = documents
    .map((doc) => {
      const additions: Addition[] = [];
      const hovers: Hovers = {};
      const data: ObjString = {};
      const setDataLazy = (key: Id, lazy: () => string) => {
        if (key in data) return;
        data[key] = lazy();
      };
      const references: References = {};
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
          additions.push({
            position: v.start,
            text: `<span id="lsif${v.id}">`
          });
          additions.push({
            position: v.end,
            text: '</span>',
          });
          let hoverContent: Id | undefined = undefined;
          let definitionPlace: Id | undefined = undefined;
          let ref = undefined;
          const defVertex = findRecursiveEdge(lsif, v.id, 'textDocument/definition');
          if (defVertex) {
            const defItemEdge = outV.get(defVertex.id)[0] as item;
            const defItem = item.get(defItemEdge.inVs[0]) as Range;
            if (defItem.id != v.id) {
              setDataLazy(defItem.id, () => getItemData(defItem, lsif, path).url);
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
            const edge = outV.get(refVertex.id) as ItemEdge<ReferenceResult, Range>[];
            const defEdge = edge.filter((x) => x.property === 'definitions');
            if (defEdge.length == 0) continue;
            const defItem = item.get(defEdge[0].inVs[0]) as Range;
            const refEdge = edge.filter((x) => x.property !== 'definitions');
            ref = {
              definition: getItemData(defItem, lsif, path),
              references: refEdge.flatMap((e) => {
                return e.inVs.map((x: Id) => item.get(x)).map((defItem: Element) => {
                  return getItemData(defItem as Range, lsif, path);
                });
              })
            };
          }
          if (hoverContent || definitionPlace) {
            hovers[`x${v.id}`] = {
              content: hoverContent,
              definition: definitionPlace,
              references: ref !== undefined,
            };
          }
          if (ref) {
            references[`x${v.id}`] = ref;
          }
        }
      });
      return { doc, additions, hovers, references, data };
    });
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
  const generated = added.map(({ doc, hovers, references, src, data }) => {
    const path = uriPath(doc.uri);
    const pathSplitted = path.split('/');
    const filename = pathSplitted.slice(-1)[0];
    const depth = pathSplitted.length - 1;
    const html = templates.source({
      src, filename,
      tree: treeToHtml(fileTree, path),
      distPath: dist ? dist : `${'../'.repeat(depth)}_dist/`,
    });
    return { doc, html, hovers, references, data };
  });
  bench.end();
  bench = start('Writing generated files');
  await Promise.all(generated.map(async ({ doc, html, hovers, references, data }) => {
    const relPath = uriPath(doc.uri);
    const destPath = join(output, relPath);
    await myWriteFile(destPath + ".html", html);
    if (isEnabled('check')) {
      const report = htmlValidate.validateFile(destPath + ".html");
      console.log("valid", report.valid);
      if (!report.valid) {
        console.log(report.results);
        process.exit(0);
      }
    }
    await myWriteFile(destPath + ".ref.json", JSON.stringify({ references }));
    await myWriteFile(destPath + ".hover.json", JSON.stringify({ hovers, data }));
  }));
  bench.end();
};
