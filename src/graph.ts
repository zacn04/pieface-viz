import { getPortPosition } from './helpers.js';

export interface Position { x: number; y: number; }
export interface GadgetMap {
  [id: string]: {
    pos: Position;
    ports: number[];
    portOrigins: number[];
    portMap: Record<number, string>;
    type: string;
    label: string;
  };
}

export function addGadgetNode(cy: any, id: string, label: string, pos: Position): void {
  if (!cy.$(`#${id}`).length) {
    cy.add({ group: 'nodes', data: { id, label, gadget: true }, position: pos });
  }
}

export function addPortNode(cy: any, gadgetId: string, portId: number, idx: number, total: number, gadgetPos: Position): void {
  const portNodeId = `${gadgetId}_port_${portId}`;
  if (!cy.$(`#${portNodeId}`).length) {
    const pos = getPortPosition(gadgetPos, idx);
    cy.add({ group: 'nodes', data: { id: portNodeId, label: portId, port: true, parentGadget: gadgetId }, position: pos });
  }
}

export function removePortNode(cy: any, gadgetId: string, portId: number): void {
  const portNodeId = `${gadgetId}_port_${portId}`;
  cy.$(`#${portNodeId}`).remove();
}

export function addPortEdge(cy: any, gadgets: GadgetMap, srcGadget: string, srcPort: number, dstGadget: string, dstPort: number): void {
  const srcPortNode = gadgets[srcGadget]?.portMap?.[srcPort] || `${srcGadget}_port_${srcPort}`;
  const dstPortNode = gadgets[dstGadget]?.portMap?.[dstPort] || `${dstGadget}_port_${dstPort}`;
  const edgeId = `${srcPortNode}_to_${dstPortNode}`;
  if (!cy.$(`#${srcPortNode}`).length || !cy.$(`#${dstPortNode}`).length) return;
  if (!cy.$(`#${edgeId}`).length) {
    cy.add({ group: 'edges', data: { id: edgeId, source: srcPortNode, target: dstPortNode, label: `${srcPort}->${dstPort}` } });
  }
}

export function addCompoundNode(cy: any, groupId: string, memberIds: string[]): void {
  if (!cy.$(`#${groupId}`).length) {
    cy.add({ group: 'nodes', data: { id: groupId, parentGroup: true }, selectable: false });
  }
  memberIds.forEach(id => {
    const node = cy.$(`#${id}`);
    if (node.length) node.move({ parent: groupId });
  });
}

export function relabelGadgetPorts(cy: any, gadgets: GadgetMap, gadgetId: string, newPorts: number[], newOrigins: number[]): void {
  cy.nodes(`[parentGadget = "${gadgetId}"]`).remove();
  const pos = gadgets[gadgetId].pos;
  gadgets[gadgetId].ports = [...newPorts];
  gadgets[gadgetId].portOrigins = [...newOrigins];
  gadgets[gadgetId].portMap = {};
  newPorts.forEach((p, idx) => {
    addPortNode(cy, gadgetId, p, idx, newPorts.length, pos);
    const origin = newOrigins[idx];
    gadgets[gadgetId].portMap[origin] = `${gadgetId}_port_${p}`;
  });
}
