import { isEnabled } from "./flags";

type Bench = {
  end: () => void;
};

const emptyBench: Bench = { end: () => {} };

export const start = (text: string, force: boolean = false): Bench => {
  if (!isEnabled('bench') && !force) return emptyBench;
  console.log(`${text} started`);
  const s = (new Date).valueOf();
  return {
    end: () => {
      const diff = (new Date).valueOf() - s;
      console.log(`${text} finished in ${diff / 1000} seconds`);
    },
  };
};
