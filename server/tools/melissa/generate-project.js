'use strict';
const fs = require('fs');
const path = require('path');
const manifest = require('../../../examples/melissa/manifest.json');
const { DEFAULT_TAGS } = require('../../runtime/devices/kawasaki');
const out = path.resolve(__dirname,'../../../examples/melissa');
const daq = () => ({ enabled:true, changed:true, interval:10, restored:false });
const cplc = { id:'melissa-cplc',name:'Melissa CPLC · standard DBs',type:'SiemensS7',enabled:false,polling:1000,
    property:{...manifest.cplc,melissa:true,melissaReadOnly:true},tags:{} };
for (const tag of manifest.tags) {
    cplc.tags[tag.id] = { id:tag.id,name:tag.id,address:tag.address,type:tag.type==='STRING'?'String':tag.type,
        access:'read',description:tag.path+' · '+tag.source,daq:daq() };
}
const devices={[cplc.id]:cplc};
for (const controller of manifest.controllers.filter(c=>c.controller)) {
    const id='melissa-kawasaki-'+controller.robot;
    const device={id,name:`Robot ${controller.robot} Kawasaki ${controller.model}`,type:'Kawasaki',enabled:false,polling:5000,
        property:{address:controller.controller,port:23,loginCommand:'as',readyMarker:'>',timeoutMs:10000,
            opeinfo:true,errlog:true,errlogIntervalMs:30000,errlogIgnoreCodes:'',melissaReadOnly:true},tags:{}};
    for (const tag of DEFAULT_TAGS) {
        const tagId='kawasaki.'+controller.robot+'.'+tag.address;
        device.tags[tagId]={...tag,id:tagId,name:tagId,access:'read',daq:daq()};
    }
    devices[id]=device;
}
const pages=[['overview','Εγκατάσταση','home'],...[1,2,3,4,5,6].map(n=>['r'+n,'Robot '+n,'precision_manufacturing']),['semolina','SEMOLINA','inventory'],['buffer','Αναθέσεις στα AGV','inventory_2'],['sap','SAP','cloud'],['eidos','Barcode','qr_code'],['wrapper','Τυλιχτικό','all_inbox'],['palomats','Palomats','layers'],['diagnostics','Diagnostics','monitor_heart'],['events','Events','history']];
pages.splice(pages.findIndex(p=>p[0]==='buffer')+1,0,['deliveries','Ιστορικό παραδόσεων AGV','task_alt']);
const views=pages.map(([page,name])=>{
    const id='MELISSA_IFRAME_'+page;
    const width=1740,height=1000;
    return {id:'melissa_'+page,name,type:'svg',profile:{width,height,bkcolor:'#e9eef3ff'},variables:{},
        items:{[id]:{id,type:'svg-ext-own_ctrl-iframe',name:'Melissa '+name,label:'HtmlIframe',property:{address:'/melissa/?page='+page+'&embed=1'}}},
        svgcontent:`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g id="${id}" type="svg-ext-own_ctrl-iframe"><foreignObject id="D-OXC_${page}" x="0" y="0" width="${width}" height="${height}"/></g></svg>`};
});
const project={version:'1.02',name:'Melissa Central HMI',devices,server:{id:'0',name:'FUXA Server',type:'FuxaServer',property:{},tags:{}},
    hmi:{views,layout:{start:'melissa_overview',autoresize:true,zoom:'autoresize',showdev:true,navigation:{mode:'fix',type:'inline',logo:'/melissa/graphics/condor-robotics.svg',bkcolor:'#dfe6ec',fgcolor:'#294455',items:pages.map(([page,text,icon])=>({view:'melissa_'+page,text,icon,link:''}))},header:{bkcolor:'#edf3f7',fgcolor:'#536e81'}}},alarms:[],texts:[],scripts:[],charts:[]};
fs.writeFileSync(path.join(out,'Melissa_CPLC.fuxap'),JSON.stringify(project,null,2));
const widgets=path.join(out,'widgets');fs.mkdirSync(widgets,{recursive:true});
for (const [page,name] of pages) {
    const width=1740,height=1000;
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" id="melissa_${page}_widget" viewBox="0 0 ${width} ${height}"><foreignObject width="${width}" height="${height}"><iframe xmlns="http://www.w3.org/1999/xhtml" title="${name}" src="/melissa/?page=${page}&amp;embed=1" style="width:${width}px;height:${height}px;border:0;background:#e9eef3"></iframe></foreignObject></svg>`;
    fs.writeFileSync(path.join(widgets,'melissa-'+page+'.svg'),svg);
}
console.log('Generated Melissa project: '+views.length+' views / '+Object.values(devices).reduce((n,d)=>n+Object.keys(d.tags).length,0)+' tags. All connections disabled; no network operations.');
// Share the approved screen colors and typography without shipping preview simulation controls.
fs.writeFileSync(path.resolve(__dirname,'../../api/melissa/public/approved-theme.css'),
    ['preview-light.css','preview-type.css'].map(file=>fs.readFileSync(path.join(__dirname,file),'utf8')).join('\n'));
