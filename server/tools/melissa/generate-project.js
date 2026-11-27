'use strict';
const fs = require('fs');
const path = require('path');
const manifest = require('../../../examples/melissa/manifest.json');
const { DEFAULT_TAGS } = require('../../runtime/devices/kawasaki');
const out = path.resolve(__dirname,'../../../examples/melissa');
const daq = () => ({ enabled:true, changed:true, interval:10, restored:false });
// Endpoint confirmed by the user. NodeIds and security settings come from the real server/editor.
const cplc = { id:'melissa-cplc',name:'Melissa CPLC · OPC UA',type:'OPCUA',enabled:false,polling:1000,
    property:{address:'opc.tcp://192.168.214.105:4840',melissa:true,melissaReadOnly:true},tags:{} };
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
const native=require('./native-views').build(),views=native.views;
const project={version:'1.02',name:'Melissa Central HMI',devices,server:{id:'0',name:'FUXA Server',type:'FuxaServer',property:{},tags:{}},
    hmi:{views,layout:{start:'melissa_overview',autoresize:true,zoom:'autoresize',showdev:true,navigation:{mode:'fix',type:'inline',logo:'/melissa/graphics/condor-robotics.svg',bkcolor:'#dfe6ec',fgcolor:'#294455',items:pages.map(([page,text,icon])=>({view:'melissa_'+page,text,icon,link:''}))},header:{bkcolor:'#edf3f7',fgcolor:'#536e81'}}},alarms:[],texts:[],scripts:[],charts:[]};
fs.writeFileSync(path.join(out,'Melissa_CPLC.fuxap'),JSON.stringify(project,null,2));
const widgets=path.join(out,'widgets');fs.mkdirSync(widgets,{recursive:true});
for (const view of views)fs.writeFileSync(path.join(widgets,view.id.replace('melissa_','melissa-')+'.svg'),view.svgcontent);
fs.writeFileSync(path.join(out,'native-bindings.json'),JSON.stringify({version:native.version,endpoint:cplc.property.address,endpointConfirmedBy:'user',nodeIdsVerified:false,slots:native.slots},null,2));
console.log('Generated native Melissa project: '+views.length+' views / '+views.reduce((n,v)=>n+Object.keys(v.items).length,0)+' editable FUXA elements. OPC UA CPLC has no preselected tags. All connections disabled; no network operations.');
// Share the approved screen colors and typography without shipping preview simulation controls.
fs.writeFileSync(path.resolve(__dirname,'../../api/melissa/public/approved-theme.css'),
    ['preview-light.css','preview-type.css'].map(file=>fs.readFileSync(path.join(__dirname,file),'utf8')).join('\n'));
