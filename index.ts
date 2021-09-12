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

const treeToHtml = (tree: TreeNode[], projectRoot: string, uri: string) => {
  const path = uri.slice(projectRoot.length + 1).split('/');
  const pre = '../'.repeat(path.length - 1);
  const f = (t: TreeNode, p: string[], k: string): string => {
    if (t.kind === 'file') {
      const c = p[0] === t.name ? ` class="current-file"` : ``;
      return `<li${c}><a href="${pre}${k}/${t.name}.html">${t.name}</a></li>`;
    }
    return `<li>${t.name}<ul>${g(t.children, p.slice(1), `${k}/${t.name}`)}</ul></li>`;
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

const getItemData = (item: Range, lsif: Lsif, currentUri: string): ItemData => {
  const position = {
    start: item.start,
    end: item.end,
  };
  const { uri } = lsif.item.get(
    lsif.inV.get(item.id).filter(isContains)[0].outV
  ) as Document;
  let relPath = currentUri == uri ? '' : `${myRelative(currentUri, uri)}.html`;
  const url = `${relPath}#${item.start.line + 1}`;
  const filename: string = uri.split('/').slice(-1)[0];
  const srcLine = lsif.srcMap.lineSplitted(uri)[item.start.line];
  return { filename, url, position, srcLine };
};

type Hovers = {
  [s: string]: {
    content?: string;
    definition?: string;
    references: boolean;
  };
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

export const main = async ({ input, output, dist }: MainOptions) => {
  let bench = start('Reading files and cleaning');
  const lsif = await lsifParser(input);
  const { item, projectRoot, documents, srcMap, outV } = lsif;
  const templates = await templatesBuilder();
  const fileTree = buildTree(projectRoot, documents.map((x) => x.uri));
  await rm(output, { recursive: true, force: true });
  await myWriteFile(
    join(output, 'index.html'),
    templates.welcome({
      tree: treeToHtml(fileTree, projectRoot, join(projectRoot, 'never$#.gav')),
    }),
  );
  await fsExtra.copy(distFolder, join(output, '_dist'));
  await myWriteFile(join(output, '.nojekyll'), '');
  bench.end();
  bench = start('Parsing lsif dump');
  const lsifParsed = documents
    .filter((doc) => doc.uri.startsWith(projectRoot))
    .map((doc) => {
      const additions: Addition[] = [];
      const hovers: Hovers = {};
      const references: References = {};
      outV.get(doc.id).forEach((edge) => {
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
          let hoverContent = undefined;
          let definitionPlace = undefined;
          let ref = undefined;
          const defVertex = findRecursiveEdge(lsif, v.id, 'textDocument/definition');
          if (defVertex) {
            const defItemEdge = outV.get(defVertex.id)[0] as item;
            const defItem = item.get(defItemEdge.inVs[0]) as Range;
            if (defItem.id != v.id) {
              definitionPlace = getItemData(defItem, lsif, doc.uri).url;
            }
          }
          const hoverVertex = findRecursiveEdge(lsif, v.id, 'textDocument/hover') as HoverResult | undefined;
          if (hoverVertex) {
            hoverContent = hoverToHtml(hoverVertex.result.contents);
          }
          const refVertex = findRecursiveEdge(lsif, v.id, 'textDocument/references');
          if (refVertex) {
            const edge = outV.get(refVertex.id) as ItemEdge<ReferenceResult, Range>[];
            const defEdge = edge.filter((x) => x.property === 'definitions');
            if (defEdge.length == 0) continue;
            const defItem = item.get(defEdge[0].inVs[0]) as Range;
            const refEdge = edge.filter((x) => x.property !== 'definitions');
            ref = {
              definition: getItemData(defItem, lsif, doc.uri),
              references: refEdge.flatMap((e) => {
                return e.inVs.map((x: Id) => item.get(x)).map((defItem: Element) => {
                  return getItemData(defItem as Range, lsif, doc.uri);
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
      return { doc, additions, hovers, references };
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
  const added = highlighted.map(({ doc, additions, hovers, references, highlighted }) => {
    const src = putInSrc(highlighted, additions);
    return { doc, hovers, references, src };
  });
  bench.end();
  bench = start('Templating with EJS');
  const generated = added.map(({ doc, hovers, references, src }) => {
    const depth = doc.uri.slice(projectRoot.length).split('/').length - 2;
    const html = templates.source({
      src,
      tree: treeToHtml(fileTree, projectRoot, doc.uri),
      distPath: dist ? dist : `${'../'.repeat(depth)}_dist/`,
    });
    return { doc, html, hovers, references };
  });
  bench.end();
  bench = start('Writing generated files');
  await Promise.all(generated.map(async ({ doc, html, hovers, references }) => {
    const relPath = relative(projectRoot, doc.uri);
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
    await myWriteFile(destPath + ".hover.json", JSON.stringify({ hovers }));
  }));
  bench.end();
};
