#!/usr/bin/env node
import { program } from "commander";
import { main, CliOptions } from "./index";

program
  .option('-i, --input <file>', 'lsif dump path', 'dump.lsif')
  .option('-o, --output <file>', 'output folder for generated files', 'out');

const cli = async () => {
  const time = (new Date()).valueOf();
  program.parse(process.argv);
  const options: CliOptions = program.opts();
  main(options);
  const duration = (new Date()).valueOf() - time;
  console.log(`Finished building sourcetree of your code in ${duration / 1000} second`);
};

cli();
