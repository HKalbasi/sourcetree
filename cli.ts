#!/usr/bin/env node
import { program } from "commander";
import { start } from "./debug/bench";
import { enableFlag } from "./debug/flags";
import { main } from "./index";

program
  .option('-i, --input <file>', 'lsif dump path', 'dump.lsif')
  .option('-o, --output <file>', 'output folder for generated files', 'out')
  .option('--bench', 'enable benchmarking logs');

export type CliOptions = {
  input: string;
  output: string;
  bench: boolean;
};

const cli = async () => {
  const bench = start("Building sourcetree of your code", true);
  program.parse(process.argv);
  const options: CliOptions = program.opts();
  if (options.bench) enableFlag('bench');
  await main(options);
  bench.end();
};

cli();
