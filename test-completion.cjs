const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('script.js', 'utf8');
const modalCode = source.slice(source.indexOf('function showCompletion()'), source.indexOf('// A short rising chord;'));
const audioCode = source.slice(source.indexOf('function playVictorySound()'), source.indexOf('function sizedRule('));
const animationCode = source.slice(source.indexOf('function startWinConfetti('), source.indexOf('function formatTime('));
const languageContext = {window:{}}; vm.createContext(languageContext);
vm.runInContext(fs.readFileSync('languages.js','utf8'), languageContext);
class Element {
    constructor(tag) { this.tag=tag; this.children=[];this.events={};this.attributes={};this.dataset={};this.nodes={};this.open=false; }
    setAttribute(name,value){this.attributes[name]=value;}
    set innerHTML(value){this.markup=value;for(const key of ['#completion-title','#completion-message','.completion-difficulty','.completion-stats','.completion-play-again'])this.nodes[key]=new Element(key);}
    querySelector(key){return this.nodes[key];}
    append(...nodes){this.children.push(...nodes);}
    addEventListener(name,fn){this.events[name]=fn;}
    showModal(){this.open=true;}
    close(){this.open=false;this.events.close?.();}
    remove(){this.removed=true;}
    focus(){this.focused=true;}
}
for(const [lang,dict] of Object.entries(languageContext.window.SUDOKU_TRANSLATIONS))for(const level of ['easy','medium','hard']){
    let dialog,again=0,cleaned=0,saved=0;
    const c={selectedDifficulty:level,elapsedSeconds:584,mistakes:2,hintsUsed:3,translate:key=>dict[key],formatTime:()=> '09:44',showDifficulty:()=>again++,stopWinConfetti:()=>cleaned++,saveProgress:()=>saved++,document:{querySelector:()=>dialog&&!dialog.removed?dialog:null,createElement:tag=>new Element(tag),body:{append(node){dialog=node;}}}};
    vm.createContext(c); vm.runInContext(modalCode,c);
    const result=c.showCompletion(),card=result.children[0];
    assert.equal(result.id,'completion-dialog');assert.equal(result.className,'completion-dialog');
    assert(!card.markup.includes('✓')); assert(card.markup.includes('completion-trophy'));
    assert.equal(card.querySelector('#completion-title').textContent,dict.completionTitle);
    assert.equal(card.querySelector('#completion-message').textContent,dict.completionText);
    assert.equal(card.querySelector('.completion-difficulty').textContent,dict[level]);
    const rows=card.querySelector('.completion-stats').children;
    assert.equal(rows.length,3); assert.deepEqual(rows.map(row=>row.children[1].textContent),['09:44','2','3']);
    assert.equal(rows[0].children[0].textContent,dict.completionTime);
    const button=card.querySelector('.completion-play-again');assert.equal(button.textContent,dict.playAgain);assert.equal(button.children.length,0);
    assert.equal(c.showCompletion(),result);assert.equal(saved,1);
    button.events.click();assert.equal(again,1);assert.equal(cleaned,1);assert(result.removed);
}
console.log('PASS: actual completion markup, trophy, real difficulty/statistics, text-only Play Again, single modal, cleanup, and all 20 translations.');
function animationHarness(width=390,reduced=false,systemReduced=false){
    let id=0,removed=0;const frames=new Map(),timers=new Map(),events=new Map(),points=[];
    const context={setTransform(){},clearRect(){},save(){},translate(x,y){points.push([x,y])},rotate(){},fillRect(){},restore(){}};
    const preference={matches:systemReduced,addEventListener(n,f){events.set('motion',f)},removeEventListener(){events.delete('motion')}};
    const host=new Element('dialog');
    const c={settings:{reducedMotion:reduced},stopWinConfetti:null,matchMedia:()=>preference,document:{createElement:()=>({setAttribute(){},getContext:()=>context,remove(){removed++}})},window:{innerWidth:width,innerHeight:844,devicePixelRatio:3,setTimeout(f){timers.set(++id,f);return id},clearTimeout:n=>timers.delete(n),addEventListener(n,f){events.set(n,f)},removeEventListener:n=>events.delete(n)},requestAnimationFrame(f){frames.set(++id,f);return id},cancelAnimationFrame:n=>frames.delete(n)};
    vm.createContext(c);vm.runInContext(animationCode,c);
    return {c,host,frames,timers,events,preference,points,removed:()=>removed,tick(time){const current=[...frames.values()];frames.clear();current.forEach(fn=>fn(time));}};
}
for(const width of [320,390,1366]){
    const h=animationHarness(width);h.c.startWinConfetti(h.host);assert.equal(h.host.children.length,1);
    h.tick(0);h.tick(1000);const first=h.points.at(-1);h.tick(1500);assert.notDeepEqual(h.points.at(-1),first);
    h.tick(3600);assert.equal(h.removed(),1);assert.equal(h.frames.size,0);assert.equal(h.events.size,0);assert.equal(h.timers.size,0);
}
for(const pair of [[true,false],[false,true]]){const h=animationHarness(390,...pair);h.c.startWinConfetti(h.host);assert.equal(h.host.children.length,0);}
const motion=animationHarness();motion.c.startWinConfetti(motion.host);motion.events.get('motion')({matches:true});assert.equal(motion.removed(),1);
console.log('PASS: visibly changing particle positions, modal-layer canvas, mobile/desktop sizing, 3.6s cleanup and Reduce Motion.');
(async()=>{
    let created=0,notes=0,closed=0;
    class Audio {
        constructor(){created++;this.state='running';this.currentTime=0;this.destination={};}
        createOscillator(){return{frequency:{},connect(){},start(){notes++},stop(){},addEventListener(){}};}
        createGain(){return{gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}};}
        close(){closed++;return Promise.resolve();}
    }
    const c={settings:{soundEffects:false},window:{AudioContext:Audio}};vm.createContext(c);vm.runInContext(audioCode,c);
    c.playVictorySound();assert.equal(created,0);c.settings.soundEffects=true;c.playVictorySound();assert.equal(notes,3);
    c.window.AudioContext=class extends Audio{constructor(){super();this.state='suspended';}resume(){return Promise.reject(Error('blocked'));}};
    c.playVictorySound();await new Promise(resolve=>setImmediate(resolve));assert.equal(closed,1);
    c.window.AudioContext=class{constructor(){throw Error('unavailable');}};assert.doesNotThrow(()=>c.playVictorySound());
    console.log('PASS: muted sound creates no audio; enabled sound plays three notes; blocked or unavailable audio is handled without errors.');
})().catch(error=>{console.error(error);process.exitCode=1;});
