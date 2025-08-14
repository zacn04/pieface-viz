
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

const gadgets: Record<string, any> = {};
let gadgetIdCounter = 0;
const combinedGroups: string[][] = [];
const groupPortMaps: Record<string, any[]> = {};

// Enhanced interaction state
let currentMode: 'combine' | 'connect' | 'select' = 'select';  // Default to select
let draggedNode: any = null;
let dragStartPos: { x: number, y: number } | null = null;
let connectingPort: any = null;

const cy = cytoscape({
  container: document.getElementById('cy'),
  elements: [],
  style: [
    { selector: 'node[gadget]', style: { shape: 'rectangle', width: 50, height: 50, 'background-color': '#EEE', 'background-opacity': 0.7, 'border-width': 2, 'border-color': '#555', label: 'data(label)', 'text-valign': 'center', 'text-halign': 'center', 'z-index': 10 } },
    { selector: 'node[port]', style: { shape: 'ellipse', width: 16, height: 16, 'background-color': '#888', 'border-width': 2, 'border-color': '#222', label: 'data(label)', 'font-size': 8, 'z-index': 20 } },
    { selector: 'edge', style: { 'curve-style': 'unbundled-bezier', 'control-point-step-size': 40, 'edge-distances': 'node-position', 'target-arrow-shape': 'triangle', width: 2, 'z-index': 50 } },
    { selector: '.highlighted', style: { 'background-color': '#FFD700', 'line-color': '#FFD700', 'transition-property': 'background-color, line-color', 'transition-duration': '0.5s' } },
    { selector: '.dragging', style: { 'opacity': 0.5 } },
    { selector: '.drop-target', style: { 'border-width': 4, 'border-color': '#48c774' } },
    { selector: '.connecting', style: { 'background-color': '#3273dc', 'width': 20, 'height': 20 } }
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
  (document.getElementById('resetBtn') as HTMLButtonElement).disabled = !enabled;
  (document.getElementById('inferenceBtn') as HTMLButtonElement).disabled = !enabled;
}

async function initFromBackend(env_state?: any, initialGadgets?: any[], targetGadget?: string): Promise<void> {
  setLoading(true, 'Initializing from backend...');

  const state = env_state || {};
  const initials = initialGadgets || (state.gadgets || []);
  const target = targetGadget || (state.target_gadget || (state.gadgets && state.gadgets[0]?.type) || 'Unknown');

  const initialList = document.getElementById('initial-gadgets') as HTMLElement;
  initialList.innerHTML = '';
  initials.forEach((g: any) => {
    const li = document.createElement('li');
    li.textContent = typeof g === 'string' ? g : (g.type || g.label || g.id || JSON.stringify(g));
    initialList.appendChild(li);
  });
  (document.getElementById('target-gadget') as HTMLElement).textContent = target;

  traceLoaded = true;
  const w = cy.width(), h = cy.height();
  const spacing = 150;
  const offset = (initials.length - 1) / 2;
  cy.elements().remove();
  Object.keys(gadgets).forEach(k => delete gadgets[k]);
  gadgetIdCounter = 0;
  
  initials.forEach((g: any, i: number) => {
    const type = typeof g === 'string' ? g : g.type || g.label || g.id;
    const nodeId = `g${gadgetIdCounter++}`;
    const label = type;
    const ports = g.locations || (GADGET_PORTS[type] ? makePortList(GADGET_PORTS[type]) : []);
    const pos = { x: w / 2 + (i - offset) * spacing, y: h / 2 };
    const portOrigins = ports.map((p: number) => p);
    const portMap: Record<number, string> = {};
    ports.forEach((p: number) => { portMap[p] = `${nodeId}_port_${p}`; });
    gadgets[nodeId] = { label, ports: [...ports], pos, type, portOrigins, portMap };
    addGadgetNode(cy, nodeId, label, pos, type);
    ports.forEach((p: number, idx: number) => addPortNode(cy, nodeId, p, idx, ports.length, pos));
  });
  
  cy.resize();
  cy.fit(cy.elements(), 50);
  cy.center();
  setLoading(false);
}

function _pct(x: number): number { 
  return Math.round((x || 0) * 100); 
}

function _fmtDelta(pct: number): string { 
  const s = Math.round(pct * 10) / 10; 
  return (s > 0 ? '+' : '') + s + '%'; 
}

async function fetchMetrics(): Promise<any> {
  const url = `${API_BASE}/metrics`;
  console.log('Fetching from:', url); // ADD THIS
  const res = await fetch(url, { cache: 'no-store', credentials: 'include' });
  if (!res.ok) throw new Error('metrics fetch failed');
  return res.json();
}

function renderMetrics(m: any): void {
  const b = m?.baseline || { n: 0, success_rate: 0 };
  const h = m?.rlhf || { n: 0, success_rate: 0 };

  const bp = _pct(b.success_rate);
  const hp = _pct(h.success_rate);
  const d = hp - bp;

  const basePctEl = document.getElementById('m-base-pct');
  const baseBarEl = document.getElementById('m-base-bar') as HTMLProgressElement | null;
  const baseNEl = document.getElementById('m-base-n');

  const rlhfPctEl = document.getElementById('m-rlhf-pct');
  const rlhfBarEl = document.getElementById('m-rlhf-bar') as HTMLProgressElement | null;
  const rlhfNEl = document.getElementById('m-rlhf-n');

  const deltaEl = document.getElementById('m-delta');
  const updEl = document.getElementById('m-updated');

  if (!basePctEl) return; // panel not on page

  basePctEl.textContent = `${bp}%`;
  if (baseBarEl) baseBarEl.value = bp;
  if (baseNEl) baseNEl.textContent = `n = ${b.n || 0}`;

  if (rlhfPctEl) rlhfPctEl.textContent = `${hp}%`;
  if (rlhfBarEl) rlhfBarEl.value = hp;
  if (rlhfNEl) rlhfNEl.textContent = `n = ${h.n || 0}`;

  if (deltaEl) deltaEl.textContent = _fmtDelta(d);
  if (updEl) updEl.textContent = `Last 200 episodes • refreshed ${new Date().toLocaleTimeString()}`;
}

async function refreshMetrics(): Promise<void> {
  console.log('refreshMetrics called!'); // ADD THIS
  try {
    const m = await fetchMetrics();
    console.log('Metrics received:', m); // ADD THIS
    renderMetrics(m);
  } catch (e) {
    console.error('Metrics error:', e);
    const updEl = document.getElementById('m-updated');
    if (updEl) updEl.textContent = 'Metrics unavailable';
  }
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
  } else if (op.op === 'STOP') {
    (document.getElementById('inferenceBtn') as HTMLButtonElement).disabled = true;
    (document.getElementById('resetBtn') as HTMLButtonElement).disabled = false;
    const inputNextStepBtn = document.getElementById('input-next-step-btn') as HTMLButtonElement | null;
    if (inputNextStepBtn) inputNextStepBtn.disabled = true;
    const nextStepInput = document.getElementById('next-step-input') as HTMLInputElement | null;
    if (nextStepInput) nextStepInput.disabled = true;
    const submitNextStep = document.getElementById('submit-next-step') as HTMLButtonElement | null;
    if (submitNextStep) submitNextStep.disabled = true;
    const userActionInput = document.getElementById('user-action-input') as HTMLInputElement | null;
    if (userActionInput) userActionInput.disabled = true;
    const userActionBtn = Array.from(document.getElementsByTagName('button')).find(btn => btn.textContent === 'Submit user action');
    if (userActionBtn) userActionBtn.setAttribute('disabled', 'true');
    addCheckSimulationButton();
  }
  
  cy.layout({ name: 'preset' }).run();
  cy.fit(cy.elements(), 50);
}

async function nextStep(): Promise<void> {
  if (!traceLoaded) return;
  setLoading(true, 'Stepping...');
  const res = await fetch(`${API_BASE}/step`, { method: 'POST', credentials: 'include' });
  const { op, done } = await res.json();
  setLoading(false);
  if (done) {
    setButtonsEnabled(false);
    (document.getElementById('resetBtn') as HTMLButtonElement).disabled = false;
    return;
  }
  renderOp(op);
}

function addCheckSimulationButton(): void {
  const existing = document.getElementById('check-simulation-btn');
  if (existing && existing.parentElement) existing.parentElement.remove();
  
  const btn = document.createElement('button');
  btn.id = 'check-simulation-btn';
  btn.className = 'button is-primary is-medium';
  btn.textContent = 'Check Simulation';
  
  btn.onclick = async () => {
    btn.disabled = true;
    const outputElem = document.getElementById('output') as HTMLElement;
    outputElem.textContent = 'Checking simulation...';
    outputElem.style.color = '';
    
    try {
      const res = await fetch(`${API_BASE}/check_equivalence`, { method: 'POST', credentials: 'include' });
      const data = await res.json();
      if (data.result === true) {
        outputElem.textContent = 'Simulation result: YES (gadgets are equivalent)';
        outputElem.style.color = 'green';
      } else if (data.result === false) {
        outputElem.textContent = 'Simulation result: NO (gadgets are not equivalent)';
        outputElem.style.color = 'red';
      } else if (data.error) {
        outputElem.textContent = 'Error: ' + data.error;
        outputElem.style.color = '';
      } else {
        outputElem.textContent = 'Unknown response.';
        outputElem.style.color = '';
      }
    } catch (e) {
      outputElem.textContent = 'Error checking simulation.';
      outputElem.style.color = '';
    } finally {
      btn.disabled = false;
    }
  };
  
  const controlDiv = document.createElement('div');
  controlDiv.className = 'control';
  controlDiv.appendChild(btn);
  
  const controlsGroup = document.querySelector('.controls-group');
  const inputNextStepControl = document.getElementById('input-next-step-btn')?.parentElement;
  const inferenceControl = document.getElementById('inferenceBtn')?.parentElement;
  
  if (controlsGroup && inputNextStepControl) {
    controlsGroup.insertBefore(controlDiv, inputNextStepControl.nextSibling);
  } else if (controlsGroup && inferenceControl) {
    controlsGroup.insertBefore(controlDiv, inferenceControl.nextSibling);
  } else if (controlsGroup) {
    controlsGroup.appendChild(controlDiv);
  }
}

async function reset(): Promise<void> {
  if (!traceLoaded) return;
  setLoading(true, 'Resetting...');
  await fetch(`${API_BASE}/reset`, { method: 'POST', credentials: 'include' });
  cy.elements().remove();
  (document.getElementById('output') as HTMLElement).textContent = '';
  cy.layout({ name: 'preset' }).run();
  cy.center();
  
  if (selectedStart && selectedTarget) {
    const resp = await fetch(`${API_BASE}/init_gadgets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initial_gadgets: [selectedStart, selectedStart],
        target_gadget: selectedTarget
      }),
      credentials: 'include',
    });
    const { env_state } = await resp.json();
    await initFromBackend(env_state, [selectedStart, selectedStart], selectedTarget);
  } else {
    await initFromBackend();
  }
  
  (document.getElementById('inferenceBtn') as HTMLButtonElement).disabled = false;
  (document.getElementById('resetBtn') as HTMLButtonElement).disabled = false;
  const inputNextStepBtn = document.getElementById('input-next-step-btn') as HTMLButtonElement | null;
  if (inputNextStepBtn) inputNextStepBtn.disabled = false;
  const nextStepInput = document.getElementById('next-step-input') as HTMLInputElement | null;
  if (nextStepInput) nextStepInput.disabled = false;
  const submitNextStep = document.getElementById('submit-next-step') as HTMLButtonElement | null;
  if (submitNextStep) submitNextStep.disabled = false;
  setLoading(false);
  const checkBtn = document.getElementById('check-simulation-btn');
  if (checkBtn) checkBtn.remove();
}

// === GADGET SELECTION ===
const GADGET_INFO = {
  AP2T: { name: 'AP2T', desc: 'Anti-Parallel 2-Toggle: Horizontal traversals in opposite directions.' },
  C2T: { name: 'C2T', desc: 'Crossing 2-Toggle: Diagonal traversals.' },
  P2T: { name: 'P2T', desc: 'Parallel 2-Toggle: Horizontal traversals in parallel directions.' },
  NWT: { name: 'NWT', desc: 'Noncrossing-Wire Toggle: Allows a traversal until wire is crossed; crossing again allows re-traversing.' }
};

const GADGET_SVGS: Record<string, string> = {
  AP2T: `<svg width="90" height="90" viewBox="0 0 90 90"><rect x="15" y="15" width="60" height="60" rx="10" fill="#fff" stroke="#1976d2" stroke-width="3"/><line x1="15" y1="25" x2="75" y2="25" stroke="#1976d2" stroke-width="7" marker-end="url(#arrow)"/><line x1="75" y1="65" x2="15" y2="65" stroke="#1976d2" stroke-width="7" marker-end="url(#arrow)"/><defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0,0 6,3 0,6" fill="#1976d2"/></marker></defs></svg>`,
  C2T: `<svg width="90" height="90" viewBox="0 0 90 90"><rect x="15" y="15" width="60" height="60" rx="10" fill="#fff" stroke="#388e3c" stroke-width="3"/><line x1="15" y1="15" x2="75" y2="75" stroke="#388e3c" stroke-width="7" marker-end="url(#arrow)"/><line x1="75" y1="15" x2="15" y2="75" stroke="#fbc02d" stroke-width="7" marker-end="url(#arrow2)"/><defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0,0 6,3 0,6" fill="#388e3c"/></marker><marker id="arrow2" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0,0 6,3 0,6" fill="#fbc02d"/></marker></defs></svg>`,
  P2T: `<svg width="90" height="90" viewBox="0 0 90 90"><rect x="15" y="15" width="60" height="60" rx="10" fill="#fff" stroke="#7b1fa2" stroke-width="3"/><line x1="15" y1="25" x2="75" y2="25" stroke="#7b1fa2" stroke-width="7" marker-end="url(#arrow)"/><line x1="15" y1="65" x2="75" y2="65" stroke="#7b1fa2" stroke-width="7" marker-end="url(#arrow)"/><defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0,0 6,3 0,6" fill="#7b1fa2"/></marker></defs></svg>`,
  NWT: `<svg width="90" height="90" viewBox="0 0 90 90"><rect x="15" y="15" width="60" height="60" rx="10" fill="#fff" stroke="#616161" stroke-width="3"/><line x1="15" y1="45" x2="75" y2="45" stroke="#616161" stroke-width="7"/><line x1="45" y1="7" x2="45" y2="23" stroke="#111" stroke-width="7"/></svg>`
};

function renderGadgetCards(containerId: string, selectType: 'start' | 'target') {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  
  Object.entries(GADGET_INFO).forEach(([key, info]) => {
    const card = document.createElement('div');
    card.className = 'card m-4 p-4';
    card.style.width = '300px';
    card.style.minHeight = '200px';
    card.style.cursor = 'pointer';
    card.style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.justifyContent = 'center';
    card.style.alignItems = 'flex-start';
    card.dataset.gadget = key;
    card.innerHTML = `
      <div class="card-content p-3">  
        <div class="gadget-svg" style="height: 90px; margin-bottom: 1.2rem;">${GADGET_SVGS[key]}</div>
        <p class="title is-4" style="font-size: 1.5rem; margin-bottom: 1.2rem;">${info.name}</p>
        <p class="subtitle is-6" style="font-size: 1.1rem; margin-top: 0.5rem;">${info.desc}</p>
      </div>
    `;
    card.onclick = () => handleGadgetSelect(key, selectType, card);
    container.appendChild(card);
  });
}

let selectedStart: string | null = null;
let selectedTarget: string | null = null;

function handleGadgetSelect(gadget: string, type: 'start' | 'target', card: HTMLElement) {
  if (type === 'start') {
    selectedStart = gadget;
    const allCards = document.querySelectorAll('#start-gadget-cards .card');
    allCards.forEach(c => c.classList.remove('has-background-info-light'));
    card.classList.add('has-background-info-light');
  } else {
    selectedTarget = gadget;
    const allCards = document.querySelectorAll('#target-gadget-cards .card');
    allCards.forEach(c => c.classList.remove('has-background-success-light'));
    card.classList.add('has-background-success-light');
  }
  updateStartButtonState();
}

function updateStartButtonState() {
  const btn = document.getElementById('startSessionBtn') as HTMLButtonElement;
  btn.disabled = !(!!selectedStart && !!selectedTarget);
}

// === INPUT MODAL ===
function createInputNextStepModal() {
  const modal = document.createElement('div');
  modal.id = 'input-next-step-modal';
  modal.style.display = 'none';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100vw';
  modal.style.height = '100vh';
  modal.style.background = 'rgba(0,0,0,0.4)';
  modal.style.zIndex = '1000';
  modal.innerHTML = `
    <div style="background: #fff; max-width: 480px; margin: 10vh auto; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 16px rgba(0,0,0,0.18); position: relative;">
      <button id="close-next-step-modal" style="position: absolute; top: 1rem; right: 1rem; background: none; border: none; font-size: 1.5rem; cursor: pointer;">&times;</button>
      <h2 class="title is-4">Input Next Step</h2>
      <input id="next-step-input" class="input mb-2" type="text" placeholder="e.g. COMBINE(g1, g0, rot=2, splice=3)" style="width: 100%;" />
      <button id="submit-next-step" class="button is-primary mt-2">Submit</button>
      <div class="mt-4">
        <strong>Examples:</strong>
        <ul style="font-size: 0.95em; margin-top: 0.5em;">
          <li>STOP</li>
          <li>CONNECT gadget 0 ports 5 and 2</li>
          <li>COMBINE gadgets 1 and 0 (rot=2, splice=3)</li>
        </ul>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  
  document.getElementById('close-next-step-modal')!.onclick = () => {
    modal.style.display = 'none';
  };
  
  document.getElementById('submit-next-step')!.onclick = async () => {
    const input = (document.getElementById('next-step-input') as HTMLInputElement).value.trim();
    if (!input) {
      alert('Please enter an action.');
      return;
    }
    const res = await fetch(`${API_BASE}/apply_action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: input, actor: 'user' }),
      credentials: 'include',
    });
    const result = await res.json();
    if (!result.success) {
      alert('Failed: ' + (result.error || 'Unknown error'));
    } else {
      renderOp(result.op);
      modal.style.display = 'none';
      (document.getElementById('next-step-input') as HTMLInputElement).value = '';
    }
  };
}

