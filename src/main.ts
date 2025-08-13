// main.js - PIEFACE v2.1 with Enhanced Interactions
import { makePortList } from './helpers.js';
import {
  addGadgetNode,
  addPortNode,
  addPortEdge,
  addCompoundNode,
  relabelGadgetPorts
} from './graph.js';

declare const cytoscape: any;

// API Configuration
const API_BASE = "https://api.pieface.ai";
const modelSelect = document.getElementById('modelSelect') as HTMLSelectElement | null;

// Gadget Configuration
const GADGET_PORTS: Record<string, number> = {
  'AP2T': 4,
  'C2T': 4,
  'P2T': 4,
  'NWT': 4,
};

// State Management
const gadgets: Record<string, any> = {};
let gadgetIdCounter = 0;
const combinedGroups: string[][] = [];
const groupPortMaps: Record<string, any[]> = {};
let traceLoaded = false;
let selectedStart: string | null = null;
let selectedTarget: string | null = null;

// New interaction state
let currentMode: 'combine' | 'connect' | 'select' = 'combine';
let draggedGadget: any = null;
let dragStartPosition: { x: number, y: number } | null = null;
let connectingPort: any = null;
let connectionPreview: any = null;
let actionHistory: any[] = [];

// Initialize Cytoscape
const cy = cytoscape({
  container: document.getElementById('cy'),
  elements: [],
  style: [
    {
      selector: 'node[gadget]',
      style: {
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
      selector: 'node[port]',
      style: {
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
        'curve-style': 'unbundled-bezier',
        'control-point-step-size': 40,
        'edge-distances': 'node-position',
        'target-arrow-shape': 'triangle',
        'width': 2,
        'z-index': 50
      }
    },
    {
      selector: '.dragging',
      style: {
        'opacity': 0.5
      }
    },
    {
      selector: '.drop-target',
      style: {
        'border-width': 4,
        'border-color': '#48c774',
        'background-color': '#e6ffed'
      }
    },
    {
      selector: '.connecting',
      style: {
        'background-color': '#3273dc',
        'width': 20,
        'height': 20
      }
    }
  ],
  layout: { name: 'preset' }
});

// ============= NEW INTERACTION SYSTEM =============

// Initialize interaction modes
function initializeInteractionModes() {
  // Create mode selector if it doesn't exist
  if (!document.querySelector('.mode-selector')) {
    const controlsGroup = document.querySelector('.controls-group');
    if (controlsGroup) {
      const modeSelector = document.createElement('div');
      modeSelector.className = 'control';
      modeSelector.innerHTML = `
        <div class="mode-selector" style="display: inline-flex; border: 1px solid #dbdbdb; border-radius: 4px; overflow: hidden;">
          <button class="mode-btn active" data-mode="combine" style="padding: 0.5rem 1rem; background: #3273dc; color: white; border: none; cursor: pointer;">
            🔗 Combine <kbd style="font-size: 0.75rem; margin-left: 0.25rem;">C</kbd>
          </button>
          <button class="mode-btn" data-mode="connect" style="padding: 0.5rem 1rem; background: white; border: none; border-left: 1px solid #dbdbdb; cursor: pointer;">
            ↔️ Connect <kbd style="font-size: 0.75rem; margin-left: 0.25rem;">X</kbd>
          </button>
          <button class="mode-btn" data-mode="select" style="padding: 0.5rem 1rem; background: white; border: none; border-left: 1px solid #dbdbdb; cursor: pointer;">
            👆 Select <kbd style="font-size: 0.75rem; margin-left: 0.25rem;">V</kbd>
          </button>
        </div>
      `;
      controlsGroup.insertBefore(modeSelector, controlsGroup.firstChild);
    }
  }

  // Setup mode button clicks
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-mode') as 'combine' | 'connect' | 'select';
      if (mode) setMode(mode);
    });
  });
}

