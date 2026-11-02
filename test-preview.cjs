const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const engine = require('./sudoku-engine.js');
const source = fs.readFileSync('script.js', 'utf8');
const data = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('const puzzles ='), source.indexOf('const board =')) + ';globalThis.previewData={puzzle:puzzles.easy,answer:landingPreviewSolution};', data);
class Element {
    constructor() {
        this.children = []; this.dataset = {}; this.textContent = ''; this.classes = new Set();
        this.classList = {add: name => this.classes.add(name), remove: name => this.classes.delete(name)};
    }
    set className(value) { this.classes = new Set(value.split(' ')); }
    replaceChildren() { this.children = []; }
    append(child) { this.children.push(child); }
}
const board = new Element(), illustration = new Element(), classes = new Set();
const timers = new Map(), events = new Map(); let nextTimer = 0, intersect, mutate, mediaChange;
const motion = {matches:false, addEventListener(name, callback) { mediaChange = callback; }};
const runtime = {
    landingPreview: board, landingPreviewSolution: Object.freeze([...data.previewData.answer]),
    puzzles: {easy: [...data.previewData.puzzle]}, solution: [...data.previewData.answer], settings: {reducedMotion:false},
    matchMedia: () => motion,
    IntersectionObserver: class {constructor(callback) {intersect = callback;} observe(target) {assert.equal(target, illustration);}},
    MutationObserver: class {constructor(callback) {mutate = callback;} observe() {}},
    document: {hidden:false, body:{matches:()=>classes.has('is-playing')||classes.has('is-choosing')}, createElement:()=>new Element(), querySelector:()=>illustration, addEventListener:(name,callback)=>events.set(name,callback)},
    window: {setTimeout(callback,delay) {timers.set(++nextTimer,{callback,delay});return nextTimer;},clearTimeout:id=>timers.delete(id),addEventListener:(name,callback)=>events.set(name,callback)}
};
vm.createContext(runtime);
vm.runInContext(source.slice(source.indexOf('function renderLandingPreview()'), source.indexOf('function updateSelection()')), runtime);
runtime.renderLandingPreview(); runtime.initializeLandingPreviewAnimation();
const baseline = board.children.map(cell=>cell.textContent).join(',');
const tick = delay => {assert.equal(timers.size,1);const [id,task]=[...timers][0];assert.equal(task.delay,delay);timers.delete(id);task.callback();};
const active = () => board.children.filter(cell=>cell.classes.has('preview-entry'));
const stopped = () => {assert.equal(timers.size,0);assert.equal(active().length,0);assert(!illustration.classes.has('preview-animating'));assert.equal(board.children.map(cell=>cell.textContent).join(','),baseline);};
assert.equal(timers.size,0,'No animation work before the illustration becomes visible');
intersect([{isIntersecting:true}]);assert(illustration.classes.has('preview-animating'));
for(let cycle=0;cycle<3;cycle++) {
    tick(6000);assert.equal(active().length,1);
    const cell=active()[0],index=board.children.indexOf(cell);
    assert.equal(Number(cell.textContent),data.previewData.answer[index]);assert.equal(data.previewData.puzzle[index],0);
    assert(engine.valid(board.children.map(c=>Number(c.textContent)||0),{size:9,boxRows:3,boxCols:3}));
    // Gameplay may replace its solution with a different board and grid size.
    runtime.solution.splice(0,runtime.solution.length,...Array(36).fill(1));
    tick(4000);assert.equal(active().length,0);
}
const pending=[...timers.keys()][0];mutate();assert.equal([...timers.keys()][0],pending,'Unrelated body updates must not restart timers');
tick(6000);runtime.document.hidden=true;events.get('visibilitychange')();stopped();
runtime.document.hidden=false;events.get('visibilitychange')();assert.equal(timers.size,1);
runtime.settings.reducedMotion=true;mutate();stopped();
runtime.settings.reducedMotion=false;mutate();motion.matches=true;mediaChange();stopped();
motion.matches=false;mediaChange();intersect([{isIntersecting:false}]);stopped();
intersect([{isIntersecting:true}]);
for(const screen of ['is-playing','is-choosing']) {classes.add(screen);mutate();stopped();classes.delete(screen);mutate();assert.equal(timers.size,1);}
events.get('pagehide')();stopped();events.get('pageshow')();assert.equal(timers.size,1);
runtime.settings.reducedMotion=true;mutate();stopped();
assert.equal(JSON.stringify(runtime.puzzles.easy),JSON.stringify(data.previewData.puzzle));
console.log('PASS: valid decorative numbers stay independent of gameplay; one delayed timer; hidden/offscreen/other screens pause; app and system Reduce Motion stop all work; no changes to original clues.');
