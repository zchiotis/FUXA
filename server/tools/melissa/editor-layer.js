'use strict';
const {parse,xml,visit,remove}=require('./native-scene');

function matrixTransform(value){
    const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
    let result=[1,0,0,1,0,0];
    for(const match of value.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)){
        const n=match[2].trim().split(/[ ,]+/).map(Number),angle=n[0]*Math.PI/180;
        let next;
        if(match[1]==='matrix')next=n;
        if(match[1]==='translate')next=[1,0,0,1,n[0],n[1]||0];
        if(match[1]==='scale')next=[n[0],0,0,n[1]??n[0],0,0];
        if(match[1]==='skewX')next=[1,0,Math.tan(angle),1,0,0];
        if(match[1]==='skewY')next=[1,Math.tan(angle),0,1,0,0];
        if(match[1]==='rotate'){
            const c=Math.cos(angle),s=Math.sin(angle),x=n[1]||0,y=n[2]||0;
            next=[c,s,-s,c,x-c*x+s*y,y-s*x-c*y];
        }
        if(next.length!==6||next.some(v=>!Number.isFinite(v)))throw new Error('Invalid SVG transform '+value);
        result=multiply(result,next);
    }
    return 'matrix('+result.map(n=>Math.abs(n)<1e-12?0:Number(n.toFixed(10))).join(' ')+')';
}

// SVG-Edit treats every root group containing any descendant <title> as a
// layer. Artwork titles must therefore sit below a real authoring layer;
// otherwise a Palomat/AGV asset becomes a locked layer instead of a control.
function editorSvg(svg,id){
    const root=parse(svg);
    // SVG-Edit's load-time transform simplifier changes nested translate/scale
    // chains incorrectly. A single equivalent matrix preserves the artwork
    // while leaving every native control movable/resizable in the editor.
    visit(root,(node,parents)=>{
        if(node.attrs.transform)node.attrs.transform=matrixTransform(node.attrs.transform);
        if(node.tag==='title'&&parents.some(p=>p.attrs.type?.startsWith('svg-ext-')))remove(parents[parents.length-1],node);
        // SVG-Edit reads and serializes image sources in the XLink namespace.
        if(node.tag==='image'&&node.attrs.href){
            root.attrs['xmlns:xlink']='http://www.w3.org/1999/xlink';
            node.attrs['xlink:href']=node.attrs.href;
            delete node.attrs.href;
        }
        if(node.attrs.style?.includes('display:none')){
            node.attrs.display='none';
            node.attrs.style=node.attrs.style.replace(/display\s*:\s*none\s*;?/g,'');
            if(!node.attrs.style)delete node.attrs.style;
        }
    });
    const hasLayer=root.children.some(n=>n.tag==='g'&&!n.attrs.type&&n.children.some(c=>c.tag==='title'));
    if(hasLayer)return xml(root); // Preserve layers and drawing edits saved by the user.
    const definitions=root.children.filter(n=>['defs','title','desc','metadata'].includes(n.tag));
    const drawing=root.children.filter(n=>!definitions.includes(n));
    root.children=[...definitions,{tag:'g',attrs:{id:id+'_layer'},children:[{tag:'title',attrs:{},children:['Layer 1']},...drawing]}];
    return xml(root);
}

function upgradeEditorView(view,template){
    if(view?.property?.melissaNativeVersion!==1)return view;
    const upgraded=structuredClone(view);
    if(/^melissa_overview(?:_180)?$/.test(view.id)&&template){
        // Build 11 may already have saved the distorted drawing. Restore the
        // approved geometry, keeping the user's item properties/tag bindings.
        const root=parse(template.svgcontent),layer=root.children.find(n=>n.tag==='g'&&!n.attrs.type);
        const old=parse(view.svgcontent);visit(old,n=>{if(n.attrs.id&&view.items[n.attrs.id]&&!template.items[n.attrs.id])layer.children.push(n);});
        upgraded.svgcontent=xml(root);
        upgraded.items={...structuredClone(template.items),...upgraded.items};
    }else upgraded.svgcontent=editorSvg(upgraded.svgcontent,upgraded.id);
    if(upgraded.id==='melissa_overview_180'&&upgraded.name==='Εγκατάσταση')upgraded.name='Εγκατάσταση · 180°';
    upgraded.property.melissaNativeVersion=2;
    return upgraded;
}
module.exports={editorSvg,upgradeEditorView,matrixTransform};
