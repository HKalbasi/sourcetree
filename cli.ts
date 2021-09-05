#!/usr/bin/env node
import { program } from "commander";
import { main, CliOptions } from "./index";

program
  .option('-i, --input <file>', 'lsif dump path', 'dump.lsif')
  .option('-o, --output <file>', 'output folder for generated files', 'out');

const cli = async () => {
  program.parse(process.argv);
  const options: CliOptions = program.opts();
  main(options);
};

cli();
