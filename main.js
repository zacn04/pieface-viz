// main.js 

const API_BASE = "https://api.pieface.ai"; 


const modelSelect = document.getElementById('modelSelect');


// Helper: position ports in a circle around the gadget
function getPortPosition(gadgetPos, idx) {
  const w = 50, h = 50;
  // Always use 4-corner positions, repeat for >4 ports
  const offsets4 = [
    {x: -w/2, y: -h/2}, // 0: top-left
    {x: w/2,  y: -h/2}, // 1: top-right
    {x: w/2,  y: h/2},  // 2: bottom-right
    {x: -w/2, y: h/2},  // 3: bottom-left
  ];
  const off = offsets4[idx % 4];
  return { x: gadgetPos.x + off.x, y: gadgetPos.y + off.y };
}

// Map gadget type to initial port count (add more as needed)
const GADGET_PORTS = {
  'AP2T': 4,
  'C2T': 4,
  'P2T': 4,
  'NWT': 4,
};

// Helper to generate port ids for a gadget
function makePortList(count) {
  return Array.from({length: count}, (_, i) => i);
}

// Helper to load a trace from a user uploaded file (json or txt)
async function loadTraceFromFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.txt';
    input.onchange = async (event) => {
      const file = event.target.files[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      if (file.name.endsWith('.json')) {
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const trace = JSON.parse(e.target.result);
            resolve({ type: 'json', trace });
          } catch (err) {
            reject(new Error('Invalid JSON format'));
          }
        };
        reader.onerror = () => {
          reject(new Error('Error reading file'));
        };
        reader.readAsText(file);
      } else if (file.name.endsWith('.txt')) {
        resolve({ type: 'txt', file });
      } else {
        reject(new Error('Unsupported file type'));
      }
    };
    input.click(); // Trigger file selection dialog
  });
}
    


// Helper to rotate and shift port indices for combine
function combinePorts(g1_ports, g2_ports, rot, splice) {
  const mod = g2_ports.length;
  // Rotate g2's ports
  const rot_locs = g2_ports.map((l) => ((l + rot) % mod) + splice + 1);
  // New port list: g1 up to splice, then rotated g2, then g1 after splice (shifted)
  return [
    ...g1_ports.slice(0, splice + 1),
    ...rot_locs,
    ...g1_ports.slice(splice + 1).map(l => l + mod)
  ];
}

// Maintain a mapping of gadgets and their ports
const gadgets = {}; // { [gadgetId]: { label, ports: [portId], pos: {x, y}, type, portOrigins: [originalPortIdx], portMap: { [originalPortIdx]: portNodeId } } }
let gadgetIdCounter = 0;

// Track combined groups as arrays of gadget IDs
const combinedGroups = [];
// Track fixed port mapping for each group
const groupPortMaps = {};

const cy = cytoscape({
  container: document.getElementById('cy'),
  elements: [],
  style: [
    {
      selector: 'node[gadget]','style': {
        'shape': 'rectangle',
        'width': 50,
        'height': 50,
        'background-color': '#EEE',
        'background-opacity': 0.7,
        'border-width': 2,
        'border-color': '#555',
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'z-index': 10
      }
    },
    {
      selector: 'node[port]','style': {
        'shape': 'ellipse',
        'width': 16,
        'height': 16,
        'background-color': '#888',
        'border-width': 2,
        'border-color': '#222',
        'label': 'data(label)',
        'font-size': 8,
        'z-index': 20
      }
    },
    {
  selector: 'edge',
  style: {
    'curve-style':            'unbundled-bezier',
    'control-point-step-size': 40,        
    'edge-distances':          'node-position',
    'target-arrow-shape':      'triangle',
    'width':                   2,
    'z-index': 50
  }
  },

    {
      selector: '.highlighted',
      style: {
        'background-color': '#FFD700',
        'line-color': '#FFD700',
        'transition-property': 'background-color, line-color',
        'transition-duration': '0.5s'
      }
    }
  ],
  layout: { name: 'preset' }
});

function addGadgetNode(id, label, pos) {
  if (!cy.$(`#${id}`).length) {
    cy.add({ group: 'nodes', data: { id, label, gadget: true }, position: pos });
  }
}

function addPortNode(gadgetId, portId, idx, total, gadgetPos) {
  const portNodeId = `${gadgetId}_port_${portId}`;
  if (!cy.$(`#${portNodeId}`).length) {
    const pos = getPortPosition(gadgetPos, idx, total);
    cy.add({ group: 'nodes', data: { id: portNodeId, label: portId, port: true, parentGadget: gadgetId }, position: pos });
  }
}

