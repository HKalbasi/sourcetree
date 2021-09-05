import ejs from "ejs";
import { templateFolder } from "../paths";
import { readFile } from "fs/promises";
import { join } from "path";

const c = async (name: string) => {
  return ejs.compile((await readFile(join(templateFolder, name))).toString());
};

export const templatesBuilder = async () => {
  return {
    source: await c('source.ejs'),
    welcome: await c('welcome.ejs'),
  };
};
