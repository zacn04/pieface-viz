export interface Point { x: number; y: number; }

export function getPortPosition(gadgetPos: Point, idx: number): Point {
  const w = 50, h = 50;
  const offsets4 = [
    { x: -w / 2, y: -h / 2 }, // 0: top-left
    { x: w / 2, y: -h / 2 },  // 1: top-right
    { x: w / 2, y: h / 2 },   // 2: bottom-right
    { x: -w / 2, y: h / 2 }   // 3: bottom-left
  ];
  const off = offsets4[idx % 4];
  return { x: gadgetPos.x + off.x, y: gadgetPos.y + off.y };
}

export function makePortList(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i);
}

export function combinePorts(g1_ports: number[], g2_ports: number[], rot: number, splice: number): number[] {
  const mod = g2_ports.length;
  const rot_locs = g2_ports.map(l => ((l + rot) % mod) + splice + 1);
  return [
    ...g1_ports.slice(0, splice + 1),
    ...rot_locs,
    ...g1_ports.slice(splice + 1).map(l => l + mod)
  ];
}