function removePortNode(gadgetId, portId) {
  const portNodeId = `${gadgetId}_port_${portId}`;
  cy.$(`#${portNodeId}`).remove();
}

function addPortEdge(srcGadget, srcPort, dstGadget, dstPort) {
  // Use portMap to resolve port node IDs from original port indices
  const srcPortNode = gadgets[srcGadget]?.portMap?.[srcPort] || `${srcGadget}_port_${srcPort}`;
  const dstPortNode = gadgets[dstGadget]?.portMap?.[dstPort] || `${dstGadget}_port_${dstPort}`;
  const edgeId = `${srcPortNode}_to_${dstPortNode}`;
  // Print all current port nodes and their IDs
  const portNodes = cy.nodes().filter(n => n.data('port'));
  if (!cy.$(`#${srcPortNode}`).length || !cy.$(`#${dstPortNode}`).length) {
    console.warn(`Cannot create edge ${edgeId}: missing source or target node`);
    return;
  }
  if (!cy.$(`#${edgeId}`).length) {
    cy.add({
      group: 'edges',
      data: {
        id: edgeId,
        source: srcPortNode,
        target: dstPortNode,
        label: `${srcPort}->${dstPort}`
      }
    });
  }
}

function removeGadgetAndPorts(gadgetId) {
  cy.$(`#${gadgetId}`).remove();
  cy.nodes(`[parentGadget = "${gadgetId}"]`).remove();
  delete gadgets[gadgetId];
}

function addCompoundNode(groupId, memberIds) {
  // Add a compound node (parent) and set member nodes' parent to it
  if (!cy.$(`#${groupId}`).length) {
    cy.add({ group: 'nodes', data: { id: groupId, parentGroup: true }, selectable: false });
  }
  memberIds.forEach(id => {
    const node = cy.$(`#${id}`);
    if (node.length) node.move({ parent: groupId });
  });
}

function relabelGadgetPorts(gadgetId, newPorts, newOrigins) {
  // Remove old port nodes
  cy.nodes(`[parentGadget = "${gadgetId}"]`).remove();
  // Add new port nodes and rebuild portMap
  const pos = gadgets[gadgetId].pos;
  gadgets[gadgetId].ports = [...newPorts];
  gadgets[gadgetId].portOrigins = [...newOrigins];
  gadgets[gadgetId].portMap = {};
  newPorts.forEach((p, idx) => {
    addPortNode(gadgetId, p, idx, newPorts.length, pos);
    const origin = newOrigins[idx];
    gadgets[gadgetId].portMap[origin] = `${gadgetId}_port_${p}`;
  });
}

