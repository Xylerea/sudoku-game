(function (root) {
    const levels = { easy: {size:4,boxRows:2,boxCols:2,clues:8}, medium:{size:6,boxRows:2,boxCols:3,clues:20}, hard:{size:9,boxRows:3,boxCols:3,clues:28} };
    function shuffle(a) { for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
    function candidates(grid,index,cfg) {
        const {size:n,boxRows:h,boxCols:w}=cfg,r=Math.floor(index/n),c=index%n,used=new Set();
        for(let i=0;i<n;i++){used.add(grid[r*n+i]);used.add(grid[i*n+c]);}
        for(let y=Math.floor(r/h)*h;y<Math.floor(r/h)*h+h;y++)for(let x=Math.floor(c/w)*w;x<Math.floor(c/w)*w+w;x++)used.add(grid[y*n+x]);
        return Array.from({length:n},(_,i)=>i+1).filter(v=>!used.has(v));
    }
    function valid(grid,cfg,complete=false) {
        const n=cfg.size;if(!Array.isArray(grid)||grid.length!==n*n||grid.some(v=>!Number.isInteger(v)||v<(complete?1:0)||v>n))return false;
        return grid.every((v,i)=>{if(!v)return true;const copy=grid.slice();copy[i]=0;return candidates(copy,i,cfg).includes(v);});
    }
    function countSolutions(input,cfg,limit=2) {
        if(!valid(input,cfg))return 0;
        const grid=input.slice();let count=0;
        function search(){let index=-1,options;
            for(let i=0;i<grid.length;i++)if(!grid[i]){const c=candidates(grid,i,cfg);if(!c.length)return;if(!options||c.length<options.length){index=i;options=c;if(c.length===1)break;}}
            if(index<0){count++;return;}
            for(const v of options){grid[index]=v;search();if(count>=limit)break;}grid[index]=0;
        }search();return count;
    }
    function generate(level){const cfg=levels[level];if(!cfg)throw Error('Unknown difficulty');const {size:n,boxRows:h,boxCols:w}=cfg;
        const groups=(count,width)=>shuffle(Array.from({length:count},(_,i)=>i)).flatMap(g=>shuffle(Array.from({length:width},(_,i)=>g*width+i)));
        const rows=groups(n/h,h),cols=groups(n/w,w),digits=shuffle(Array.from({length:n},(_,i)=>i+1));
        const answer=rows.flatMap(r=>cols.map(c=>digits[(r*w+Math.floor(r/h)+c)%n]));const puzzle=answer.slice();
        for(const index of shuffle(Array.from({length:n*n},(_,i)=>i))){if(puzzle.filter(Boolean).length<=cfg.clues)break;const v=puzzle[index];puzzle[index]=0;if(countSolutions(puzzle,cfg)!==1)puzzle[index]=v;}
        return {config:{...cfg},puzzle,solution:answer};
    }
    const api={levels,generate,countSolutions,valid};
    if(typeof module!=='undefined')module.exports=api;else root.SudokuEngine=api;
})(globalThis);
