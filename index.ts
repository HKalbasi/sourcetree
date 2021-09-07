import { rm } from "fs/promises";
import { join, relative } from "path";
import hljs from "highlight.js";
import { putInSrc, Addition, myWriteFile } from "./util";
import fsExtra from "fs-extra";
import { distFolder } from "./paths";
import { lsifParser, Lsif } from "./lsif";
import { buildTree, TreeNode } from "./tree";
import { templatesBuilder } from "./templates/index";
import { start } from "./debug/bench";

function unwrap<T>(x: T | undefined) {
  if (x === undefined) throw new Error('unwrap failed');
  return x;
};

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
  const g = (x: TreeNode[], p: string[], k: string) => x.map((y)=>f(y, p, k)).join('');
  return `<ul>${g(tree, path, '.')}</ul>`;
};

type ItemData = {
  filename: string;
  url: string;
  position: any;
  srcLine: string;
};

const getItemData = (item: any, lsif: Lsif, currentUri: string): ItemData => {
  const position = {
    start: item.start,
    end: item.end,
  };
  const { uri } = lsif.map.get(
    lsif.inVMap.get(item.id)?.filter((x) => x.label == 'contains')[0].outV
  );
  let relPath = currentUri == uri ? '' : `${myRelative(currentUri, uri)}.html`;
  const url = `${relPath}#${item.start.line+1}`;
  const filename: string = uri.split('/').slice(-1)[0];
  const srcLine = (lsif.srcMap.lineSplitted.get(uri) as string[])[item.start.line];
  return { filename, url, position, srcLine };
};

type Hovers = {
  [s: string]: {
    content: any;
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
};

export const main = async ({ input, output }: MainOptions) => {
  let bench = start('Reading files and cleaning');
  const lsif = await lsifParser(input);
  const { map, outVMap, projectRoot, documents, srcMap } = lsif;
  const templates = await templatesBuilder();
  const fileTree = buildTree(projectRoot, documents.map((x) => x.uri));
  await rm(output, { recursive: true, force: true });
  await myWriteFile(
    join(output, 'index.html'),
    templates.welcome({
      tree: treeToHtml(fileTree, projectRoot, join(projectRoot, 'never$#.gav')),
    }),
  );
  await fsExtra.copy(distFolder, join(output, '$dist'));
  await myWriteFile(join(output, '.nojekyll'), '');
  bench.end();
  bench = start('Parsing lsif dump');
  const lsifParsed = documents
    .filter((doc) => doc.uri.startsWith(projectRoot))
    .map((doc) => {
      const additions: Addition[] = [];
      const hovers: Hovers = {};
      const references: References = {};
      unwrap(outVMap.get(doc.id)).forEach((edge) => {
        if (edge.label != 'contains') {
          return;
        }
        for (const id of edge.inVs) {
          const v = map.get(id);
          if (v.start.character === v.end.character && v.start.line === v.end.line) {
            continue;
          }
          if (outVMap.get(v.id)?.length != 1) return;
          const resultSet = map.get(unwrap(outVMap.get(v.id))[0].inV);
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
          for (const query of unwrap(outVMap.get(resultSet.id))) {
            if (query.label == 'textDocument/definition') {
              const defResult = map.get(query.inV);
              const defEdge = unwrap(outVMap.get(defResult.id))[0];
              const defItem = map.get(defEdge.inVs[0]);
              if (defItem.id == v.id) {
                continue;
              }
              const goalDoc = map.get(defEdge.document);
              let relPath = doc.uri == goalDoc.uri ? '' : `${myRelative(doc.uri, goalDoc.uri)}.html`;
              definitionPlace = `${relPath}#${defItem.start.line+1}`;
            }
            if (query.label == 'textDocument/hover') {
              const defResult = map.get(query.inV);
              hoverContent = defResult.result.contents;
            }
            if (query.label == 'textDocument/references') {
              const result = map.get(query.inV);
              const edge = unwrap(outVMap.get(result.id));
              const defEdge = edge.filter((x) => x.property === 'definitions');
              if (defEdge.length == 0) continue;
              const defItem = map.get(defEdge[0].inVs[0]);
              const goalDoc = map.get(defEdge[0].document);
              const refEdge = edge.filter((x) => x.property !== 'definitions');
              ref = {
                definition: getItemData(defItem, lsif, doc.uri),
                references: refEdge.flatMap((e) => {
                  return e.inVs.map((x: string) => map.get(x)).map((defItem: string) => {
                    return getItemData(defItem, lsif, doc.uri);
                  });
                })
              };
            }
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
    const srcRaw = unwrap(srcMap.raw.get(x.doc.uri));
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
      distPath: `${'../'.repeat(depth)}$dist/`,
    });
    return { doc, html, hovers, references };
  });
  bench.end();
  bench = start('Writing generated files');
  await Promise.all(generated.map(async ({ doc, html, hovers, references }) => {
    const relPath = relative(projectRoot, doc.uri);
    const destPath = join(output, relPath);
    await myWriteFile(destPath + ".html", html);
    await myWriteFile(destPath + ".ref.json", JSON.stringify({ references }));
    await myWriteFile(destPath + ".hover.json", JSON.stringify({ hovers }));
  }));
  bench.end();
};
