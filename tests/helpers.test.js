import { deepStrictEqual } from './assert.js';
import { getPortPosition, makePortList, combinePorts } from '../src/helpers.js';
function run() {
    deepStrictEqual(getPortPosition({ x: 100, y: 100 }, 0), { x: 75, y: 75 });
    deepStrictEqual(makePortList(3), [0, 1, 2]);
    deepStrictEqual(combinePorts([0, 1, 2], [0, 1], 1, 1), [0, 1, 3, 2, 4]);
    console.log('All tests passed');
}
run();
