import { makePortList } from './helpers.js';
import {
  addGadgetNode,
  addPortNode,
  addPortEdge,
  addCompoundNode,
  relabelGadgetPorts
} from './graph.js';

declare const cytoscape: any;

declare global {
  interface Window {
    nextStep: () => void;
    reset: () => void;
    handleLoadTrace: () => void;
  }
}

const API_BASE = "https://api.pieface.ai";

const modelSelect = document.getElementById('modelSelect') as HTMLSelectElement | null;

const GADGET_PORTS: Record<string, number> = {
  'AP2T': 4,
  'C2T': 4,
  'P2T': 4,
  'NWT': 4,
};

async function loadTraceFromFile(): Promise<{ type: 'json' | 'txt'; trace?: any; file?: File }> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.txt';
    input.onchange = async (event: Event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      if (file.name.endsWith('.json')) {
        const reader = new FileReader();
        reader.onload = async e => {
          try {
            const trace = JSON.parse(String((e.target as FileReader).result));
            resolve({ type: 'json', trace });
          } catch {
            reject(new Error('Invalid JSON format'));
          }
        };
        reader.onerror = () => reject(new Error('Error reading file'));
        reader.readAsText(file);
      } else if (file.name.endsWith('.txt')) {
        resolve({ type: 'txt', file });
      } else {
        reject(new Error('Unsupported file type'));
      }
    };
    input.click();
  });
}

const gadgets: Record<string, any> = {};
let gadgetIdCounter = 0;
const combinedGroups: string[][] = [];
const groupPortMaps: Record<string, any[]> = {};

const cy = cytoscape({
  container: document.getElementById('cy'),
  elements: [],
  style: [
    { selector: 'node[gadget]', style: { shape: 'rectangle', width: 50, height: 50, 'background-color': '#EEE', 'background-opacity': 0.7, 'border-width': 2, 'border-color': '#555', label: 'data(label)', 'text-valign': 'center', 'text-halign': 'center', 'z-index': 10 } },
    { selector: 'node[port]', style: { shape: 'ellipse', width: 16, height: 16, 'background-color': '#888', 'border-width': 2, 'border-color': '#222', label: 'data(label)', 'font-size': 8, 'z-index': 20 } },
    { selector: 'edge', style: { 'curve-style': 'unbundled-bezier', 'control-point-step-size': 40, 'edge-distances': 'node-position', 'target-arrow-shape': 'triangle', width: 2, 'z-index': 50 } },
    { selector: '.highlighted', style: { 'background-color': '#FFD700', 'line-color': '#FFD700', 'transition-property': 'background-color, line-color', 'transition-duration': '0.5s' } }
  ],
  layout: { name: 'preset' }
});


