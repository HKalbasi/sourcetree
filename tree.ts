export type TreeNode = { name: string } & ({
  kind: 'folder',
  children: TreeNode[],
} | {
  kind: 'file',
});

export const buildTree = (projectRoot: string, list: string[]) => {
  const tree: TreeNode[] = [];
  const getFolder = (path: string[], t = tree) => {
    for (const p of path) {
      let f = t.find((x) => x.name === p);
      if (!f) {
        f = {
          name: p,
          kind: 'folder',
          children: [],
        };
        t.push(f);
      }
      if (f.kind === 'file') {
        throw new Error("Folder and file with same name");
      }
      t = f.children;
    }
    return t;
  }
  list
    .filter((x) => x.startsWith(projectRoot))
    .map((x) => x.slice(projectRoot.length + 1))
    .forEach((x) => {
      let sx = x.split('/');
      const folder = getFolder(sx.slice(0, -1));
      folder.push({
        kind: 'file',
        name: sx[sx.length - 1],
      });
    });
  return tree;
};
