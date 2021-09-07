const flags: Map<string, boolean> = new Map();

export const enableFlag = (flag: string) => {
  flags.set(flag, true);
};

export const isEnabled = (flag: string) => {
  return flags.get(flag) === true;
};