// Set interaction mode
function setMode(mode: 'combine' | 'connect' | 'select') {
  currentMode = mode;
  
  // Update button styles
  document.querySelectorAll('.mode-btn').forEach(btn => {
    const isActive = btn.getAttribute('data-mode') === mode;
    btn.classList.toggle('active', isActive);
    (btn as HTMLElement).style.background = isActive ? '#3273dc' : 'white';
    (btn as HTMLElement).style.color = isActive ? 'white' : 'black';
  });
  
  // Cancel any in-progress actions
  cancelCurrentAction();
  
  // Update status display
  const modeDescriptions = {
    'combine': 'COMBINE - Drag one gadget onto another',
    'connect': 'CONNECT - Click ports to connect them',
    'select': 'SELECT - Click to inspect elements'
  };
  
  updateStatus(modeDescriptions[mode]);
}

// Setup Cytoscape drag-drop events
function setupDragDropEvents() {
  let isDragging = false;
  
  // Drag start
  cy.on('grab', 'node[gadget]', function(evt: any) {
    if (currentMode === 'combine') {
      draggedGadget = evt.target;
      dragStartPosition = {
        x: draggedGadget.position('x'),
        y: draggedGadget.position('y')
      };
      isDragging = true;
      draggedGadget.addClass('dragging');
      updateStatus('Drop on another gadget to combine');
    }
  });
  
  // During drag
  cy.on('drag', 'node[gadget]', function(evt: any) {
    if (currentMode === 'combine' && isDragging && draggedGadget) {
      // Check for nearby gadgets
      cy.nodes('[gadget]').forEach((node: any) => {
        if (node.id() !== draggedGadget.id()) {
          const distance = getDistance(
            draggedGadget.position(),
            node.position()
          );
          
          if (distance < 80) {
            node.addClass('drop-target');
          } else {
            node.removeClass('drop-target');
          }
        }
      });
    }
  });
  
  // Drag end
  cy.on('free', 'node[gadget]', function(evt: any) {
    if (currentMode === 'combine' && isDragging) {
      const dropTarget = cy.nodes('.drop-target').first();
      
      if (dropTarget && dropTarget.length > 0) {
        showCombineDialog(draggedGadget.id(), dropTarget.id());
      }
      
      // Reset position
      if (dragStartPosition) {
        draggedGadget.position(dragStartPosition);
      }
      
      // Clean up
      draggedGadget.removeClass('dragging');
      cy.nodes().removeClass('drop-target');
      isDragging = false;
      draggedGadget = null;
      dragStartPosition = null;
      updateStatus('COMBINE - Drag one gadget onto another');
    }
  });
}

// Setup port connection events
function setupConnectionEvents() {
  // Click on ports
  cy.on('tap', 'node[port]', function(evt: any) {
    if (currentMode === 'connect') {
      evt.stopPropagation();
      const port = evt.target;
      
      if (!connectingPort) {
        // Start connection
        connectingPort = port;
        port.addClass('connecting');
        updateStatus('Click another port to complete connection');
        startConnectionPreview(port);
      } else if (port.id() !== connectingPort.id()) {
        // Complete connection
        executeConnect(connectingPort, port);
        connectingPort.removeClass('connecting');
        connectingPort = null;
        clearConnectionPreview();
        updateStatus('CONNECT - Click ports to connect them');
      }
    }
  });
  
  // Mouse move for preview line
  cy.on('mousemove', function(evt: any) {
    if (connectingPort && connectionPreview) {
      updateConnectionPreview(evt.position);
    }
  });
  
  // Cancel on background click
  cy.on('tap', function(evt: any) {
    if (evt.target === cy && connectingPort) {
      connectingPort.removeClass('connecting');
      connectingPort = null;
      clearConnectionPreview();
      updateStatus('Connection cancelled');
    }
  });
}

// Connection preview
function startConnectionPreview(port: any) {
  // Create a temporary edge for preview
  const pos = port.position();
  connectionPreview = cy.add({
    group: 'edges',
    data: {
      id: 'preview-edge',
      source: port.id(),
      target: port.id()
    },
    style: {
      'line-style': 'dashed',
      'line-color': '#3273dc',
      'target-arrow-color': '#3273dc',
      'opacity': 0.5
    }
  });
}

function updateConnectionPreview(mousePos: any) {
  if (connectionPreview) {
    // Create temporary node at mouse position
    const tempId = 'temp-preview-node';
    cy.remove(`#${tempId}`);
    
    cy.add({
      group: 'nodes',
      data: { id: tempId },
      position: mousePos,
      style: { 'opacity': 0, 'width': 1, 'height': 1 }
    });
    
    connectionPreview.move({ target: tempId });
  }
}

