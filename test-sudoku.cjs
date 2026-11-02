const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const engine = require('./sudoku-engine.js');
const source = fs.readFileSync('script.js','utf8');
for (const level of Object.keys(engine.levels)) {
    const generated = engine.generate(level);
    assert(engine.valid(generated.solution,generated.config,true));
    assert.equal(engine.countSolutions(generated.puzzle,generated.config),1);
    const state = { ...generated, gridConfig:generated.config, values:generated.puzzle.slice(), playing:true, completed:false, paused:false, settings:{mistakeLimit:true}, mistakes:0, history:[], mistakeCount:{}, undoButton:{}, pauseButton:{}, status:{}, timerInterval:1, window:{clearInterval(){}}, renderBoard(){}, showGameOver(){state.gameOver=true}, translate:key=>key, playSound(){}, saveProgress(){}, updateSelection(){}, finishGame(){state.completed=true}, HTMLInputElement:class {} };
    state.board={children:state.values.map(()=>({classList:{toggle(){}},setAttribute(){},removeAttribute(){}}))};
    vm.createContext(state);
    vm.runInContext(source.slice(source.indexOf('function setCellValue('),source.indexOf('function finishGame(')),state);
    const index=state.puzzle.findIndex(v=>!v), snapshot=JSON.stringify(state.values);
    state.setCellValue(index,state.solution[index]);
    assert.equal(state.values[index],state.solution[index]); assert.equal(state.mistakes,0); assert.equal(JSON.stringify(state.history[0]),snapshot);
    state.setCellValue(index,0); assert.equal(state.values[index],0);
    state.setCellValue(index,state.gridConfig.size+1); assert.equal(state.values[index],0);
    state.setCellValue(index,state.solution[index]%state.gridConfig.size+1); assert.equal(state.mistakes,1);
    state.values=state.history.pop(); state.validateBoard(); assert.equal(state.values[index],0);
    state.values=state.solution.slice(); state.validateBoard(); assert(state.completed);
    state.completed=false; state.values=state.puzzle.slice(); state.mistakes=2;
    state.setCellValue(index,state.solution[index]%state.gridConfig.size+1); assert(state.gameOver); assert(state.completed);
    console.log(level+': unique generation, input bounds, correct move, erase, undo, mistake limit and win passed');
}
const legacy={size:9,boxRows:3,boxCols:3};
assert(engine.valid(Array.from({length:81},(_,i)=>(Math.floor(i/9)*3+Math.floor(Math.floor(i/9)/3)+i%9)%9+1),legacy,true));
console.log('Legacy 9x9 configuration remains supported.');
