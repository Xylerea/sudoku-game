const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('script.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const colors = fs.readFileSync('style.css', 'utf8');
const names = JSON.parse(source.match(/const settingNames = (\[[\s\S]*?\]);/)[1]);
const language = {window:{}};vm.createContext(language);vm.runInContext(fs.readFileSync('languages.js','utf8'),language);
let storage = {'sudoku-progress-v1':'unchanged-game-state'};
const controls = Object.fromEntries(names.map(name=>[name,{dataset:{setting:name},events:{},addEventListener(event,handler){this.events[event]=handler;}}]));
const classes = new Set(), meta = {}, status = {}, mistakes = {};
let boardRenders=0,timerStarts=0;
const runtime = {
    languageNames:language.window.SUDOKU_LANGUAGES,settingsKey:'sudoku-game-settings',settingNames:names,settingsReadFailed:false,
    localStorage:{getItem:key=>storage[key]??null,setItem:(key,value)=>storage[key]=value},
    matchMedia:()=>({matches:true}),translate:key=>key,
    document:{documentElement:{dataset:{}},body:{classList:{toggle(name,active){if(active)classes.add(name);else classes.delete(name);}}},querySelector(selector){if(selector.startsWith('[data-setting='))return controls[selector.match(/"([^"]+)"/)[1]];if(selector.startsWith('meta['))return meta;if(selector==='.mistakes-display')return mistakes;throw Error(selector);},querySelectorAll:()=>Object.values(controls)},
    timer:{parentElement:{}},mistakeCount:{},settingsSaveStatus:status,
    playing:true,completed:false,paused:false,mistakes:1,mistakeLimitEnded:false,renderBoard:()=>boardRenders++,startTimer:()=>timerStarts++
};
vm.createContext(runtime);
vm.runInContext(source.slice(source.indexOf('function loadSettings()'),source.indexOf('function translate(')),runtime);
assert.equal(runtime.loadSettings().darkMode,false,'Dark Mode defaults off even with OS Reduce Motion enabled');
for(const code of Object.keys(language.window.SUDOKU_LANGUAGES)) {
    const previous={language:code,darkMode:true,highContrast:true,largerText:true,largerButtons:true,soundEffects:true,reducedMotion:true,showTimer:false,mistakeLimit:false};
    storage['sudoku-game-settings']=JSON.stringify(previous);
    assert.equal(JSON.stringify(runtime.loadSettings()),JSON.stringify(previous));
    const dictionary=language.window.SUDOKU_TRANSLATIONS[code];assert(dictionary.darkMode?.length);assert(dictionary.darkModeDescription?.length);
}
storage['sudoku-game-settings']=JSON.stringify({darkMode:'true'});assert.equal(runtime.loadSettings().darkMode,false);
storage['sudoku-game-settings']=JSON.stringify({language:'fr',highContrast:true,largerButtons:true});runtime.settings=runtime.loadSettings();
vm.runInContext(source.slice(source.indexOf('function applySettings()'),source.indexOf('function playSound(')),runtime);
const eventsStart=source.indexOf('document.querySelectorAll("[data-setting]").forEach(control => {',source.indexOf('function synchronizeLanguageSelection'));
vm.runInContext(source.slice(eventsStart,source.indexOf('function startGame()',eventsStart)),runtime);
controls.darkMode.checked=true;controls.darkMode.events.change();
assert.equal(runtime.document.documentElement.dataset.theme,'dark');assert(classes.has('dark-mode'));assert(classes.has('high-contrast'));assert(classes.has('larger-buttons'));assert.equal(meta.content,'#1C181C');assert(JSON.parse(storage['sudoku-game-settings']).darkMode);
assert.equal(runtime.loadSettings().darkMode,true,'Restores Dark Mode after reload');
controls.darkMode.checked=false;controls.darkMode.events.change();assert.equal(runtime.document.documentElement.dataset.theme,'light');assert(!classes.has('dark-mode'));assert(classes.has('high-contrast'));assert.equal(runtime.loadSettings().darkMode,false);
assert.equal(storage['sudoku-progress-v1'],'unchanged-game-state');assert.equal(boardRenders,0);assert.equal(timerStarts,0);
assert(html.indexOf('id="pref-dark-mode"')<html.indexOf('id="pref-high-contrast"'));assert(html.includes('id="pref-dark-mode" type="checkbox" role="switch"'));
const bootstrap=html.match(/<script>([\s\S]*?)<\/script>/)[1];
for(const darkMode of [true,false]){storage['sudoku-game-settings']=JSON.stringify({darkMode});runtime.document.documentElement.dataset={};vm.runInContext(bootstrap,runtime);assert.equal(runtime.document.documentElement.dataset.theme,darkMode?'dark':'light');}
const darkStyles=colors.slice(colors.indexOf('/* Dark Mode changes colors only;'),colors.indexOf('/* Close only the gap left'));
assert(!/(?:^|[;{\s])(?:width|height|padding|margin|display|position)\s*:/m.test(darkStyles),'Theme does not change geometry');
console.log('PASS: one switch above High Contrast; default OFF; all 20 translated labels; ON/OFF persistence and prepaint restoration; accessibility preferences retained; game storage and timer untouched.');