function clearConnectionPreview() {
  if (connectionPreview) {
    cy.remove('#preview-edge');
    cy.remove('#temp-preview-node');
    connectionPreview = null;
  }
}

// Show combine dialog
function showCombineDialog(gadget1: string, gadget2: string) {
  // Create dialog if it doesn't exist
  let dialog = document.getElementById('combine-dialog');
  if (!dialog) {
    dialog = document.createElement('div');
    dialog.id = 'combine-dialog';
    dialog.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
      z-index: 1000;
      min-width: 300px;
    `;
    dialog.innerHTML = `
      <h3 class="title is-5">Combine Parameters</h3>
      <div class="field">
        <label class="label">Rotation (0-3)</label>
        <input type="range" id="rotation-param" min="0" max="3" value="0" class="slider is-fullwidth">
        <p class="help">Value: <span id="rotation-value">0</span> (Use ↑↓ arrows)</p>
      </div>
      <div class="field">
        <label class="label">Splice Position (0-3)</label>
        <input type="range" id="splice-param" min="0" max="3" value="0" class="slider is-fullwidth">
        <p class="help">Value: <span id="splice-value">0</span> (Use ←→ arrows)</p>
      </div>
      <div class="field is-grouped">
        <div class="control">
          <button class="button is-primary" id="apply-combine">Apply</button>
        </div>
        <div class="control">
          <button class="button" id="cancel-combine">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);
    
    // Setup event listeners
    const rotSlider = document.getElementById('rotation-param') as HTMLInputElement;
    const spliceSlider = document.getElementById('splice-param') as HTMLInputElement;
    
    rotSlider?.addEventListener('input', () => {
      const rotValue = document.getElementById('rotation-value');
      if (rotValue) rotValue.textContent = rotSlider.value;
    });
    
    spliceSlider?.addEventListener('input', () => {
      const spliceValue = document.getElementById('splice-value');
      if (spliceValue) spliceValue.textContent = spliceSlider.value;
    });
    
    document.getElementById('apply-combine')?.addEventListener('click', () => {
      const rot = rotSlider?.value || '0';
      const splice = spliceSlider?.value || '0';
      executeCombine(gadget1, gadget2, parseInt(rot), parseInt(splice));
      dialog!.style.display = 'none';
    });
    
    document.getElementById('cancel-combine')?.addEventListener('click', () => {
      dialog!.style.display = 'none';
    });
  }
  
  // Reset and show dialog
  dialog.style.display = 'block';
  (document.getElementById('rotation-param') as HTMLInputElement).value = '0';
  (document.getElementById('splice-param') as HTMLInputElement).value = '0';
  (document.getElementById('rotation-value') as HTMLElement).textContent = '0';
  (document.getElementById('splice-value') as HTMLElement).textContent = '0';
}

// Execute combine action
async function executeCombine(g1: string, g2: string, rot: number, splice: number) {
  try {
    const response = await fetch(`${API_BASE}/apply_action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: `COMBINE(${g1}, ${g2}, rot=${rot}, splice=${splice})`,
        actor: 'user'
      }),
      credentials: 'include'
    });
    
    const result = await response.json();
    if (result.success) {
      renderOp(result.op);
      actionHistory.push(result.op);
      showToast(`Combined ${g1} with ${g2}`, 'success');
    } else {
      showToast('Failed: ' + result.error, 'error');
    }
  } catch (error) {
    console.error('Combine failed:', error);
    showToast('Network error', 'error');
  }
}

// Execute connect action
async function executeConnect(port1: any, port2: any) {
  const p1Data = port1.data();
  const p2Data = port2.data();
  
  try {
    const response = await fetch(`${API_BASE}/apply_action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: `CONNECT(${p1Data.parentGadget}, ${p1Data.label}, ${p2Data.label})`,
        actor: 'user'
      }),
      credentials: 'include'
    });
    
    const result = await response.json();
    if (result.success) {
      renderOp(result.op);
      actionHistory.push(result.op);
      
      // Add visual edge
      addPortEdge(cy, gadgets, p1Data.parentGadget, p1Data.label, p2Data.parentGadget, p2Data.label);
      
      showToast(`Connected port ${p1Data.label} to ${p2Data.label}`, 'success');
    } else {
      showToast('Failed: ' + result.error, 'error');
    }
  } catch (error) {
    console.error('Connect failed:', error);
    showToast('Network error', 'error');
  }
}

