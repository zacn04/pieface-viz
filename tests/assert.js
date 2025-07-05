export function deepStrictEqual(a, b) {
    const pass = JSON.stringify(a) === JSON.stringify(b);
    if (!pass) {
        throw new Error(`Assertion failed: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
    }
}