// Helper to send a loaded trace to the backend
async function sendTraceToBackend(trace) {
  const res = await fetch(`${API_BASE}/upload_trace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(trace)
  });
  if (!res.ok) {
    throw new Error('Failed to upload trace to backend');
  }
  return res.json();
}

let traceLoaded = false;

function setLoading(isLoading, message = '') {
  const output = document.getElementById('output');
  if (isLoading) {
    output.textContent = message || 'Loading...';
  } else if (!traceLoaded) {
    output.textContent = '';
  }
}

function setButtonsEnabled(enabled) {
  document.getElementById('nextStepBtn').disabled = !enabled;
  document.getElementById('resetBtn').disabled     = !enabled;
  document.getElementById("inferenceBtn").disabled = !enabled;

}


async function handleLoadTrace() {
  setLoading(true, 'Loading trace file...');
  try {
    const result = await loadTraceFromFile();
    if (result.type === 'json') {
      setLoading(true, 'Uploading trace to backend...');
      await sendTraceToBackend(result.trace);
    } else if (result.type === 'txt') {
      setLoading(true, 'Uploading txt trace to backend...');
      const formData = new FormData();
      formData.append('file', result.file);
      const res = await fetch(`${API_BASE}/upload_txt_trace`, {
        method: 'POST',
        body: formData
      });
      if (!res.ok) throw new Error('Failed to upload txt trace to backend');
    }
    traceLoaded = true;
    setButtonsEnabled(true);
    await initFromBackend();
    setLoading(false);
  } catch (err) {
    setLoading(false);
    traceLoaded = false;
    setButtonsEnabled(false);
    document.getElementById('output').textContent = 'Failed to load trace: ' + err.message;
  }
}

function updateGadgetInfo(meta) {
  // Display initial gadgets
  const initialList = document.getElementById('initial-gadgets');
  initialList.innerHTML = '';
  (meta.initial_gadgets || []).forEach(g => {
    const li = document.createElement('li');
    li.textContent = typeof g === 'string' ? g : (g.label || g.id || JSON.stringify(g));
    initialList.appendChild(li);
  });
  // Display target gadget
  document.getElementById('target-gadget').textContent = meta.target || 'Unknown';
}

async function initFromBackend() {
  setLoading(true, 'Initializing from backend...');
  const res = await fetch(`${API_BASE}/trace_meta`);
  const meta = await res.json();
  updateGadgetInfo(meta); 
  traceLoaded = true;
  const initials = meta.initial_gadgets || [];
  const w = cy.width(), h = cy.height();
  const spacing = 150;
  const offset = (initials.length - 1) / 2;
  cy.elements().remove();
  Object.keys(gadgets).forEach(k => delete gadgets[k]);
  gadgetIdCounter = 0;
  initials.forEach((g, i) => {
    const type = typeof g === 'string' ? g : g.label || g.id;
    const nodeId = `g${gadgetIdCounter++}`;
    const label = type;
    const portCount = GADGET_PORTS[type] || 4;
    const ports = makePortList(portCount);
    const pos = { x: w/2 + (i - offset) * spacing, y: h/2 };
    const portOrigins = ports.map((p) => p);
    const portMap = {};
    ports.forEach((p) => { portMap[p] = `${nodeId}_port_${p}`; });
    gadgets[nodeId] = { label, ports: [...ports], pos, type, portOrigins, portMap };
    addGadgetNode(nodeId, label, pos);
    ports.forEach((p, idx) => addPortNode(nodeId, p, idx, ports.length, pos));
  });
  cy.fit(cy.elements(), 50);
  setLoading(false);
}

function renderOp(op) {
  // 1a) print to the console area
  document.getElementById("output").textContent = JSON.stringify(op) + "\n";


  // 1b) mutate the cytoscape graph
  if (op.op === 'CONNECT') {
    const [, srcIdx, dstIdx] = op.args;
    const allPorts = Object.values(groupPortMaps).flat();
    const src = allPorts.find(port => port.port === +srcIdx);
    const dst = allPorts.find(port => port.port === +dstIdx);
    if (src && dst) {
      addPortEdge(src.gadget, src.port, dst.gadget, dst.port);
      cy.$(`#${src.gadget}_port_${src.port}`).addClass('connected');
      cy.$(`#${dst.gadget}_port_${dst.port}`).addClass('connected');
    } else {
      console.warn('CONNECT failed to find ports', srcIdx, dstIdx);
    }
  }
  else if (op.op === 'COMBINE') {
    const [g1_id, g2_id] = op.args;
    const rot    = op.rot    || 0;
    const splice = op.splice || 0;
    const g1 = gadgets[g1_id], g2 = gadgets[g2_id];
    if (!g1 || !g2) return console.warn('COMBINE missing gadget', g1_id, g2_id);

    // Compute new port lists
    const mod = g2.ports.length;
    const g1_new = [
      ...g1.ports.slice(0, splice+1),
      ...g1.ports.slice(splice+1).map(l => l + mod),
    ];
    const g1_orig = [
      ...g1.portOrigins.slice(0, splice+1),
      ...g1.portOrigins.slice(splice+1),
    ];
    const g2_new = g2.ports.map(l => ((l + rot) % mod) + splice + 1);
    const g2_orig = g2.portOrigins.map((_,i,arr) => arr[(i+rot)%mod]);

    // Re-label ports
    relabelGadgetPorts(g1_id, g1_new, g1_orig);
    relabelGadgetPorts(g2_id, g2_new, g2_orig);

    // Make the compound node
    const groupId = `group_${g1_id}_${g2_id}`;
    combinedGroups.push([g1_id,g2_id]);
    addCompoundNode(groupId, [g1_id, g2_id]);
    groupPortMaps[groupId] = [
      ...g1_new.map(p => ({gadget:g1_id,port:p})),
      ...g2_new.map(p => ({gadget:g2_id,port:p}))
    ];
    cy.$(`#${groupId}`).style({
      'background-opacity': 0,
      'border-width': 3,
      'border-color': '#888',
      'border-style': 'dashed',
      'label': '',
      'z-index': 1
    });

  }
  else if (op.op === 'STOP') {
    // nothing to do
  }
  else {
    console.warn('Unknown op:', op);
  }

  // 1c) re-layout
  cy.layout({ name: 'preset' }).run();
  cy.fit(cy.elements(), 50);
}

async function nextStep() {
  if (!traceLoaded) return;
  setLoading(true, 'Stepping...');
  const res = await fetch(`${API_BASE}/step`, { method: 'POST' });
  const { op, done } = await res.json();
  setLoading(false);

  if (done) {
    setButtonsEnabled(false);
    document.getElementById("resetBtn").disabled = false;
    return;
  }
  renderOp(op);
}