// Keyboard shortcuts
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Don't trigger if typing in input
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
      case 's':
        executeStop();
        break;
      case 'z':
        if (e.metaKey || e.ctrlKey) executeUndo();
        break;
      case 'escape':
        cancelCurrentAction();
        break;
      case 'arrowup':
        adjustDialogParam('rotation', 1);
        e.preventDefault();
        break;
      case 'arrowdown':
        adjustDialogParam('rotation', -1);
        e.preventDefault();
        break;
      case 'arrowleft':
        adjustDialogParam('splice', -1);
        e.preventDefault();
        break;
      case 'arrowright':
        adjustDialogParam('splice', 1);
        e.preventDefault();
        break;
    }
  });
}

// Adjust dialog parameters with arrow keys
function adjustDialogParam(param: 'rotation' | 'splice', delta: number) {
  const dialog = document.getElementById('combine-dialog');
  if (dialog && dialog.style.display !== 'none') {
    const slider = document.getElementById(`${param}-param`) as HTMLInputElement;
    if (slider) {
      let value = parseInt(slider.value) + delta;
      value = Math.max(0, Math.min(3, value));
      slider.value = value.toString();
      
      const display = document.getElementById(`${param}-value`);
      if (display) display.textContent = value.toString();
    }
  }
}

// Cancel current action
function cancelCurrentAction() {
  if (connectingPort) {
    connectingPort.removeClass('connecting');
    connectingPort = null;
    clearConnectionPreview();
  }
  
  if (draggedGadget) {
    draggedGadget.removeClass('dragging');
    cy.nodes().removeClass('drop-target');
    if (dragStartPosition) {
      draggedGadget.position(dragStartPosition);
    }
    draggedGadget = null;
    dragStartPosition = null;
  }
  
  const dialog = document.getElementById('combine-dialog');
  if (dialog) dialog.style.display = 'none';
}

