import { writeFile, readFile, rm, mkdir } from "fs/promises";
import { dirname, join, relative } from "path";
import ejs from "ejs";
import hljs from "highlight.js";
import { putInSrc, Addition, myWriteFile } from "./util";
import fsExtra from "fs-extra";
import { distFolder } from "./paths";
import { lsifParser, Lsif } from "./lsif";
import { buildTree, TreeNode } from "./tree";
import { templatesBuilder } from "./templates/index";

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

const htmlOfContent = (uri: string, v: any, content: any[], goto: any, ref: any) => {
  if (!content) content = [];
  const buttons = [
    goto ? `<a href="${goto}" class="button">Go to definition</a>` : '',
    ref ? `<a onclick="searchText('#lsif${v.id}')" class="button">Find all references</a>` : '',
  ];
  return `<div style="white-space:normal">${content.map((c) => {
    if (typeof c === 'string') return `<p>${c}</p>`;
    if (c.language) {
      return `<pre>${c.value}</pre>`;
    }
  }).join('')}<div>${buttons.join('')}</div></div>`;
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

const escapeBacktick = (x: string) => x.replaceAll('`', '\\`').replaceAll('${', '\\${');

type Hover = {

};

type References = {
  [s: string]: {
    definition: ItemData;
    references: ItemData[];
  };
};

const main = async () => {
  const lsif = await lsifParser("dump.lsif");
  const { map, outVMap, projectRoot, documents, srcMap } = lsif;
  const templates = await templatesBuilder();
  const outputPath = "out";
  const fileTree = buildTree(projectRoot, documents.map((x) => x.uri));
  await rm(outputPath, { recursive: true, force: true });
  await myWriteFile(
    join(outputPath, 'index.html'),
    templates.welcome({
      tree: treeToHtml(fileTree, projectRoot, join(projectRoot, 'never$#.gav')),
    }),
  );
  await fsExtra.copy(distFolder, join(outputPath, '$dist'));
  await myWriteFile(join(outputPath, '.nojekyll'), '');
  const lsifParsed = documents
    .filter((doc) => doc.uri.startsWith(projectRoot))
    .map((doc) => {
      const additions: Addition[] = [];
      const hovers: Hover[] = [];
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
          let hoverContent = null;
          let definitionPlace = null;
          let ref = null;
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
                  const goalDoc = map.get(e.document);
                  return e.inVs.map((x: string) => map.get(x)).map((defItem: string) => {
                    return getItemData(defItem, lsif, doc.uri);
                  });
                })
              };
            }
          }
          if (hoverContent || definitionPlace) {
            hovers.push({
              id: v.id,
              content: escapeBacktick(htmlOfContent(
                doc.uri, v, hoverContent, definitionPlace, ref
              )), 
            });
          }
          if (ref) {
            references[`x${v.id}`] = ref;
          }
        }
      });
      return { doc, additions, hovers, references };
    });
  await Promise.all(lsifParsed.map(async ({ doc, additions, hovers, references }) => {
    const srcRaw = unwrap(srcMap.raw.get(doc.uri));
    const depth = doc.uri.slice(projectRoot.length).split('/').length - 2;
    const relPath = relative(projectRoot, doc.uri);
    const srcHighlighted = hljs.highlight(srcRaw, { language: doc.languageId }).value;
    const src = putInSrc(srcHighlighted, additions);
    const destPath = join(outputPath, relPath);
    await myWriteFile(
      destPath + ".html",
      templates.source({
        src, hovers,
        tree: treeToHtml(fileTree, projectRoot, doc.uri),
        distPath: `${'../'.repeat(depth)}$dist/`,
      }),
    );
    await myWriteFile(destPath + ".lazy.json", JSON.stringify({ references }));
  }));
};

main();
