declare module "@strudel/mini" {
  interface Hap<T = string> {
    value: T;
    whole: { begin: number; end: number } | null;
    part: { begin: number; end: number };
  }

  interface Pattern<T = string> {
    queryArc(begin: number, end: number): Hap<T>[];
  }

  export function mini(input: string): Pattern;
}
