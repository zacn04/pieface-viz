import { getPortPosition } from './helpers.js';
// Utility to encode SVG for data URI
function svgToDataUri(svg) {
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
        .replace(/'/g, '%27')
        .replace(/"/g, '%22');
}
export function addGadgetNode(cy, id, label, pos, type) {
    if (!cy.$(`#${id}`).length) {
        // Raw SVGs for Cytoscape background-image
        const SVG_MAP = {
            AP2T: `<svg xmlns='http://www.w3.org/2000/svg' width='90' height='90' viewBox='0 0 90 90'><rect x='15' y='15' width='60' height='60' rx='10' fill='#fff' stroke='#1976d2' stroke-width='3'/><line x1='15' y1='25' x2='75' y2='25' stroke='#1976d2' stroke-width='7' marker-end='url(#arrow)'/><line x1='75' y1='65' x2='15' y2='65' stroke='#1976d2' stroke-width='7' marker-end='url(#arrow)'/><defs><marker id='arrow' markerWidth='6' markerHeight='6' refX='6' refY='3' orient='auto'><polygon points='0,0 6,3 0,6' fill='#1976d2'/></marker></defs></svg>`,
            C2T: `<svg xmlns='http://www.w3.org/2000/svg' width='90' height='90' viewBox='0 0 90 90'><rect x='15' y='15' width='60' height='60' rx='10' fill='#fff' stroke='#388e3c' stroke-width='3'/><line x1='15' y1='15' x2='75' y2='75' stroke='#388e3c' stroke-width='7' marker-end='url(#arrow)'/><line x1='75' y1='15' x2='15' y2='75' stroke='#fbc02d' stroke-width='7' marker-end='url(#arrow2)'/><defs><marker id='arrow' markerWidth='6' markerHeight='6' refX='6' refY='3' orient='auto'><polygon points='0,0 6,3 0,6' fill='#388e3c'/></marker><marker id='arrow2' markerWidth='6' markerHeight='6' refX='6' refY='3' orient='auto'><polygon points='0,0 6,3 0,6' fill='#fbc02d'/></marker></defs></svg>`,
            P2T: `<svg xmlns='http://www.w3.org/2000/svg' width='90' height='90' viewBox='0 0 90 90'><rect x='15' y='15' width='60' height='60' rx='10' fill='#fff' stroke='#7b1fa2' stroke-width='3'/><line x1='15' y1='25' x2='75' y2='25' stroke='#7b1fa2' stroke-width='7' marker-end='url(#arrow)'/><line x1='15' y1='65' x2='75' y2='65' stroke='#7b1fa2' stroke-width='7' marker-end='url(#arrow)'/><defs><marker id='arrow' markerWidth='6' markerHeight='6' refX='6' refY='3' orient='auto'><polygon points='0,0 6,3 0,6' fill='#7b1fa2'/></marker></defs></svg>`,
            NWT: `<svg xmlns='http://www.w3.org/2000/svg' width='90' height='90' viewBox='0 0 90 90'><rect x='15' y='15' width='60' height='60' rx='10' fill='#fff' stroke='#616161' stroke-width='3'/><line x1='15' y1='45' x2='75' y2='45' stroke='#616161' stroke-width='7'/><line x1='45' y1='7' x2='45' y2='23' stroke='#111' stroke-width='7'/></svg>`
        };
        const bgImage = type && SVG_MAP[type] ? svgToDataUri(SVG_MAP[type]) : undefined;
        cy.add({
            group: 'nodes',
            data: { id, label, gadget: true, type },
            position: pos,
            style: bgImage ? {
                'background-image': bgImage,
                'background-fit': 'contain',
                'background-opacity': 1,
                'background-color': '#fff',
                'border-width': 0,
                'label': '',
                'width': 60,
                'height': 60
            } : undefined
        });
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