function addInputNextStepButton() {
  const btn = document.createElement('button');
  btn.id = 'input-next-step-btn';
  btn.className = 'button is-info is-medium';
  btn.textContent = 'Input Next Step';
  btn.onclick = () => {
    const modal = document.getElementById('input-next-step-modal')!;
    modal.style.display = 'block';
    (document.getElementById('next-step-input') as HTMLInputElement).focus();
  };
  
  const controlDiv = document.createElement('div');
  controlDiv.className = 'control';
  controlDiv.appendChild(btn);
  
  const controlsGroup = document.querySelector('.controls-group');
  const inferenceControl = document.getElementById('inferenceBtn')?.parentElement;
  if (controlsGroup && inferenceControl) {
    controlsGroup.insertBefore(controlDiv, inferenceControl.nextSibling);
  } else if (controlsGroup) {
    controlsGroup.appendChild(controlDiv);
  }
}

function setupEnhancedInteractions() {
  // Add mode selector UI
  const controlsGroup = document.querySelector('.controls-group');
  if (controlsGroup && !document.querySelector('.mode-selector')) {
    const modeDiv = document.createElement('div');
    modeDiv.className = 'control';
    modeDiv.innerHTML = `
      <div class="buttons has-addons">
        <button class="button mode-btn" data-mode="select">Select</button>
        <button class="button mode-btn" data-mode="combine">Combine (C)</button>
        <button class="button mode-btn" data-mode="connect">Connect (X)</button>
      </div>
    `;
    controlsGroup.insertBefore(modeDiv, controlsGroup.firstChild);
  }
  
  // Mode button handlers
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-mode') as 'combine' | 'connect' | 'select';
      setMode(mode);
    });
  });
  
  // Set default mode
  setMode('select');
  
  // Cytoscape drag-drop events
  cy.on('grab', 'node[gadget]', function(evt: any) {
    if (currentMode === 'combine') {
      draggedNode = evt.target;
      dragStartPos = { x: draggedNode.position('x'), y: draggedNode.position('y') };
      draggedNode.addClass('dragging');
    }
  });
  
  cy.on('drag', 'node[gadget]', function(evt: any) {
    if (currentMode === 'combine' && draggedNode) {
      cy.nodes('[gadget]').forEach((node: any) => {
        if (node.id() !== draggedNode.id()) {
          const dist = Math.sqrt(
            Math.pow(draggedNode.position('x') - node.position('x'), 2) +
            Math.pow(draggedNode.position('y') - node.position('y'), 2)
          );
          if (dist < 80) {
            node.addClass('drop-target');
          } else {
            node.removeClass('drop-target');
          }
        }
      });
    }
  });
  
  cy.on('free', 'node[gadget]', function(evt: any) {
    if (currentMode === 'combine' && draggedNode) {
      const dropTarget = cy.nodes('.drop-target').first();
      if (dropTarget && dropTarget.length > 0) {
        showCombineDialog(draggedNode.id(), dropTarget.id());
      }
      if (dragStartPos) {
        draggedNode.position(dragStartPos);
      }
      draggedNode.removeClass('dragging');
      cy.nodes().removeClass('drop-target');
      draggedNode = null;
      dragStartPos = null;
    }
  });
  
  // Port connection events
  cy.on('tap', 'node[port]', function(evt: any) {
    if (currentMode === 'connect') {
      evt.stopPropagation();
      const port = evt.target;
      
      if (!connectingPort) {
        connectingPort = port;
        port.addClass('connecting');
      } else if (port.id() !== connectingPort.id()) {
        const p1Data = connectingPort.data();
        const p2Data = port.data();
        
        fetch(`${API_BASE}/apply_action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: `CONNECT(${p1Data.parentGadget}, ${p1Data.label}, ${p2Data.label})`,
            actor: 'user'
          }),
          credentials: 'include'
        }).then(res => res.json()).then(result => {
          if (result.success) {
            renderOp(result.op);
          }
        });
        
        connectingPort.removeClass('connecting');
        connectingPort = null;
      }
    }
  });
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    
    switch(e.key.toLowerCase()) {
      case 'c':
        if (!e.metaKey && !e.ctrlKey) setMode('combine');
        break;
      case 'x':
        setMode('connect');
        break;
      case 'v':
        setMode('select');
        break;
      case 'escape':
        if (connectingPort) {
          connectingPort.removeClass('connecting');
          connectingPort = null;
        }
        break;
    }
  });
}

function setMode(mode: 'combine' | 'connect' | 'select') {
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('is-primary', btn.getAttribute('data-mode') === mode);
  });
  
  // Cancel any in-progress actions
  if (connectingPort) {
    connectingPort.removeClass('connecting');
    connectingPort = null;
  }
}

function showCombineDialog(g1: string, g2: string) {
  let dialog = document.getElementById('combine-params-modal');
  if (!dialog) {
    dialog = document.createElement('div');
    dialog.id = 'combine-params-modal';
    dialog.className = 'modal is-active';
    dialog.innerHTML = `
      <div class="modal-background"></div>
      <div class="modal-content">
        <div class="box">
          <h3 class="title is-4">Combine Parameters</h3>
          <div class="field">
            <label class="label">Rotation (0-3)</label>
            <input type="range" id="rot-slider" min="0" max="3" value="0" class="slider is-fullwidth">
            <p class="help">Value: <span id="rot-value">0</span></p>
          </div>
          <div class="field">
            <label class="label">Splice (0-3)</label>
            <input type="range" id="splice-slider" min="0" max="3" value="0" class="slider is-fullwidth">
            <p class="help">Value: <span id="splice-value">0</span></p>
          </div>
          <button class="button is-primary" id="apply-combine-btn">Apply</button>
          <button class="button ml-2" id="cancel-combine-btn">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);
    
    const rotSlider = document.getElementById('rot-slider') as HTMLInputElement;
    const spliceSlider = document.getElementById('splice-slider') as HTMLInputElement;
    
    rotSlider.oninput = () => {
      document.getElementById('rot-value')!.textContent = rotSlider.value;
    };
    
    spliceSlider.oninput = () => {
      document.getElementById('splice-value')!.textContent = spliceSlider.value;
    };
    
    document.getElementById('apply-combine-btn')!.onclick = async () => {
      const res = await fetch(`${API_BASE}/apply_action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: `COMBINE(${g1}, ${g2}, rot=${rotSlider.value}, splice=${spliceSlider.value})`,
          actor: 'user'
        }),
        credentials: 'include'
      });
      const result = await res.json();
      if (result.success) {
        renderOp(result.op);
      }
      dialog!.classList.remove('is-active');
    };
    
    document.getElementById('cancel-combine-btn')!.onclick = () => {
      dialog!.classList.remove('is-active');
    };
  } else {
    dialog.classList.add('is-active');
  }
}

// === MODEL INFERENCE ===
async function inferModelStep(): Promise<void> {
  try {
    const modelName = modelSelect?.value;
    const response = await fetch(`${API_BASE}/infer_next_step`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName }),
      credentials: 'include',
    });
    const data = await response.json();

    const suggestionDiv = document.getElementById('model-suggestion') as HTMLElement;
    const suggestionBox = document.getElementById('model-suggestion-box');
    const topActionsList = document.getElementById('top-actions') as HTMLElement;

    suggestionDiv.textContent = '';
    topActionsList.innerHTML = '';

    if (data.description) {
      suggestionDiv.innerHTML = `Model suggests: ${data.description}<span title="${data.tooltip || ''}" style="cursor: help;"> - confused?</span>`;
    }
    if (Array.isArray(data.top_actions)) {
      data.top_actions.forEach(({ action_desc, confidence }: any) => {
        const li = document.createElement('li');
        li.textContent = `${action_desc} (${(confidence * 100).toFixed(1)}%)`;
        topActionsList.appendChild(li);
      });
    }

    const suggestion = data.description || '';

    const acceptBtn = document.createElement('button');
    acceptBtn.textContent = 'Accept agent action';
    acceptBtn.classList.add('button', 'is-small', 'is-success');

    const denyBtn = document.createElement('button');
    denyBtn.textContent = 'Deny agent action';
    denyBtn.classList.add('button', 'is-small', 'is-danger');

    denyBtn.onclick = async () => {
      try {
        suggestionDiv.textContent = 'Agent action denied.';
        await fetch(`${API_BASE}/rlhf_response`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ action: suggestion, response: false }),
        });
      } catch (e) {
        console.error('rlhf_response (deny) failed', e);
      } finally {
        acceptBtn.remove();
        denyBtn.remove();
        (document.getElementById('resetBtn') as HTMLButtonElement).disabled = false;
        (document.getElementById('inferenceBtn') as HTMLButtonElement).disabled = false;
      }
    };

    acceptBtn.onclick = async () => {
      try {
        acceptBtn.disabled = true;
        denyBtn.disabled = true;

        const res = await fetch(`${API_BASE}/apply_action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ action: suggestion, actor: 'agent' }),
        });
        const result = await res.json();
        if (!result.success) {
          alert('Failed: ' + result.error);
          return;
        }
        renderOp(result.op);

        await fetch(`${API_BASE}/rlhf_response`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ action: suggestion, response: true }),
        });
      } catch (e) {
        console.error('accept flow failed', e);
      } finally {
        suggestionDiv.textContent = '';
        acceptBtn.remove();
        denyBtn.remove();
        (document.getElementById('resetBtn') as HTMLButtonElement).disabled = false;
        (document.getElementById('inferenceBtn') as HTMLButtonElement).disabled = false;
      }
    };

    suggestionBox?.appendChild(denyBtn);
    suggestionBox?.appendChild(acceptBtn);
  } catch (err) {
    console.error('Error fetching model suggestion:', err);
  }
}

