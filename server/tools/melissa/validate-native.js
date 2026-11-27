'use strict';
// Pure file validation. Does not start FUXA, load drivers, connect, or compile the client.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {parse,visit}=require('./native-scene');
const directory=path.resolve(__dirname,'../../../examples/melissa');
function validate(){
    const project=JSON.parse(fs.readFileSync(path.join(directory,'Melissa_CPLC.fuxap'))),viewIds=new Set(project.hmi.views.map(v=>v.id));
    const tags=new Set(Object.values(project.devices).flatMap(d=>Object.keys(d.tags)));
    assert.equal(project.devices['melissa-cplc'].type,'OPCUA');assert.deepEqual(project.devices['melissa-cplc'].tags,{});
    assert.ok(Object.values(project.devices).every(d=>!d.enabled&&d.type!=='SiemensS7'));
    let elements=0;
    for(const view of project.hmi.views){
        assert.ok(!/iframe|<script|\/melissa\/\?/.test(view.svgcontent),'Non-native screen '+view.id);
        const root=parse(view.svgcontent),top=new Map(root.children.filter(n=>n.attrs?.id).map(n=>[n.attrs.id,n]));
        const counts={};visit(root,n=>{if(n.attrs.id)counts[n.attrs.id]=(counts[n.attrs.id]||0)+1;});
        for(const item of Object.values(view.items)){
            elements++;assert.ok(top.has(item.id),'Not independently selectable: '+item.id);assert.equal(counts[item.id],1);
            assert.ok(item.type!=='svg-ext-own_ctrl-iframe');
            if(item.type==='svg-ext-value')assert.equal(top.get(item.id).children.filter(n=>n.tag).length,1);
            if(item.type==='svg-ext-gauge_semaphore')assert.equal(top.get(item.id).children.find(n=>n.tag)?.tag,'circle');
            if(item.id.includes('_request_')&&!item.id.includes('request_button')){
                let paintable=false;visit(top.get(item.id),n=>{if(n.tag==='path'&&n.attrs.id?.startsWith('svg_'))paintable=true;});
                assert.ok(paintable,'Native arrow color target missing: '+item.id);
            }
            if(item.property.variableId)assert.ok(tags.has(item.property.variableId),'Unknown prebound tag '+item.property.variableId);
            for(const e of item.property.events||[]){assert.ok(['onpage','ondialog'].includes(e.action));assert.ok(viewIds.has(e.actparam),'Missing native target '+e.actparam);}
        }
    }
    const overview=project.hmi.views.find(v=>v.id==='melissa_overview');
    assert.equal(Object.keys(overview.items).filter(id=>id.includes('_request_')&&!id.includes('request_button')).length,36);
    assert.equal(Object.keys(overview.items).filter(id=>id.includes('_occupied_')).length,18);
    const result={status:'passed',method:'static generated-project validation',views:project.hmi.views.length,editableElements:elements,iframeElements:0,protocol:'OPCUA',preselectedCplcTags:0,compiledFuxaTest:false,realPlcValidation:false};
    fs.writeFileSync(path.join(directory,'native-validation.json'),JSON.stringify(result,null,2));return result;
}
if(require.main===module)console.log(JSON.stringify(validate()));module.exports={validate};
