import { getPortPosition } from './helpers.js';
export function addGadgetNode(cy, id, label, pos) {
    if (!cy.$(`#${id}`).length) {
        cy.add({ group: 'nodes', data: { id, label, gadget: true }, position: pos });
    }
}
export function addPortNode(cy, gadgetId, portId, idx, total, gadgetPos) {
    const portNodeId = `${gadgetId}_port_${portId}`;
    if (!cy.$(`#${portNodeId}`).length) {
        const pos = getPortPosition(gadgetPos, idx);
        cy.add({ group: 'nodes', data: { id: portNodeId, label: portId, port: true, parentGadget: gadgetId }, position: pos });
    }
}
export function removePortNode(cy, gadgetId, portId) {
    const portNodeId = `${gadgetId}_port_${portId}`;
    cy.$(`#${portNodeId}`).remove();
}
export function addPortEdge(cy, gadgets, srcGadget, srcPort, dstGadget, dstPort) {
    var _a, _b, _c, _d;
    const srcPortNode = ((_b = (_a = gadgets[srcGadget]) === null || _a === void 0 ? void 0 : _a.portMap) === null || _b === void 0 ? void 0 : _b[srcPort]) || `${srcGadget}_port_${srcPort}`;
    const dstPortNode = ((_d = (_c = gadgets[dstGadget]) === null || _c === void 0 ? void 0 : _c.portMap) === null || _d === void 0 ? void 0 : _d[dstPort]) || `${dstGadget}_port_${dstPort}`;
    const edgeId = `${srcPortNode}_to_${dstPortNode}`;
    if (!cy.$(`#${srcPortNode}`).length || !cy.$(`#${dstPortNode}`).length)
        return;
    if (!cy.$(`#${edgeId}`).length) {
        cy.add({ group: 'edges', data: { id: edgeId, source: srcPortNode, target: dstPortNode, label: `${srcPort}->${dstPort}` } });
    }
}
export function addCompoundNode(cy, groupId, memberIds) {
    if (!cy.$(`#${groupId}`).length) {
        cy.add({ group: 'nodes', data: { id: groupId, parentGroup: true }, selectable: false });
    }
    memberIds.forEach(id => {
        const node = cy.$(`#${id}`);
        if (node.length)
            node.move({ parent: groupId });
    });
}
export function relabelGadgetPorts(cy, gadgets, gadgetId, newPorts, newOrigins) {
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
