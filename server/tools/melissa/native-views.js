'use strict';
const fs=require('fs'),path=require('path');
const {parse,xml,visit,remove,clone,esc,bakeStyles}=require('./native-scene');
const {graphic:palomatGraphic,assignments,palletTypes}=require('./palomat-graphics');
const manifest=require('../../../examples/melissa/manifest.json');
const publicDir=path.resolve(__dirname,'../../api/melissa/public');
const SHAPE='svg-ext-shapes',VALUE='svg-ext-value',LAMP='svg-ext-gauge_semaphore',TABLE='svg-ext-own_ctrl-table';
const C={text:'#294b63',muted:'#526c7f',panel:'#ffffff',line:'#b8c7d2',bg:'#e9eef3'};
const clean=s=>String(s).replace(/[^a-zA-Z0-9_-]/g,'_');
const event=(page,dialog=false)=>({type:'click',action:dialog?'ondialog':'onpage',actparam:'melissa_'+page,actoptions:{}});
class View{
    constructor(page,name,width=1740,height=1000){this.page=page;this.id='melissa_'+page;this.name=name;this.width=width;this.height=height;this.items={};this.parts=[];this.slots=[];this.counter=0;}
    add(key,name,body,{type=SHAPE,property={},hint=null,transform='',style=''}={}){
        const id='MEL_'+clean(this.page)+'_'+clean(key);if(this.items[id])throw new Error('Duplicate native element '+id);
        this.items[id]={id,name,type,label:type===VALUE?'Value':type===LAMP?'HtmlSemaphore':type===TABLE?'HtmlTable':type==='svg-ext-own_ctrl-panel'?'Panel':'Shapes',
            property:{variableId:'',ranges:[],actions:[],events:[],...property}};
        this.parts.push(`<g id="${id}" type="${type}"${transform?` transform="${esc(transform)}"`:''}${style?` style="${esc(style)}"`:''}>${body}</g>`);
        if(hint)this.slots.push({view:this.id,element:id,name,suggestedSource:hint,property:type===TABLE?'property.options.rows[].cells[].variableId':property.actions?.length?'property.actions[0..1].variableId':'property.variableId',binding:null});
        return id;
    }
    text(key,text,x,y,size=16,fill=C.text){return this.add(key,text,`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-family="Segoe UI,Arial,sans-serif">${esc(text)}</text>`);}
    card(key,x,y,w,h){return this.add(key,'Πλαίσιο '+key,`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${C.panel}" stroke="${C.line}"/>`);}
    button(key,label,x,y,w,target,dialog=false){return this.add(key,label,`<rect x="${x}" y="${y}" width="${w}" height="42" rx="7" fill="#e3eef6" stroke="#9eb8ca"/><text x="${x+w/2}" y="${y+27}" text-anchor="middle" fill="${C.text}" font-size="16" font-family="Segoe UI,Arial">${esc(label)}</text>`,{property:{events:[event(target,dialog)]}});}
    value(key,label,x,y,hint,variableId=''){
        this.text(key+'_label',label,x,y,15,C.muted);
        return this.add(key,label,`<text x="${x}" y="${y+31}" fill="${C.text}" font-size="21" font-family="Segoe UI,Arial">—</text>`,{type:VALUE,property:{variableId},hint});
    }
    table(key,title,x,y,w,h,columns,rows=[],source='tags'){
        this.text(key+'_heading',title,x,y-18,20);
        const id='MEL_'+clean(this.page)+'_'+clean(key);
        const options={source,paginator:{show:false},filter:{show:false},daterange:{show:false},realtime:false,lastRange:'last1h',gridColor:'#cfdae3',
            header:{show:true,height:42,fontSize:15,background:'#eaf1f7',color:C.muted},row:{height:38,fontSize:15,background:'#fff',color:C.text},
            selection:{background:'#d0e1ee',color:C.text,fontBold:true},columns:columns.map((c,i)=>({id:'c'+i,type:'label',label:c,width:Math.floor(w/columns.length),align:'left'})),
            alarmFilter:{filterA:[],filterB:[],filterC:[]},reportsColumns:[],alarmsColumns:[],reportFilter:{filterA:[]},rows:rows.map((r,i)=>({id:'r'+i,cells:r.map((c,j)=>typeof c==='string'?{id:'c'+j,type:'label',label:c}:{id:'c'+j,type:'variable',variableId:c.tag||'',label:'',valueFormat:'',...c})}))};
        for(const [i,row]of rows.entries())for(const [j,cell]of row.entries())if(cell?.sourceHint)this.slots.push({view:this.id,element:id,name:title+' / '+(i+1)+' / '+columns[j],suggestedSource:cell.sourceHint,property:`property.options.rows[${i}].cells[${j}].variableId`,binding:null});
        return this.add(key,title,`<foreignObject id="D-OXC_${id}" x="${x}" y="${y}" width="${w}" height="${h}"></foreignObject>`,{type:TABLE,property:{type:'data',options,events:[]},hint:source==='tags'?'User-selected OPC UA tags per table cell':null});
    }
    header(back=true){this.text('title',this.name,30,48,28);if(back)this.button('home','← Εγκατάσταση',1490,17,220,'overview');}
    finish(){return {id:this.id,name:this.name,type:'svg',profile:{width:this.width,height:this.height,bkcolor:C.bg+'ff'},property:{melissaNativeVersion:1},variables:{},items:this.items,
        svgcontent:`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}"><rect width="${this.width}" height="${this.height}" fill="${C.bg}"/>${this.parts.join('')}</svg>`};}
}
function artwork(v,key,body,x,y,w,h){return v.add(key,key,body.replace('<svg ',`<svg x="${x}" y="${y}" width="${w}" height="${h}" `));}
function stationPage(point){
    const v=new View('station_'+point.id,point.label,760,560);v.text('title',point.label,28,42,26);
    for(const [i,field]of ['Operational','Occupied','AGVRequest','ROBRequest','Release','PalletType','SSCC'].entries()){
        v.value('field_'+field,field,32+(i%2)*365,95+Math.floor(i/2)*100,point.station?point.station+'.'+field:'SEMOLINA.'+field);
    }
    v.text('unbound','Επιλογή πραγματικών OPC UA tags από τον editor.',28,530,14,C.muted);return v;
}
function overview(model,rotated=false){
    const v=new View(rotated?'overview_180':'overview','Εγκατάσταση');v.header(false);
    v.button('rotation','Περιστροφή 180°',1470,20,235,rotated?'overview':'overview_180');
    for(const [i,[key,label,hint]]of [['waiting','Σε αναμονή','Aggregate: occupied full OUT + SEMOLINA'],['transit','Σε διακίνηση AGV','AGVBuffer outstanding pallet count'],['wrapper','Εντός Τυλιχτικού','Wrapper count until printing complete']].entries()){
        const x=290+i*285;v.card('kpi_'+key,x,12,270,86);v.value('kpi_value_'+key,label,x+15,38,hint);
    }
    v.card('layout_panel',28,125,1684,758);
    const tree=parse(fs.readFileSync(path.join(publicDir,'factory-layout.svg'),'utf8'));
    // Remember semantic roles before classes are converted into editable SVG attributes.
    visit(tree,n=>{if(n.attrs.class)n.nativeClass=n.attrs.class;});bakeStyles(tree);
    const output=[],seen=new Set();let counter=0;
    // Bake an alternative native view; no page script or HTML widget rotates the layout.
    if(rotated)visit(tree,(node,parents)=>{
        if(node.attrs['data-keep-upright']||node.tag==='text'){
            if(parents.some(p=>p.attrs?.['data-keep-upright']))return;
            const x=Number(node.attrs['data-upright-cx']??node.attrs.x??0),y=Number(node.attrs['data-upright-cy']??node.attrs.y??0);
            node.attrs.transform=(node.attrs.transform||'')+` rotate(180 ${x} ${y})`;
        }
    });
    const base='translate(30 157) scale(1.05) '+(rotated?'rotate(180 800 280) ':'');
    function emit(node,name,key,parents,property={},hint=null,type=SHAPE,style=''){
        const copy=clone(node);delete copy.attrs.transform;
        // Node ids are view-local. Keep asset definitions and references intact below the registered group.
        visit(copy,n=>{
            if(n.attrs.id)delete n.attrs.id;
            // Native editor groups use paths/images directly; nested SVG viewports
            // can clip neighbouring controls after editing or ungrouping.
            if(n.tag==='svg'){
                const box=(n.attrs.viewBox||'0 0 '+n.attrs.width+' '+n.attrs.height).split(/[ ,]+/).map(Number);
                const w=Number(n.attrs.width)||box[2],h=Number(n.attrs.height)||box[3],s=Math.min(w/box[2],h/box[3]);
                const x=(Number(n.attrs.x)||0)+(w-box[2]*s)/2,y=(Number(n.attrs.y)||0)+(h-box[3]*s)/2;
                n.tag='g';n.attrs.transform=`translate(${x} ${y}) scale(${s}) translate(${-box[0]} ${-box[1]})`+(n.attrs.transform?' '+n.attrs.transform:'');
                for(const attr of ['x','y','width','height','viewBox','xmlns'])delete n.attrs[attr];
            }
        });
        const transform=base+parents.map(p=>p.attrs?.transform||'').filter(Boolean).join(' ')+' '+(node.attrs.transform||'');
        const body=type===LAMP?copy.children.filter(c=>typeof c!=='string').map(xml).join(''):xml(copy);
        const id=v.add(key,name,body,{property,hint,type,transform:transform.trim(),style});output.push(id);
    }
    function walk(node,parents=[]){
        if(typeof node==='string')return;
        const a=node.attrs;
        if(['title','desc','defs','style'].includes(node.tag))return;
        if(a['data-entity-status']){
            const id=a['data-entity-status'];
            emit({tag:'g',attrs:{...a},children:[{tag:'circle',attrs:{r:'6.5',fill:'#cbd6df',stroke:'#7994a8'},children:[]}]},'Κατάσταση '+id,'status_'+id,parents,{ranges:[{min:0,max:0,color:'#cbd6df'},{min:1,max:1,color:'#31a572'},{min:2,max:2,color:'#e4aa3b'},{min:3,max:3,color:'#dc4a43'}]},id+'.Status',LAMP);return;
        }
        if(a['data-pickup-station']){
            emit(node,'SEMOLINA · Αίτημα παραλαβής (χωρίς εντολή)','semolina_request_button',parents,{},'SEMOLINA command: pending writer/permissives');return;
        }
        if(a['data-endpoint']){
            const id=a['data-endpoint'],point=model.endpoints.find(e=>e.id===id);
            if(point?.kind==='menu'){emit(node,'Barcode · Μενού','barcode_menu',parents,{events:[event('eidos_popup',true)]});return;}
            const station=model.outfeeds.find(o=>o.id===id)?.station||manifest.stations.find(s=>s.name.replace(/-/g,'').toLowerCase()===id.replace(/-/g,''))?.name;
            point.station=station;
            const popup='station_'+id;
            const plate=clone(node);plate.children=plate.children.filter(c=>typeof c==='string'||!['arrow-lamp','selection-mark'].includes(c.nativeClass));
            emit(plate,point.label+' · Μενού','station_'+id,parents,{events:[event(popup,true)]});
            const lamp=node.children.find(c=>c.nativeClass==='arrow-lamp');
            if(lamp){const lampCopy=clone(lamp);delete lampCopy.attrs.class;lampCopy.attrs.fill='#c3d6e3';lampCopy.attrs.stroke='#7897ab';
                emit({tag:'g',attrs:{transform:a.transform||''},children:[lampCopy]},point.label+' · AGVRequest','request_'+id,parents,{ranges:[{min:0,max:0,color:'#c3d6e3',stroke:'#7897ab'},{min:1,max:1,color:'#ffd35b',stroke:'#a87913'}],events:[event(popup,true)]},(station||'SEMOLINA')+'.AGVRequest');}
            return;
        }
        if(a['data-pallet-for']){
            const id=a['data-pallet-for'],out=model.outfeeds.find(o=>o.id===id),load=clone(node);
            load.children=load.children.filter(c=>c.nativeClass==='full-load');
            visit(load,n=>{delete n.attrs.opacity;delete n.attrs.display;});
            emit(load,id+' · Γεμάτη παλέτα / Occupied','occupied_'+id,parents,{actions:[{type:'hide',variableId:'',range:{min:0,max:0}},{type:'show',variableId:'',range:{min:1,max:1}}],events:[event('station_'+id,true)]},(out?.station||'SEMOLINA')+'.Occupied',SHAPE,'display:none');return;
        }
        if(a['data-open-page']){
            const page=a['data-open-page'],selection=a['data-open-selection'];
            // Status icons are separate bindable controls, not part of a button's fill range.
            const copy=clone(node);visit(copy,(n,p)=>{if(n.attrs?.['data-entity-status'])remove(p[p.length-1],n);});
            const target=page==='palomats'?'palomat_'+selection:page==='eidos'?'eidos_popup':page;
            emit(copy,selection?'Palomat '+selection:page==='buffer'?'Αναθέσεις στα AGV':page==='eidos'?'Barcode':page,'open_'+page+'_'+(++counter),parents,{events:[event(target,page==='palomats'||page==='eidos')]});
            visit(node,(n,p)=>{if(n!==node&&n.attrs?.['data-entity-status'])walk(n,parents.concat(p));});return;
        }
        if(node.tag==='g'&&a['data-keep-upright']==='image'){
            emit(node,'Γραφικό κυψέλης','art_'+(++counter),parents);return;
        }
        if(node.tag==='svg'&&node===tree||node.tag==='g')for(const child of node.children)walk(child,parents.concat(node));
        else emit(node,'Γραφικό '+(++counter),'graphic_'+counter,parents);
    }
    // No stylesheet can override native FUXA attribute bindings.
    for(const n of tree.children.filter(n=>n.tag==='defs'))v.parts.push(xml(n));
    const start=v.parts.length;walk(tree);
    // Each control is a top-level editor object, never one grouped picture of the screen.
    const drawing=v.parts.splice(start).join('');v.parts.push(drawing);
    v.text('binding_notice','— Μη συνδεδεμένο · κάθε βέλος, παλέτα και ένδειξη έχει δικές του ιδιότητες στον editor.',34,929,16,C.muted);
    return v;
}
function build(){
    const model=JSON.parse(fs.readFileSync(path.join(publicDir,'layout-data.json'))),views=[],allSlots=[];
    const add=v=>{views.push(v.finish());allSlots.push(...v.slots);};
    add(overview(model));add(overview(model,true));
    for(let robot=1;robot<=6;robot++){
        const v=new View('r'+robot,'Robot '+robot);v.header();
        const stations=manifest.stations.filter(s=>s.robot===robot);
        v.table('handshake','Stations · AGV',30,120,1680,340,['Station','Operational','Occupied','AGVRequest','ROBRequest','Release','Pallet type','SSCC'],stations.map(s=>[s.name,...['Operational','Occupied','AGVRequest','ROBRequest','Release','PalletType','SSCC'].map(f=>({sourceHint:s.name+'.'+f}))]));
        const controller=manifest.controllers.find(c=>c.robot===robot);
        if(controller.controller){
            v.text('kawasaki_heading','Kawasaki · κατάσταση',30,510,22);
            for(const [i,[label,key]]of [['Mode','sta.mode'],['Motor','sta.motor_power'],['Program','sta.now_moving_program'],['Step','sta.now_moving_step']].entries())v.value('kawasaki_'+i,label,30+i*405,550,key,'kawasaki.'+robot+'.'+key);
            v.table('kawasaki_errors','Kawasaki · Error log',30,675,1680,280,['Slot','Timestamp','Code','Message'],Array.from({length:10},(_,i)=>{const p='kawasaki.'+robot+'.errlog.slot_'+String(i+1).padStart(2,'0');return [String(i+1),{tag:p+'.timestamp_ms'},{tag:p+'.code'},{tag:p+'.message'}];}));
        }else v.text('controller_pending','Δεν έχει αντιστοιχιστεί Kawasaki controller σε αυτή την κυψέλη.',30,520,18,C.muted);
        add(v);
    }
    const sem=new View('semolina','SEMOLINA · Σιμιγδάλι');sem.header();sem.card('sap',30,105,810,420);sem.card('agv',865,105,845,420);
    for(const [i,f]of ['SSCC','MATNR','Περιγραφή','PalletType'].entries())sem.value('sap_'+i,f,55,155+i*88,'SEMOLINA.SAP.'+f);
    for(const [i,f]of ['Operational','Occupied','AGVRequest','Release'].entries())sem.value('agv_'+i,f,895+(i%2)*390,160+Math.floor(i/2)*110,'SEMOLINA.'+f);
    sem.add('request','Αίτημα παραλαβής (μη αντιστοιχισμένο)',`<rect x="895" y="415" width="760" height="55" rx="8" fill="#e5ebef" stroke="${C.line}"/><text x="1275" y="450" text-anchor="middle" font-size="18" fill="${C.muted}">Αίτημα παραλαβής → AGV</text>`);sem.text('request_info','Φυσικό κουμπί ή HMI · εντολή και interlocks σε εκκρεμότητα.',30,595,18,C.muted);add(sem);
    for(const [page,title]of [['buffer','Αναθέσεις στα AGV'],['deliveries','Ιστορικό παραδόσεων AGV']]){
        const v=new View(page,title);v.header();v.text('meaning',page==='buffer'?'Παλέτες που αναμένουν παράδοση στο Τυλιχτικό.':'Παλέτες που παραδόθηκαν στο Τυλιχτικό.',30,90,18,C.muted);
        v.table('records',title,30,155,1680,780,page==='buffer'?['Θέση','SSCC','Υλικό','Παλέτα']:['Χρόνος','Station','SSCC','Pallet type','Επιβεβαίωση'],page==='buffer'?Array.from({length:60},(_,i)=>[String(i+1),{sourceHint:`buffer.${i+1}.SSCC`},{sourceHint:`buffer.${i+1}.MATNR`},{sourceHint:`buffer.${i+1}.PALNR`}]):[],page==='buffer'?'tags':'melissa-deliveries');add(v);
    }
    for(const [page,title]of [['sap','SAP'],['eidos','Barcode'],['wrapper','Τυλιχτικό']]){
        const v=new View(page,title);v.header();const pending=manifest.pending[page==='wrapper'?'wrapper':page];
        for(const [i,p]of pending.paths.entries())v.value('field_'+i,p,40+(i%3)*560,130+Math.floor(i/3)*120,page+'.'+p);
        if(page==='wrapper')v.table('wrap','WRAP-IN',30,630,1680,200,['Operational','Occupied','AGVRequest','ROBRequest','Release','PalletType','SSCC'],[['Operational','Occupied','AGVRequest','ROBRequest','Release','PalletType','SSCC'].map(f=>({sourceHint:'WRAP-IN.'+f}))]);
        if(page==='eidos')v.button('popup','Άνοιγμα μενού Barcode',30,650,330,'eidos_popup',true);add(v);
    }
    const barcode=new View('eidos_popup','Barcode',800,580);barcode.header(false);
    for(const [i,f]of ['Επικοινωνία','Ετοιμότητα','Σφάλμα','SSCC','Υλικό','Περιγραφή'].entries())barcode.value('barcode_'+i,f,30+(i%2)*390,120+Math.floor(i/2)*135,'eidos.'+f);add(barcode);
    const hub=new View('palomats','Palomats');hub.header();
    for(const [i,a]of assignments.entries()){
        const x=30+i*338;hub.card('palomat_'+a.number,x,115,310,650);artwork(hub,'art_'+a.number,palomatGraphic(a.type),x+40,170,230,390);hub.text('type_'+a.number,palletTypes[a.type].name,x+25,610,18);hub.button('open_'+a.number,'Palomat '+a.number,x+30,670,250,'palomat_'+a.number,true);
        const v=new View('palomat_'+a.number,'Palomat '+a.number,800,600);v.header(false);artwork(v,'art',palomatGraphic(a.type),30,95,250,390);v.text('type',palletTypes[a.type].name,30,535,20);
        for(const [j,[label,field]]of [['Έτοιμο','PAL_XOUT_Ready'],['Άδειο','PAL_XOUT_Empty'],['Σφάλμα','PAL_XOUT_Error']].entries())v.value('field_'+j,label,320,140+j*115,'PALOMAT-'+a.number+'.'+field);add(v);
    }add(hub);
    const diag=new View('diagnostics','Diagnostics');diag.header();
    for(const [i,f]of ['AGV_Status','AGV_NoAlarm','CPLC_Status','CPLC_NoAlarm','AGV_HB','CPLC_HB'].entries())diag.value('interface_'+i,f,40+(i%3)*560,130+Math.floor(i/3)*120,'Interface.'+f);
    const alarmId=diag.table('alarms','FUXA alarms',30,460,1680,470,['Alarm','Status'],[]);
    diag.items[alarmId].property.type='alarms';
    diag.items[alarmId].property.options.alarmsColumns=[['ontime','Χρόνος'],['text','Μήνυμα'],['type','Τύπος'],['status','Κατάσταση']].map(([id,label])=>({id,type:'label',label,width:id==='text'?800:260,align:'left'}));add(diag);
    const events=new View('events','Events');events.header();events.table('events','Συμβάντα · χωριστή βάση FUXA',30,120,1680,820,['ID','Χρόνος','Device','Event','Tag','Value'],[],'melissa-events');add(events);
    // Each existing station and SEMOLINA has a genuine native dialog, not an HTML document.
    for(const point of model.endpoints.filter(p=>p.kind==='arrow'))add(stationPage(point));
    return {views,slots:allSlots,version:1};
}
module.exports={build,View};