async function sendTraceToBackend(trace: any): Promise<any> {
  const res = await fetch(`${API_BASE}/upload_trace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(trace)
  });
  if (!res.ok) throw new Error('Failed to upload trace to backend');
  return res.json();
}

let traceLoaded = false;

function setLoading(isLoading: boolean, message = ''): void {
  const output = document.getElementById('output') as HTMLElement;
  if (isLoading) {
    output.textContent = message || 'Loading...';
  } else if (!traceLoaded) {
    output.textContent = '';
  }
}

function setButtonsEnabled(enabled: boolean): void {
  (document.getElementById('nextStepBtn') as HTMLButtonElement).disabled = !enabled;
  (document.getElementById('resetBtn') as HTMLButtonElement).disabled = !enabled;
  (document.getElementById('inferenceBtn') as HTMLButtonElement).disabled = !enabled;
}

async function handleLoadTrace(): Promise<void> {
  setLoading(true, 'Loading trace file...');
  try {
    const result = await loadTraceFromFile();
    if (result.type === 'json') {
      setLoading(true, 'Uploading trace to backend...');
      await sendTraceToBackend(result.trace);
    } else if (result.type === 'txt') {
      setLoading(true, 'Uploading txt trace to backend...');
      const formData = new FormData();
      formData.append('file', result.file as Blob);
      const res = await fetch(`${API_BASE}/upload_txt_trace`, { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Failed to upload txt trace to backend');
    }
    traceLoaded = true;
    setButtonsEnabled(true);
    await initFromBackend();
    setLoading(false);
  } catch (err: any) {
    setLoading(false);
    traceLoaded = false;
    setButtonsEnabled(false);
    (document.getElementById('output') as HTMLElement).textContent = 'Failed to load trace: ' + err.message;
  }
}

function updateGadgetInfo(meta: any): void {
  const initialList = document.getElementById('initial-gadgets') as HTMLElement;
  initialList.innerHTML = '';
  (meta.initial_gadgets || []).forEach((g: any) => {
    const li = document.createElement('li');
    li.textContent = typeof g === 'string' ? g : (g.label || g.id || JSON.stringify(g));
    initialList.appendChild(li);
  });
  (document.getElementById('target-gadget') as HTMLElement).textContent = meta.target || 'Unknown';
}

async function initFromBackend(): Promise<void> {
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
  initials.forEach((g: any, i: number) => {
    const type = typeof g === 'string' ? g : g.label || g.id;
    const nodeId = `g${gadgetIdCounter++}`;
    const label = type;
    const portCount = GADGET_PORTS[type] || 4;
    const ports = makePortList(portCount);
    const pos = { x: w / 2 + (i - offset) * spacing, y: h / 2 };
    const portOrigins = ports.map(p => p);
    const portMap: Record<number, string> = {};
    ports.forEach(p => { portMap[p] = `${nodeId}_port_${p}`; });
    gadgets[nodeId] = { label, ports: [...ports], pos, type, portOrigins, portMap };
    addGadgetNode(cy, nodeId, label, pos);
    ports.forEach((p, idx) => addPortNode(cy, nodeId, p, idx, ports.length, pos));
  });
  cy.fit(cy.elements(), 50);
  setLoading(false);
}

function renderOp(op: any): void {
  (document.getElementById('output') as HTMLElement).textContent = JSON.stringify(op) + '\n';
  if (op.op === 'CONNECT') {
    const [, srcIdx, dstIdx] = op.args;
    const allPorts = Object.values(groupPortMaps).flat();
    const src = allPorts.find((port: any) => port.port === +srcIdx);
    const dst = allPorts.find((port: any) => port.port === +dstIdx);
    if (src && dst) {
      addPortEdge(cy, gadgets, src.gadget, src.port, dst.gadget, dst.port);
      cy.$(`#${src.gadget}_port_${src.port}`).addClass('connected');
      cy.$(`#${dst.gadget}_port_${dst.port}`).addClass('connected');
    }
  } else if (op.op === 'COMBINE') {
    const [g1_id, g2_id] = op.args;
    const rot = op.rot || 0;
    const splice = op.splice || 0;
    const g1 = gadgets[g1_id], g2 = gadgets[g2_id];
    if (!g1 || !g2) return;
    const mod = g2.ports.length;
    const g1_new = [
      ...g1.ports.slice(0, splice + 1),
      ...g1.ports.slice(splice + 1).map((l: number) => l + mod)
    ];
    const g1_orig = [
      ...g1.portOrigins.slice(0, splice + 1),
      ...g1.portOrigins.slice(splice + 1)
    ];
    const g2_new = g2.ports.map((l: number) => ((l + rot) % mod) + splice + 1);
    const g2_orig = g2.portOrigins.map((_: any, i: number, arr: any[]) => arr[(i + rot) % mod]);
    relabelGadgetPorts(cy, gadgets, g1_id, g1_new, g1_orig);
    relabelGadgetPorts(cy, gadgets, g2_id, g2_new, g2_orig);
    const groupId = `group_${g1_id}_${g2_id}`;
    combinedGroups.push([g1_id, g2_id]);
    addCompoundNode(cy, groupId, [g1_id, g2_id]);
    groupPortMaps[groupId] = [
      ...g1_new.map((p: number) => ({ gadget: g1_id, port: p })),
      ...g2_new.map((p: number) => ({ gadget: g2_id, port: p }))
    ];
    cy.$(`#${groupId}`).style({ 'background-opacity': 0, 'border-width': 3, 'border-color': '#888', 'border-style': 'dashed', label: '', 'z-index': 1 });
  }
  cy.layout({ name: 'preset' }).run();
  cy.fit(cy.elements(), 50);
}

async function nextStep(): Promise<void> {
  if (!traceLoaded) return;
  setLoading(true, 'Stepping...');
  const res = await fetch(`${API_BASE}/step`, { method: 'POST' });
  const { op, done } = await res.json();
  setLoading(false);
  if (done) {
    setButtonsEnabled(false);
    (document.getElementById('resetBtn') as HTMLButtonElement).disabled = false;
    return;
  }
  renderOp(op);
}

