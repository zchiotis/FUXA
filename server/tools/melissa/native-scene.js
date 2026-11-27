'use strict';
// Small SVG tree reader for our generated artwork (no external XML/DOM dependency).
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function parse(svg){
    const document={tag:null,children:[]},stack=[document];
    for(const token of svg.match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g)||[]){
        if(token.startsWith('<!--')||token.startsWith('<?'))continue;
        if(token.startsWith('</')){const name=token.slice(2,-1).trim();if(stack.pop().tag!==name)throw new Error('Unbalanced SVG: '+name);}
        else if(token.startsWith('<')){
            const tag=token.match(/^<([\w:-]+)/)?.[1];if(!tag)throw new Error('Unsupported SVG token');
            const node={tag,attrs:{},children:[]};
            for(const m of token.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))node.attrs[m[1]]=m[2]??m[3];
            stack[stack.length-1].children.push(node);if(!token.endsWith('/>'))stack.push(node);
        }else stack[stack.length-1].children.push(token);
    }
    if(stack.length!==1)throw new Error('Incomplete SVG');return document.children.find(n=>n.tag==='svg');
}
// Parsed attributes retain XML entities, unlike newly authored attribute values.
function xml(n){if(typeof n==='string')return n;return '<'+n.tag+Object.entries(n.attrs).map(([k,v])=>' '+k+'="'+v+'"').join('')+'>'+n.children.map(xml).join('')+'</'+n.tag+'>';}
function visit(n,fn,ancestors=[]){if(typeof n==='string')return;fn(n,ancestors);for(const c of [...n.children])visit(c,fn,ancestors.concat(n));}
function remove(parent,node){parent.children=parent.children.filter(n=>n!==node);}
function clone(node){return JSON.parse(JSON.stringify(node));}
// Resolve our drawing's static CSS before flattening it. Native FUXA writes SVG
// attributes; leaving CSS fill rules in place would override the user's bindings.
function bakeStyles(root){
    const css=[];visit(root,n=>{if(n.tag==='style')css.push(n.children.join(''));});
    const rules=[];
    for(const match of css.join('\n').replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/([^{}]+)\{([^}]+)\}/g)){
        for(const selector of match[1].split(',').map(s=>s.trim())){
            if(selector.replace(/:first-child|:not\([^)]*\)/g,'').includes(':'))continue;
            const score=(selector.match(/#/g)||[]).length*100+(selector.match(/[.\[]/g)||[]).length*10;
            rules.push({selector,score,styles:declarations(match[2])});
        }
    }
    function declarations(text){return text.split(';').map(p=>{const i=p.indexOf(':');return [p.slice(0,i).trim(),p.slice(i+1).trim()];}).filter(([k,v])=>k&&v);}
    function atom(node,s){
        if(s.includes(':first-child')&&!node.first)return false;
        s=s.replace(/:first-child/g,'');
        const excluded=[...s.matchAll(/:not\(([^)]+)\)/g)];
        if(excluded.some(m=>atom(node,m[1])))return false;s=s.replace(/:not\([^)]*\)/g,'');
        const attrs=[...s.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)];s=s.replace(/\[[^\]]+\]/g,'');
        if(attrs.some(([,key,value])=>value===undefined?!Object.hasOwn(node.attrs,key):node.attrs[key]!==value))return false;
        const id=s.match(/#([\w-]+)/)?.[1];if(id&&node.attrs.id!==id)return false;
        const classes=(node.attrs.class||'').split(/\s+/);
        if([...s.matchAll(/\.([\w-]+)/g)].some(m=>!classes.includes(m[1])))return false;
        const tag=s.match(/^[\w-]+/)?.[0];return !tag||tag===node.tag;
    }
    function matches(chain,selector){
        const parts=selector.replace(/\s*>\s*/g,' > ').split(/\s+/);let i=chain.length-1,j=parts.length-1;
        if(!atom(chain[i],parts[j--]))return false;
        while(j>=0){if(parts[j]==='>'){j--;i--;if(i<0||!atom(chain[i],parts[j--]))return false;}
            else {i--;while(i>=0&&!atom(chain[i],parts[j]))i--;if(i<0)return false;j--;}}
        return true;
    }
    const allowed=/^(fill|fill-opacity|fill-rule|stroke|stroke-width|stroke-opacity|stroke-linecap|stroke-linejoin|stroke-dasharray|font-family|font-size|font-weight|font-style|text-anchor|letter-spacing|opacity|display|visibility|cursor|pointer-events)$/;
    const inherit=/^(fill|fill-opacity|fill-rule|stroke|stroke-width|stroke-opacity|stroke-linecap|stroke-linejoin|stroke-dasharray|font-family|font-size|font-weight|font-style|text-anchor|letter-spacing|visibility)$/;
    const original=new Map(),first=new Map();visit(root,(n,p)=>{original.set(n,{...n.attrs});first.set(n,!p.length||p[p.length-1].children.find(c=>typeof c!=='string')===n);});
    function apply(node,parents,inherited){
        if(typeof node==='string'||['style','defs'].includes(node.tag))return;
        const chosen=Object.fromEntries(Object.entries(inherited).map(([k,v])=>[k,{value:v,score:-1}]));
        for(const [k,value]of Object.entries(node.attrs))if(allowed.test(k))chosen[k]={value,score:0};
        const chain=parents.concat(node).map(n=>({tag:n.tag,attrs:original.get(n),first:first.get(n)}));
        const put=(k,v,base)=>{if(!allowed.test(k))return;const important=/!important/.test(v),score=base+(important?10000:0);if(!chosen[k]||score>=chosen[k].score)chosen[k]={value:v.replace(/\s*!important/g,''),score};};
        for(const rule of rules)if(matches(chain,rule.selector))for(const [k,v]of rule.styles)put(k,v,rule.score);
        for(const [k,v]of declarations(node.attrs.style||''))put(k,v,1000);
        delete node.attrs.class;delete node.attrs.style;
        for(const [k,{value}]of Object.entries(chosen))node.attrs[k]=value;
        const next=Object.fromEntries(Object.entries(chosen).filter(([k])=>inherit.test(k)).map(([k,v])=>[k,v.value]));
        for(const child of node.children)apply(child,parents.concat(node),next);
    }
    apply(root,[],{});return root;
}
module.exports={parse,xml,visit,remove,clone,esc,bakeStyles};