// Execute stop
async function executeStop() {
  try {
    const response = await fetch(`${API_BASE}/apply_action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'STOP', actor: 'user' }),
      credentials: 'include'
    });
    
    const result = await response.json();
    if (result.success) {
      renderOp(result.op);
      showToast('Simulation stopped', 'success');
      checkSimulation();
    }
  } catch (error) {
    console.error('Stop failed:', error);
  }
}

// Execute undo
function executeUndo() {
  if (actionHistory.length > 0) {
    const lastAction = actionHistory.pop();
    showToast('Undo: ' + JSON.stringify(lastAction), 'info');
    // Note: Full undo would require backend support
  }
}

// Check simulation
async function checkSimulation() {
  try {
    const res = await fetch(`${API_BASE}/check_equivalence`, {
      method: 'POST',
      credentials: 'include'
    });
    const data = await res.json();
    
    const output = document.getElementById('output');
    if (output) {
      if (data.result === true) {
        output.textContent = '✓ Gadgets are equivalent!';
        output.style.color = 'green';
      } else if (data.result === false) {
        output.textContent = '✗ Gadgets are not equivalent';
        output.style.color = 'red';
      } else {
        output.textContent = 'Simulation check failed';
      }
    }
  } catch (error) {
    console.error('Check simulation failed:', error);
  }
}

// ============= UTILITY FUNCTIONS =============

function getDistance(pos1: {x: number, y: number}, pos2: {x: number, y: number}): number {
  return Math.sqrt(Math.pow(pos1.x - pos2.x, 2) + Math.pow(pos1.y - pos2.y, 2));
}

function updateStatus(message: string) {
  const output = document.getElementById('output');
  if (output) output.textContent = message;
}

function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
  const toast = document.createElement('div');
  toast.className = `notification is-${type}`;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 2000;
    min-width: 250px;
    animation: slideIn 0.3s ease;
  `;
  toast.innerHTML = `
    <button class="delete"></button>
    ${message}
  `;
  
  document.body.appendChild(toast);
  
  toast.querySelector('.delete')?.addEventListener('click', () => {
    toast.remove();
  });
  
  setTimeout(() => toast.remove(), 3000);
}

// ============= ORIGINAL FUNCTIONS (PRESERVED) =============

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
  const target = targetGadget || (state.target_gadget || 'Unknown');

  // Update info panels
  const initialList = document.getElementById('initial-gadgets') as HTMLElement;
  initialList.innerHTML = '';
  initials.forEach((g: any) => {
    const li = document.createElement('li');
    li.textContent = typeof g === 'string' ? g : (g.type || g.label || g.id || JSON.stringify(g));
    initialList.appendChild(li);
  });
  (document.getElementById('target-gadget') as HTMLElement).textContent = target;

  // Populate the graph
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

function renderOp(op: any): void {
  (document.getElementById('output') as HTMLElement).textContent = JSON.stringify(op) + '\n';
  
  if (op.op === 'COMBINE') {
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
    
    cy.$(`#${groupId}`).style({
      'background-opacity': 0,
      'border-width': 3,
      'border-color': '#888',
      'border-style': 'dashed',
      'label': '',
      'z-index': 1
    });
  } else if (op.op === 'CONNECT') {
    const [, srcIdx, dstIdx] = op.args;
    const allPorts = Object.values(groupPortMaps).flat();
    const src = allPorts.find((port: any) => port.port === +srcIdx);
    const dst = allPorts.find((port: any) => port.port === +dstIdx);
    
    if (src && dst) {
      addPortEdge(cy, gadgets, src.gadget, src.port, dst.gadget, dst.port);
      cy.$(`#${src.gadget}_port_${src.port}`).addClass('connected');
      cy.$(`#${dst.gadget}_port_${dst.port}`).addClass('connected');
    }
  } else if (op.op === 'STOP') {
    (document.getElementById('inferenceBtn') as HTMLButtonElement).disabled = true;
    (document.getElementById('resetBtn') as HTMLButtonElement).disabled = false;
    addCheckSimulationButton();
  }
  
  cy.layout({ name: 'preset' }).run();
  cy.fit(cy.elements(), 50);
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
  setLoading(false);
  
  const checkBtn = document.getElementById('check-simulation-btn');
  if (checkBtn) checkBtn.remove();
}

function addCheckSimulationButton(): void {
  // Remove if already exists
  const existing = document.getElementById('check-simulation-btn');
  if (existing && existing.parentElement) {
    existing.parentElement.remove();
  }
  
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
      const res = await fetch(`${API_BASE}/check_equivalence`, { 
        method: 'POST', 
        credentials: 'include' 
      });
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
  
  // Wrap in a .control div
  const controlDiv = document.createElement('div');
  controlDiv.className = 'control';
  controlDiv.appendChild(btn);
  
  // Insert after Input Next Step control if present, else after Agent Next Step
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

// ============= INITIALIZATION =============

document.addEventListener('DOMContentLoaded', () => {
  // Initialize interaction modes
  initializeInteractionModes();
  
  // Setup drag-drop and connection events
  setupDragDropEvents();
  setupConnectionEvents();
  
  // Setup keyboard shortcuts
  setupKeyboardShortcuts();
  
  const resetBtn = document.getElementById('resetBtn') as HTMLButtonElement;
  if (resetBtn) {
    resetBtn.addEventListener('click', reset);
  }
  
  // Add stop button listener
  const stopBtn = document.getElementById('stopBtn');
  if (!stopBtn) {
    // Create stop button if it doesn't exist
    const controlsGroup = document.querySelector('.controls-group');
    if (controlsGroup) {
      const stopControl = document.createElement('div');
      stopControl.className = 'control';
      stopControl.innerHTML = '<button class="button is-danger is-medium" id="stopBtn">Stop (S)</button>';
      controlsGroup.appendChild(stopControl);
      
      document.getElementById('stopBtn')?.addEventListener('click', executeStop);
    }
  } else {
    stopBtn.addEventListener('click', executeStop);
  }
  
  console.log('PIEFACE Enhanced Interactions initialized');
});

(window as any).reset = reset;
(window as any).setMode = setMode;
(window as any).executeStop = executeStop;