async function reset() {
  if (!traceLoaded) return;
  setLoading(true, 'Resetting...');
  await fetch(`${API_BASE}/reset`, { method: 'POST' });
  cy.elements().remove();
  document.getElementById('output').textContent = '';
  cy.layout({ name: 'preset' }).run();
  cy.center();
  await initFromBackend();
  setLoading(false);
}

async function fetchEnvState() {
  try {
    const res = await fetch(`${API_BASE}/env_state`);
    const state = await res.json();
    document.getElementById('output').textContent = JSON.stringify(state, null, 2);
  } catch (err) {
    console.error("Failed to fetch env state:", err);
    document.getElementById('output').textContent = 'Failed to fetch env state.';
  }
}

async function inferModelStep() {
  try {
    const modelName = modelSelect.value;
    const response = await fetch(`${API_BASE}/infer_next_step`, 
      { method: 'POST', 'headers': {'Content-Type': 'application/json'}, body: JSON.stringify({ model: modelName }) });
    const data = await response.json();

    const suggestionDiv = document.getElementById("model-suggestion");
    const topActionsList = document.getElementById("top-actions");

    // Clear previous
    suggestionDiv.textContent = "";
    topActionsList.innerHTML = "";

    if (data.description) {
      suggestionDiv.innerHTML = `
    Model suggests: ${data.description}
    <span title="${data.tooltip || ''}" style="cursor: help;">- confused?</span>
  `;
    }

    if (data.top_actions) {
      data.top_actions.forEach(({ action_desc, confidence }) => {
        const li = document.createElement("li");
        li.textContent = `${action_desc} (${(confidence * 100).toFixed(1)}%)`;
        topActionsList.appendChild(li);
      });
    }
    const suggestion = data.description;
    document.getElementById("model-suggestion").textContent = suggestion;

    const acceptBtn = document.createElement("button");
    acceptBtn.textContent = "Accept agent action";
    acceptBtn.classList.add("button", "is-small", "is-success");

    const denyBtn = document.createElement("button");
    denyBtn.textContent = "Deny agent action";
    denyBtn.classList.add("button", "is-small", "is-danger");
    denyBtn.onclick = () => {
      suggestionDiv.textContent = "Agent action denied.";
      acceptBtn.remove();
      denyBtn.remove();
      document.getElementById("nextStepBtn").disabled = false;
      document.getElementById("resetBtn").disabled = false;
    };
    document.getElementById("model-suggestion-box").appendChild(denyBtn);

    
    acceptBtn.onclick = async () => {
    const res = await fetch(`${API_BASE}/apply_action`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ action: suggestion, actor: "agent" }),
    });

    const result = await res.json();
    if (!result.success) {
      alert("Failed: " + result.error);
    } else {
      renderOp(result.op);
      suggestionDiv.textContent = "";
      acceptBtn.remove();
      denyBtn.remove();
      document.getElementById("nextStepBtn").disabled = true;
      document.getElementById("resetBtn").disabled = false;
    }
  };
  document.getElementById("model-suggestion-box").appendChild(acceptBtn);
  } catch (err) {
    console.error("Error fetching model suggestion:", err);
  }
}





document.addEventListener('DOMContentLoaded', () => {
  setButtonsEnabled(false);
  const sel = document.getElementById('traceSelect');
  const loadBtn = document.getElementById('loadBtn');
  const nextBtn  = document.getElementById('nextStepBtn');
  const resetBtn = document.getElementById('resetBtn');
  const inferenceBtn = document.getElementById('inferenceBtn');
  document.getElementById("model-suggestion").textContent = "";
  document.getElementById("top-actions").innerHTML = "";



  nextBtn.addEventListener('click', nextStep);
  resetBtn.addEventListener('click', reset);
  inferenceBtn.addEventListener('click', inferModelStep);

  


  async function populateTraceDropdown() {
    const res = await fetch(`${API_BASE}/list_traces`);
    const traces = await res.json();
    traces.sort();
    traces.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
  }

  sel.addEventListener('change', () => {
    loadBtn.disabled = sel.value === '';
  });


  loadBtn.addEventListener('click', async () => {
    setLoading(true, `Loading ${sel.value}...`);
    await fetch(`${API_BASE}/select_trace`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ filename: sel.value })
    });
    await fetch(`${API_BASE}/reset`, { method: 'POST' });
    traceLoaded = true;
    setButtonsEnabled(true);
    await initFromBackend();
    setLoading(false);
  });

  populateTraceDropdown();
});

window.nextStep = nextStep;
window.reset = reset;
window.handleLoadTrace = handleLoadTrace;