async function reset(): Promise<void> {
  if (!traceLoaded) return;
  setLoading(true, 'Resetting...');
  await fetch(`${API_BASE}/reset`, { method: 'POST' });
  cy.elements().remove();
  (document.getElementById('output') as HTMLElement).textContent = '';
  cy.layout({ name: 'preset' }).run();
  cy.center();
  await initFromBackend();
  setLoading(false);
}

document.addEventListener('DOMContentLoaded', () => {
  setButtonsEnabled(false);
  const sel = document.getElementById('traceSelect') as HTMLSelectElement;
  const loadBtn = document.getElementById('loadBtn') as HTMLButtonElement;
  const nextBtn = document.getElementById('nextStepBtn') as HTMLButtonElement;
  const resetBtn = document.getElementById('resetBtn') as HTMLButtonElement;
  const inferenceBtn = document.getElementById('inferenceBtn') as HTMLButtonElement;

  nextBtn.addEventListener('click', nextStep);
  resetBtn.addEventListener('click', reset);
  inferenceBtn.addEventListener('click', inferModelStep);

  async function populateTraceDropdown() {
    const res = await fetch(`${API_BASE}/list_traces`);
    const traces = await res.json();
    traces.forEach((name: string) => {
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
    await fetch(`${API_BASE}/select_trace`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: sel.value }) });
    await fetch(`${API_BASE}/reset`, { method: 'POST' });
    traceLoaded = true;
    setButtonsEnabled(true);
    await initFromBackend();
    setLoading(false);
  });

  populateTraceDropdown();
});

async function inferModelStep(): Promise<void> {
  try {
    const modelName = modelSelect?.value;
    const response = await fetch(`${API_BASE}/infer_next_step`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: modelName }) });
    const data = await response.json();

    const suggestionDiv = document.getElementById('model-suggestion') as HTMLElement;
    const topActionsList = document.getElementById('top-actions') as HTMLElement;
    suggestionDiv.textContent = '';
    topActionsList.innerHTML = '';

    if (data.description) {
      suggestionDiv.innerHTML = `Model suggests: ${data.description}<span title="${data.tooltip || ''}" style="cursor: help;">- confused?</span>`;
    }

    if (data.top_actions) {
      data.top_actions.forEach(({ action_desc, confidence }: any) => {
        const li = document.createElement('li');
        li.textContent = `${action_desc} (${(confidence * 100).toFixed(1)}%)`;
        topActionsList.appendChild(li);
      });
    }
    const suggestion = data.description;
    (document.getElementById('model-suggestion') as HTMLElement).textContent = suggestion;

    const acceptBtn = document.createElement('button');
    acceptBtn.textContent = 'Accept agent action';
    acceptBtn.classList.add('button', 'is-small', 'is-success');

    const denyBtn = document.createElement('button');
    denyBtn.textContent = 'Deny agent action';
    denyBtn.classList.add('button', 'is-small', 'is-danger');
    denyBtn.onclick = () => {
      suggestionDiv.textContent = 'Agent action denied.';
      acceptBtn.remove();
      denyBtn.remove();
      (document.getElementById('nextStepBtn') as HTMLButtonElement).disabled = false;
      (document.getElementById('resetBtn') as HTMLButtonElement).disabled = false;
    };
    document.getElementById('model-suggestion-box')?.appendChild(denyBtn);

    acceptBtn.onclick = async () => {
      const res = await fetch(`${API_BASE}/apply_action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: suggestion, actor: 'agent' }) });
      const result = await res.json();
      if (!result.success) {
        alert('Failed: ' + result.error);
      } else {
        renderOp(result.op);
        suggestionDiv.textContent = '';
        acceptBtn.remove();
        denyBtn.remove();
        (document.getElementById('nextStepBtn') as HTMLButtonElement).disabled = true;
        (document.getElementById('resetBtn') as HTMLButtonElement).disabled = false;
      }
    };
    document.getElementById('model-suggestion-box')?.appendChild(acceptBtn);
  } catch (err) {
    console.error('Error fetching model suggestion:', err);
  }
}

window.nextStep = nextStep;
window.reset = reset;
window.handleLoadTrace = handleLoadTrace;