// === MAIN INITIALIZATION ===
document.addEventListener('DOMContentLoaded', () => {
  const simSection = document.querySelectorAll('.section');
  if (simSection.length > 1) (simSection[1] as HTMLElement).style.display = 'none';

  

  const backBtn = document.getElementById('back-to-gadget-select') as HTMLButtonElement | null;
  if (backBtn) {
    backBtn.style.display = 'none';
    backBtn.onclick = () => {
      if (simSection.length > 1) (simSection[1] as HTMLElement).style.display = 'none';
      const landingSection = document.getElementById('landing-section');
      if (landingSection) landingSection.style.display = '';
      traceLoaded = false;
      cy.elements().remove();
      (document.getElementById('output') as HTMLElement).textContent = '';
      (document.getElementById('inferenceBtn') as HTMLButtonElement).disabled = true;
      (document.getElementById('resetBtn') as HTMLButtonElement).disabled = true;
      const inputNextStepBtn = document.getElementById('input-next-step-btn') as HTMLButtonElement | null;
      if (inputNextStepBtn) inputNextStepBtn.disabled = true;
      const nextStepInput = document.getElementById('next-step-input') as HTMLInputElement | null;
      if (nextStepInput) nextStepInput.disabled = true;
      const submitNextStep = document.getElementById('submit-next-step') as HTMLButtonElement | null;
      if (submitNextStep) submitNextStep.disabled = true;
      if (backBtn) backBtn.style.display = 'none';
    };
  }

  setButtonsEnabled(false);
  
  const resetBtn = document.getElementById('resetBtn') as HTMLButtonElement;
  const inferenceBtn = document.getElementById('inferenceBtn') as HTMLButtonElement;
  
  resetBtn.addEventListener('click', reset);
  inferenceBtn.addEventListener('click', inferModelStep);
  
  renderGadgetCards('start-gadget-cards', 'start');
  renderGadgetCards('target-gadget-cards', 'target');
  
  const startBtn = document.getElementById('startSessionBtn');
  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      if (!selectedStart || !selectedTarget) return;
      setLoading(true, 'Initializing environment...');
      const resp = await fetch(`${API_BASE}/init_gadgets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initial_gadgets: [selectedStart, selectedStart],
          target_gadget: selectedTarget
        }),
        credentials: 'include',
      });
      if (!resp.ok) {
        setLoading(false);
        alert('Failed to initialize environment');
        return;
      }
      await fetch(`${API_BASE}/reset`, { method: 'POST', credentials: 'include' });
      const { env_state } = await resp.json();
      document.getElementById('landing-section')!.style.display = 'none';
      const simSection = document.querySelectorAll('.section');
      if (simSection.length > 1) (simSection[1] as HTMLElement).style.display = '';

      console.log('Testing direct metrics fetch...');
      fetch(`${API_BASE}/metrics`, { credentials: 'include' })
        .then(r => r.json())
        .then(data => console.log('Direct metrics data:', data))
        .catch(err => console.error('Direct metrics error:', err));

      refreshMetrics();
      setInterval(refreshMetrics, 5000);
      
      if (backBtn) backBtn.style.display = '';
      traceLoaded = true;
      setButtonsEnabled(true);
      await initFromBackend(env_state, [selectedStart, selectedStart], selectedTarget);
      setLoading(false);
      
      setupEnhancedInteractions();
    });
  }
  
  
  createInputNextStepModal();
  addInputNextStepButton();
});

window.nextStep = nextStep;
window.reset = reset;