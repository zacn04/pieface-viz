var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { makePortList } from './helpers.js';
import { addGadgetNode, addPortNode, addPortEdge, addCompoundNode, relabelGadgetPorts } from './graph.js';
const API_BASE = "https://api.pieface.ai";
const modelSelect = document.getElementById('modelSelect');
const GADGET_PORTS = {
    'AP2T': 4,
    'C2T': 4,
    'P2T': 4,
    'NWT': 4,
};
const gadgets = {};
let gadgetIdCounter = 0;
const combinedGroups = [];
const groupPortMaps = {};
// Enhanced interaction state
let currentMode = 'select'; // Default to select
let draggedNode = null;
let dragStartPos = null;
let connectingPort = null;
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
function sendTraceToBackend(trace) {
    return __awaiter(this, void 0, void 0, function* () {
        const res = yield fetch(`${API_BASE}/upload_trace`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(trace)
        });
        if (!res.ok)
            throw new Error('Failed to upload trace to backend');
        return res.json();
    });
}
let traceLoaded = false;
function setLoading(isLoading, message = '') {
    const output = document.getElementById('output');
    if (isLoading) {
        output.textContent = message || 'Loading...';
    }
    else if (!traceLoaded) {
        output.textContent = '';
    }
}
function setButtonsEnabled(enabled) {
    document.getElementById('resetBtn').disabled = !enabled;
    document.getElementById('inferenceBtn').disabled = !enabled;
}
function initFromBackend(env_state, initialGadgets, targetGadget) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        setLoading(true, 'Initializing from backend...');
        const state = env_state || {};
        const initials = initialGadgets || (state.gadgets || []);
        const target = targetGadget || (state.target_gadget || (state.gadgets && ((_a = state.gadgets[0]) === null || _a === void 0 ? void 0 : _a.type)) || 'Unknown');
        const initialList = document.getElementById('initial-gadgets');
        initialList.innerHTML = '';
        initials.forEach((g) => {
            const li = document.createElement('li');
            li.textContent = typeof g === 'string' ? g : (g.type || g.label || g.id || JSON.stringify(g));
            initialList.appendChild(li);
        });
        document.getElementById('target-gadget').textContent = target;
        traceLoaded = true;
        const w = cy.width(), h = cy.height();
        const spacing = 150;
        const offset = (initials.length - 1) / 2;
        cy.elements().remove();
        Object.keys(gadgets).forEach(k => delete gadgets[k]);
        gadgetIdCounter = 0;
        initials.forEach((g, i) => {
            const type = typeof g === 'string' ? g : g.type || g.label || g.id;
            const nodeId = `g${gadgetIdCounter++}`;
            const label = type;
            const ports = g.locations || (GADGET_PORTS[type] ? makePortList(GADGET_PORTS[type]) : []);
            const pos = { x: w / 2 + (i - offset) * spacing, y: h / 2 };
            const portOrigins = ports.map((p) => p);
            const portMap = {};
            ports.forEach((p) => { portMap[p] = `${nodeId}_port_${p}`; });
            gadgets[nodeId] = { label, ports: [...ports], pos, type, portOrigins, portMap };
            addGadgetNode(cy, nodeId, label, pos, type);
            ports.forEach((p, idx) => addPortNode(cy, nodeId, p, idx, ports.length, pos));
        });
        cy.resize();
        cy.fit(cy.elements(), 50);
        cy.center();
        setLoading(false);
    });
}
function _pct(x) {
    return Math.round((x || 0) * 100);
}
function _fmtDelta(pct) {
    const s = Math.round(pct * 10) / 10;
    return (s > 0 ? '+' : '') + s + '%';
}
function fetchMetrics() {
    return __awaiter(this, void 0, void 0, function* () {
        const url = `${API_BASE}/metrics`;
        console.log('Fetching from:', url); // ADD THIS
        const res = yield fetch(url, { cache: 'no-store', credentials: 'include' });
        if (!res.ok)
            throw new Error('metrics fetch failed');
        return res.json();
    });
}
function renderMetrics(m) {
    const b = (m === null || m === void 0 ? void 0 : m.baseline) || { n: 0, success_rate: 0 };
    const h = (m === null || m === void 0 ? void 0 : m.rlhf) || { n: 0, success_rate: 0 };
    const bp = _pct(b.success_rate);
    const hp = _pct(h.success_rate);
    const d = hp - bp;
    const basePctEl = document.getElementById('m-base-pct');
    const baseBarEl = document.getElementById('m-base-bar');
    const baseNEl = document.getElementById('m-base-n');
    const rlhfPctEl = document.getElementById('m-rlhf-pct');
    const rlhfBarEl = document.getElementById('m-rlhf-bar');
    const rlhfNEl = document.getElementById('m-rlhf-n');
    const deltaEl = document.getElementById('m-delta');
    const updEl = document.getElementById('m-updated');
    if (!basePctEl)
        return; // panel not on page
    basePctEl.textContent = `${bp}%`;
    if (baseBarEl)
        baseBarEl.value = bp;
    if (baseNEl)
        baseNEl.textContent = `n = ${b.n || 0}`;
    if (rlhfPctEl)
        rlhfPctEl.textContent = `${hp}%`;
    if (rlhfBarEl)
        rlhfBarEl.value = hp;
    if (rlhfNEl)
        rlhfNEl.textContent = `n = ${h.n || 0}`;
    if (deltaEl)
        deltaEl.textContent = _fmtDelta(d);
    if (updEl)
        updEl.textContent = `Last 200 episodes • refreshed ${new Date().toLocaleTimeString()}`;
}
function refreshMetrics() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('refreshMetrics called!'); // ADD THIS
        try {
            const m = yield fetchMetrics();
            console.log('Metrics received:', m); // ADD THIS
            renderMetrics(m);
        }
        catch (e) {
            console.error('Metrics error:', e);
            const updEl = document.getElementById('m-updated');
            if (updEl)
                updEl.textContent = 'Metrics unavailable';
        }
    });
}
function renderOp(op) {
    document.getElementById('output').textContent = JSON.stringify(op) + '\n';
    if (op.op === 'CONNECT') {
        const [, srcIdx, dstIdx] = op.args;
        const allPorts = Object.values(groupPortMaps).flat();
        const src = allPorts.find((port) => port.port === +srcIdx);
        const dst = allPorts.find((port) => port.port === +dstIdx);
        if (src && dst) {
            addPortEdge(cy, gadgets, src.gadget, src.port, dst.gadget, dst.port);
            cy.$(`#${src.gadget}_port_${src.port}`).addClass('connected');
            cy.$(`#${dst.gadget}_port_${dst.port}`).addClass('connected');
        }
    }
    else if (op.op === 'COMBINE') {
        const [g1_id, g2_id] = op.args;
        const rot = op.rot || 0;
        const splice = op.splice || 0;
        const g1 = gadgets[g1_id], g2 = gadgets[g2_id];
        if (!g1 || !g2)
            return;
        const mod = g2.ports.length;
        const g1_new = [
            ...g1.ports.slice(0, splice + 1),
            ...g1.ports.slice(splice + 1).map((l) => l + mod)
        ];
        const g1_orig = [
            ...g1.portOrigins.slice(0, splice + 1),
            ...g1.portOrigins.slice(splice + 1)
        ];
        const g2_new = g2.ports.map((l) => ((l + rot) % mod) + splice + 1);
        const g2_orig = g2.portOrigins.map((_, i, arr) => arr[(i + rot) % mod]);
        relabelGadgetPorts(cy, gadgets, g1_id, g1_new, g1_orig);
        relabelGadgetPorts(cy, gadgets, g2_id, g2_new, g2_orig);
        const groupId = `group_${g1_id}_${g2_id}`;
        combinedGroups.push([g1_id, g2_id]);
        addCompoundNode(cy, groupId, [g1_id, g2_id]);
        groupPortMaps[groupId] = [
            ...g1_new.map((p) => ({ gadget: g1_id, port: p })),
            ...g2_new.map((p) => ({ gadget: g2_id, port: p }))
        ];
        cy.$(`#${groupId}`).style({ 'background-opacity': 0, 'border-width': 3, 'border-color': '#888', 'border-style': 'dashed', label: '', 'z-index': 1 });
    }
    else if (op.op === 'STOP') {
        document.getElementById('inferenceBtn').disabled = true;
        document.getElementById('resetBtn').disabled = false;
        const inputNextStepBtn = document.getElementById('input-next-step-btn');
        if (inputNextStepBtn)
            inputNextStepBtn.disabled = true;
        const nextStepInput = document.getElementById('next-step-input');
        if (nextStepInput)
            nextStepInput.disabled = true;
        const submitNextStep = document.getElementById('submit-next-step');
        if (submitNextStep)
            submitNextStep.disabled = true;
        const userActionInput = document.getElementById('user-action-input');
        if (userActionInput)
            userActionInput.disabled = true;
        const userActionBtn = Array.from(document.getElementsByTagName('button')).find(btn => btn.textContent === 'Submit user action');
        if (userActionBtn)
            userActionBtn.setAttribute('disabled', 'true');
        addCheckSimulationButton();
    }
    cy.layout({ name: 'preset' }).run();
    cy.fit(cy.elements(), 50);
}
function nextStep() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!traceLoaded)
            return;
        setLoading(true, 'Stepping...');
        const res = yield fetch(`${API_BASE}/step`, { method: 'POST', credentials: 'include' });
        const { op, done } = yield res.json();
        setLoading(false);
        if (done) {
            setButtonsEnabled(false);
            document.getElementById('resetBtn').disabled = false;
            return;
        }
        renderOp(op);
    });
}
function addCheckSimulationButton() {
    var _a, _b;
    const existing = document.getElementById('check-simulation-btn');
    if (existing && existing.parentElement)
        existing.parentElement.remove();
    const btn = document.createElement('button');
    btn.id = 'check-simulation-btn';
    btn.className = 'button is-primary is-medium';
    btn.textContent = 'Check Simulation';
    btn.onclick = () => __awaiter(this, void 0, void 0, function* () {
        btn.disabled = true;
        const outputElem = document.getElementById('output');
        outputElem.textContent = 'Checking simulation...';
        outputElem.style.color = '';
        try {
            const res = yield fetch(`${API_BASE}/check_equivalence`, { method: 'POST', credentials: 'include' });
            const data = yield res.json();
            if (data.result === true) {
                outputElem.textContent = 'Simulation result: YES (gadgets are equivalent)';
                outputElem.style.color = 'green';
            }
            else if (data.result === false) {
                outputElem.textContent = 'Simulation result: NO (gadgets are not equivalent)';
                outputElem.style.color = 'red';
            }
            else if (data.error) {
                outputElem.textContent = 'Error: ' + data.error;
                outputElem.style.color = '';
            }
            else {
                outputElem.textContent = 'Unknown response.';
                outputElem.style.color = '';
            }
        }
        catch (e) {
            outputElem.textContent = 'Error checking simulation.';
            outputElem.style.color = '';
        }
        finally {
            btn.disabled = false;
        }
    });
    const controlDiv = document.createElement('div');
    controlDiv.className = 'control';
    controlDiv.appendChild(btn);
    const controlsGroup = document.querySelector('.controls-group');
    const inputNextStepControl = (_a = document.getElementById('input-next-step-btn')) === null || _a === void 0 ? void 0 : _a.parentElement;
    const inferenceControl = (_b = document.getElementById('inferenceBtn')) === null || _b === void 0 ? void 0 : _b.parentElement;
    if (controlsGroup && inputNextStepControl) {
        controlsGroup.insertBefore(controlDiv, inputNextStepControl.nextSibling);
    }
    else if (controlsGroup && inferenceControl) {
        controlsGroup.insertBefore(controlDiv, inferenceControl.nextSibling);
    }
    else if (controlsGroup) {
        controlsGroup.appendChild(controlDiv);
    }
}
function reset() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!traceLoaded)
            return;
        setLoading(true, 'Resetting...');
        yield fetch(`${API_BASE}/reset`, { method: 'POST', credentials: 'include' });
        cy.elements().remove();
        document.getElementById('output').textContent = '';
        cy.layout({ name: 'preset' }).run();
        cy.center();
        if (selectedStart && selectedTarget) {
            const resp = yield fetch(`${API_BASE}/init_gadgets`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    initial_gadgets: [selectedStart, selectedStart],
                    target_gadget: selectedTarget
                }),
                credentials: 'include',
            });
            const { env_state } = yield resp.json();
            yield initFromBackend(env_state, [selectedStart, selectedStart], selectedTarget);
        }
        else {
            yield initFromBackend();
        }
        document.getElementById('inferenceBtn').disabled = false;
        document.getElementById('resetBtn').disabled = false;
        const inputNextStepBtn = document.getElementById('input-next-step-btn');
        if (inputNextStepBtn)
            inputNextStepBtn.disabled = false;
        const nextStepInput = document.getElementById('next-step-input');
        if (nextStepInput)
            nextStepInput.disabled = false;
        const submitNextStep = document.getElementById('submit-next-step');
        if (submitNextStep)
            submitNextStep.disabled = false;
        setLoading(false);
        const checkBtn = document.getElementById('check-simulation-btn');
        if (checkBtn)
            checkBtn.remove();
    });
}
// === GADGET SELECTION ===
const GADGET_INFO = {
    AP2T: { name: 'AP2T', desc: 'Anti-Parallel 2-Toggle: Horizontal traversals in opposite directions.' },
    C2T: { name: 'C2T', desc: 'Crossing 2-Toggle: Diagonal traversals.' },
    P2T: { name: 'P2T', desc: 'Parallel 2-Toggle: Horizontal traversals in parallel directions.' },
    NWT: { name: 'NWT', desc: 'Noncrossing-Wire Toggle: Allows a traversal until wire is crossed; crossing again allows re-traversing.' }
};
const GADGET_SVGS = {
    AP2T: `<svg width="90" height="90" viewBox="0 0 90 90"><rect x="15" y="15" width="60" height="60" rx="10" fill="#fff" stroke="#1976d2" stroke-width="3"/><line x1="15" y1="25" x2="75" y2="25" stroke="#1976d2" stroke-width="7" marker-end="url(#arrow)"/><line x1="75" y1="65" x2="15" y2="65" stroke="#1976d2" stroke-width="7" marker-end="url(#arrow)"/><defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0,0 6,3 0,6" fill="#1976d2"/></marker></defs></svg>`,
    C2T: `<svg width="90" height="90" viewBox="0 0 90 90"><rect x="15" y="15" width="60" height="60" rx="10" fill="#fff" stroke="#388e3c" stroke-width="3"/><line x1="15" y1="15" x2="75" y2="75" stroke="#388e3c" stroke-width="7" marker-end="url(#arrow)"/><line x1="75" y1="15" x2="15" y2="75" stroke="#fbc02d" stroke-width="7" marker-end="url(#arrow2)"/><defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0,0 6,3 0,6" fill="#388e3c"/></marker><marker id="arrow2" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0,0 6,3 0,6" fill="#fbc02d"/></marker></defs></svg>`,
    P2T: `<svg width="90" height="90" viewBox="0 0 90 90"><rect x="15" y="15" width="60" height="60" rx="10" fill="#fff" stroke="#7b1fa2" stroke-width="3"/><line x1="15" y1="25" x2="75" y2="25" stroke="#7b1fa2" stroke-width="7" marker-end="url(#arrow)"/><line x1="15" y1="65" x2="75" y2="65" stroke="#7b1fa2" stroke-width="7" marker-end="url(#arrow)"/><defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0,0 6,3 0,6" fill="#7b1fa2"/></marker></defs></svg>`,
    NWT: `<svg width="90" height="90" viewBox="0 0 90 90"><rect x="15" y="15" width="60" height="60" rx="10" fill="#fff" stroke="#616161" stroke-width="3"/><line x1="15" y1="45" x2="75" y2="45" stroke="#616161" stroke-width="7"/><line x1="45" y1="7" x2="45" y2="23" stroke="#111" stroke-width="7"/></svg>`
};
function renderGadgetCards(containerId, selectType) {
    const container = document.getElementById(containerId);
    if (!container)
        return;
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
let selectedStart = null;
let selectedTarget = null;
function handleGadgetSelect(gadget, type, card) {
    if (type === 'start') {
        selectedStart = gadget;
        const allCards = document.querySelectorAll('#start-gadget-cards .card');
        allCards.forEach(c => c.classList.remove('has-background-info-light'));
        card.classList.add('has-background-info-light');
    }
    else {
        selectedTarget = gadget;
        const allCards = document.querySelectorAll('#target-gadget-cards .card');
        allCards.forEach(c => c.classList.remove('has-background-success-light'));
        card.classList.add('has-background-success-light');
    }
    updateStartButtonState();
}
function updateStartButtonState() {
    const btn = document.getElementById('startSessionBtn');
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
    document.getElementById('close-next-step-modal').onclick = () => {
        modal.style.display = 'none';
    };
    document.getElementById('submit-next-step').onclick = () => __awaiter(this, void 0, void 0, function* () {
        const input = document.getElementById('next-step-input').value.trim();
        if (!input) {
            alert('Please enter an action.');
            return;
        }
        const res = yield fetch(`${API_BASE}/apply_action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: input, actor: 'user' }),
            credentials: 'include',
        });
        const result = yield res.json();
        if (!result.success) {
            alert('Failed: ' + (result.error || 'Unknown error'));
        }
        else {
            renderOp(result.op);
            modal.style.display = 'none';
            document.getElementById('next-step-input').value = '';
        }
    });
}
function addInputNextStepButton() {
    var _a;
    const btn = document.createElement('button');
    btn.id = 'input-next-step-btn';
    btn.className = 'button is-info is-medium';
    btn.textContent = 'Input Next Step';
    btn.onclick = () => {
        const modal = document.getElementById('input-next-step-modal');
        modal.style.display = 'block';
        document.getElementById('next-step-input').focus();
    };
    const controlDiv = document.createElement('div');
    controlDiv.className = 'control';
    controlDiv.appendChild(btn);
    const controlsGroup = document.querySelector('.controls-group');
    const inferenceControl = (_a = document.getElementById('inferenceBtn')) === null || _a === void 0 ? void 0 : _a.parentElement;
    if (controlsGroup && inferenceControl) {
        controlsGroup.insertBefore(controlDiv, inferenceControl.nextSibling);
    }
    else if (controlsGroup) {
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
            const mode = btn.getAttribute('data-mode');
            setMode(mode);
        });
    });
    // Set default mode
    setMode('select');
    // Cytoscape drag-drop events
    cy.on('grab', 'node[gadget]', function (evt) {
        if (currentMode === 'combine') {
            draggedNode = evt.target;
            dragStartPos = { x: draggedNode.position('x'), y: draggedNode.position('y') };
            draggedNode.addClass('dragging');
        }
    });
    cy.on('drag', 'node[gadget]', function (evt) {
        if (currentMode === 'combine' && draggedNode) {
            cy.nodes('[gadget]').forEach((node) => {
                if (node.id() !== draggedNode.id()) {
                    const dist = Math.sqrt(Math.pow(draggedNode.position('x') - node.position('x'), 2) +
                        Math.pow(draggedNode.position('y') - node.position('y'), 2));
                    if (dist < 80) {
                        node.addClass('drop-target');
                    }
                    else {
                        node.removeClass('drop-target');
                    }
                }
            });
        }
    });
    cy.on('free', 'node[gadget]', function (evt) {
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
    cy.on('tap', 'node[port]', function (evt) {
        if (currentMode === 'connect') {
            evt.stopPropagation();
            const port = evt.target;
            if (!connectingPort) {
                connectingPort = port;
                port.addClass('connecting');
            }
            else if (port.id() !== connectingPort.id()) {
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
        if (e.target.tagName === 'INPUT')
            return;
        switch (e.key.toLowerCase()) {
            case 'c':
                if (!e.metaKey && !e.ctrlKey)
                    setMode('combine');
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
function setMode(mode) {
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
function showCombineDialog(g1, g2) {
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
        const rotSlider = document.getElementById('rot-slider');
        const spliceSlider = document.getElementById('splice-slider');
        rotSlider.oninput = () => {
            document.getElementById('rot-value').textContent = rotSlider.value;
        };
        spliceSlider.oninput = () => {
            document.getElementById('splice-value').textContent = spliceSlider.value;
        };
        document.getElementById('apply-combine-btn').onclick = () => __awaiter(this, void 0, void 0, function* () {
            const res = yield fetch(`${API_BASE}/apply_action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: `COMBINE(${g1}, ${g2}, rot=${rotSlider.value}, splice=${spliceSlider.value})`,
                    actor: 'user'
                }),
                credentials: 'include'
            });
            const result = yield res.json();
            if (result.success) {
                renderOp(result.op);
            }
            dialog.classList.remove('is-active');
        });
        document.getElementById('cancel-combine-btn').onclick = () => {
            dialog.classList.remove('is-active');
        };
    }
    else {
        dialog.classList.add('is-active');
    }
}
// === MODEL INFERENCE ===
function inferModelStep() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const modelName = modelSelect === null || modelSelect === void 0 ? void 0 : modelSelect.value;
            const response = yield fetch(`${API_BASE}/infer_next_step`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: modelName }),
                credentials: 'include',
            });
            const data = yield response.json();
            const suggestionDiv = document.getElementById('model-suggestion');
            const suggestionBox = document.getElementById('model-suggestion-box');
            const topActionsList = document.getElementById('top-actions');
            suggestionDiv.textContent = '';
            topActionsList.innerHTML = '';
            if (data.description) {
                suggestionDiv.innerHTML = `Model suggests: ${data.description}<span title="${data.tooltip || ''}" style="cursor: help;"> - confused?</span>`;
            }
            if (Array.isArray(data.top_actions)) {
                data.top_actions.forEach(({ action_desc, confidence }) => {
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
            denyBtn.onclick = () => __awaiter(this, void 0, void 0, function* () {
                try {
                    suggestionDiv.textContent = 'Agent action denied.';
                    yield fetch(`${API_BASE}/rlhf_response`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ action: suggestion, response: false }),
                    });
                }
                catch (e) {
                    console.error('rlhf_response (deny) failed', e);
                }
                finally {
                    acceptBtn.remove();
                    denyBtn.remove();
                    document.getElementById('resetBtn').disabled = false;
                    document.getElementById('inferenceBtn').disabled = false;
                }
            });
            acceptBtn.onclick = () => __awaiter(this, void 0, void 0, function* () {
                try {
                    acceptBtn.disabled = true;
                    denyBtn.disabled = true;
                    const res = yield fetch(`${API_BASE}/apply_action`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ action: suggestion, actor: 'agent' }),
                    });
                    const result = yield res.json();
                    if (!result.success) {
                        alert('Failed: ' + result.error);
                        return;
                    }
                    renderOp(result.op);
                    yield fetch(`${API_BASE}/rlhf_response`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ action: suggestion, response: true }),
                    });
                }
                catch (e) {
                    console.error('accept flow failed', e);
                }
                finally {
                    suggestionDiv.textContent = '';
                    acceptBtn.remove();
                    denyBtn.remove();
                    document.getElementById('resetBtn').disabled = false;
                    document.getElementById('inferenceBtn').disabled = false;
                }
            });
            suggestionBox === null || suggestionBox === void 0 ? void 0 : suggestionBox.appendChild(denyBtn);
            suggestionBox === null || suggestionBox === void 0 ? void 0 : suggestionBox.appendChild(acceptBtn);
        }
        catch (err) {
            console.error('Error fetching model suggestion:', err);
        }
    });
}
// === MAIN INITIALIZATION ===
document.addEventListener('DOMContentLoaded', () => {
    const simSection = document.querySelectorAll('.section');
    if (simSection.length > 1)
        simSection[1].style.display = 'none';
    const backBtn = document.getElementById('back-to-gadget-select');
    if (backBtn) {
        backBtn.style.display = 'none';
        backBtn.onclick = () => {
            if (simSection.length > 1)
                simSection[1].style.display = 'none';
            const landingSection = document.getElementById('landing-section');
            if (landingSection)
                landingSection.style.display = '';
            traceLoaded = false;
            cy.elements().remove();
            document.getElementById('output').textContent = '';
            document.getElementById('inferenceBtn').disabled = true;
            document.getElementById('resetBtn').disabled = true;
            const inputNextStepBtn = document.getElementById('input-next-step-btn');
            if (inputNextStepBtn)
                inputNextStepBtn.disabled = true;
            const nextStepInput = document.getElementById('next-step-input');
            if (nextStepInput)
                nextStepInput.disabled = true;
            const submitNextStep = document.getElementById('submit-next-step');
            if (submitNextStep)
                submitNextStep.disabled = true;
            if (backBtn)
                backBtn.style.display = 'none';
        };
    }
    setButtonsEnabled(false);
    const resetBtn = document.getElementById('resetBtn');
    const inferenceBtn = document.getElementById('inferenceBtn');
    resetBtn.addEventListener('click', reset);
    inferenceBtn.addEventListener('click', inferModelStep);
    renderGadgetCards('start-gadget-cards', 'start');
    renderGadgetCards('target-gadget-cards', 'target');
    const startBtn = document.getElementById('startSessionBtn');
    if (startBtn) {
        startBtn.addEventListener('click', () => __awaiter(void 0, void 0, void 0, function* () {
            if (!selectedStart || !selectedTarget)
                return;
            setLoading(true, 'Initializing environment...');
            const resp = yield fetch(`${API_BASE}/init_gadgets`, {
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
            yield fetch(`${API_BASE}/reset`, { method: 'POST', credentials: 'include' });
            const { env_state } = yield resp.json();
            document.getElementById('landing-section').style.display = 'none';
            const simSection = document.querySelectorAll('.section');
            if (simSection.length > 1)
                simSection[1].style.display = '';
            console.log('Testing direct metrics fetch...');
            fetch(`${API_BASE}/metrics`, { credentials: 'include' })
                .then(r => r.json())
                .then(data => console.log('Direct metrics data:', data))
                .catch(err => console.error('Direct metrics error:', err));
            refreshMetrics();
            setInterval(refreshMetrics, 5000);
            if (backBtn)
                backBtn.style.display = '';
            traceLoaded = true;
            setButtonsEnabled(true);
            yield initFromBackend(env_state, [selectedStart, selectedStart], selectedTarget);
            setLoading(false);
            setupEnhancedInteractions();
        }));
    }
    createInputNextStepModal();
    addInputNextStepButton();
});
window.nextStep = nextStep;
window.reset = reset;
