import { join, dirname } from "path";
export const rootFolder = __dirname;//dirname(new URL(import.meta.url).pathname);
export const distFolder = join(rootFolder, 'dist');
export const templateFolder = join(rootFolder, 'templates');
