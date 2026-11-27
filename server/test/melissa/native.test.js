'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {parse,visit,bakeStyles}=require('../../tools/melissa/native-scene');
const {editorSvg,matrixTransform,upgradeEditorView}=require('../../tools/melissa/editor-layer');
const project=()=>JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../examples/melissa/Melissa_CPLC.fuxap')));
describe('Native Melissa HMI architecture',function(){
    it('has a browse-ready OPC UA connection and no fabricated CPLC NodeIds or S7 devices',function(){
        const p=project(),c=p.devices['melissa-cplc'];assert.equal(c.type,'OPCUA');assert.equal(c.property.address,'opc.tcp://192.168.214.105:4840');assert.deepEqual(c.tags,{});
        assert.ok(Object.values(p.devices).every(d=>d.type!=='SiemensS7'&&!d.enabled));
    });
    it('makes every screen control independently editable and native, with valid native navigation destinations',function(){
        const p=project(),ids=new Set(p.hmi.views.map(v=>v.id));
        for(const view of p.hmi.views){
            assert.ok(!/iframe|\/melissa\/\?/.test(view.svgcontent));assert.equal(view.property.melissaNativeVersion,2);
            const root=parse(view.svgcontent),layers=root.children.filter(n=>n.tag==='g'&&n.children.some(c=>c.tag==='title'));
            assert.equal(layers.length,1);
            const top=new Set(layers[0].children.filter(n=>n.attrs).map(n=>n.attrs.id)),counts={};
            visit(root,n=>{if(n.attrs.id)counts[n.attrs.id]=(counts[n.attrs.id]||0)+1;});
            for(const item of Object.values(view.items)){
                assert.ok(top.has(item.id),item.id+' must be a separate editor object');assert.equal(counts[item.id],1);
                assert.ok(['svg-ext-shapes','svg-ext-value','svg-ext-gauge_semaphore','svg-ext-own_ctrl-table'].includes(item.type));
                for(const event of item.property.events||[]){assert.ok(['onpage','ondialog'].includes(event.action));assert.ok(ids.has(event.actparam),event.actparam);}
            }
        }
    });
    it('provides independent request and occupied bindings and leaves PLC selection to the user',function(){
        const view=project().hmi.views.find(v=>v.id==='melissa_overview');
        assert.equal(Object.keys(view.items).filter(k=>k.includes('_request_')&&!k.includes('request_button')).length,36);
        assert.equal(Object.keys(view.items).filter(k=>k.includes('_occupied_')).length,18);
        const svg=parse(view.svgcontent),arrows=[];visit(svg,n=>{if(n.attrs.id?.includes('_request_')&&!n.attrs.id.includes('request_button')&&n.attrs.type==='svg-ext-shapes')arrows.push(n);});
        for(const arrow of arrows){let target=false;visit(arrow,n=>{if(n.tag==='path'&&n.attrs.id?.startsWith('svg_'))target=true;});assert.ok(target,'native SVG paint target required');}
        for(const item of Object.values(view.items))assert.ok(!item.property.variableId);
    });
    it('bakes CSS into native attributes so the editor can change fill and status colors',function(){
        const root=parse('<svg id="root"><style>#root .lamp{fill:#112233}.floor path:first-child{fill:#abcdef}</style><g class="floor"><path d="M0 0h2"/></g><g class="lamp"><circle r="4"/></g></svg>');
        bakeStyles(root);const nodes=[];visit(root,n=>nodes.push(n));
        assert.equal(nodes.find(n=>n.tag==='circle').attrs.fill,'#112233');assert.equal(nodes.find(n=>n.tag==='path').attrs.fill,'#abcdef');
        assert.ok(!/<style/.test(project().hmi.views[0].svgcontent));
    });
    it('prevents asset titles becoming editor layers and keeps composed transforms as one equivalent matrix',function(){
        assert.equal(matrixTransform('translate(30 157) scale(1.05) translate(833 61)'),'matrix(1.05 0 0 1.05 904.65 221.05)');
        assert.equal(matrixTransform('rotate(180 800 280)'),'matrix(-1 0 0 -1 1600 560)');
        const svg=editorSvg('<svg><g id="control" type="svg-ext-shapes" transform="translate(30 157) scale(1.05)"><title>Artwork</title><rect width="10" height="10"/></g></svg>','view');
        const root=parse(svg),layer=root.children[0];assert.equal(layer.children[0].children[0],'Layer 1');
        assert.equal(layer.children[1].attrs.id,'control');assert.ok(!svg.includes('Artwork'));
        assert.equal(editorSvg(svg,'view'),svg);
        const views=project().hmi.views;assert.notEqual(views.find(v=>v.id==='melissa_overview').name,views.find(v=>v.id==='melissa_overview_180').name);
    });
    it('recovers a damaged overview from approved geometry without replacing editor tag bindings',function(){
        const template=project().hmi.views.find(v=>v.id==='melissa_overview'),old=structuredClone(template);
        old.property.melissaNativeVersion=1;old.svgcontent='<svg><g id="MEL_overview_rotation" transform="translate(9999 9999)"/></svg>';
        old.items['MEL_overview_request_r1-1-out'].property.variableId='user-opcua-node';
        const upgraded=upgradeEditorView(old,template);
        assert.equal(upgraded.svgcontent,template.svgcontent);assert.equal(upgraded.items['MEL_overview_request_r1-1-out'].property.variableId,'user-opcua-node');
        assert.equal(old.property.melissaNativeVersion,1);assert.equal(upgraded.property.melissaNativeVersion,2);
    });
});
