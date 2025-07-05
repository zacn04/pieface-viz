export function deepStrictEqual(a: any, b: any): void {
  const pass = JSON.stringify(a) === JSON.stringify(b);
  if (!pass) {
    throw new Error(`Assertion failed: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
  }
}
