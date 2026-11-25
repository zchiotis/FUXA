'use strict';
// A schematic redraw of the supplied PDF. Geometry intentionally adjusted for 1920x1080.
// Occupied display bindings are checked against the offline manifest. No PLC writes.
const fs=require('fs'),path=require('path');
const {palletTypes,assignments:palomats,graphic:palomatGraphic}=require('./palomat-graphics');
const {graphic:fullPalletGraphic}=require('./full-pallet-graphics');
const {graphic:agvGraphic}=require('./agv-graphics');
const {graphic:barcodeGraphic}=require('./barcode-graphics');
const root=path.resolve(__dirname,'../../..');
const publicDir=path.join(root,'server/api/melissa/public');
const output=path.join(root,'examples/melissa/graphics');
const manifest=require(path.join(root,'examples/melissa/manifest.json'));
fs.mkdirSync(output,{recursive:true});
const cells=[
    {id:'r6',name:'Robot 6',centres:[84,130,176,222],lines:[4,3,2,1],directions:[['IN'],['OUT'],['OUT'],['IN']],left:48,right:258,top:280,bottom:486},
    {id:'r1',name:'Robot 1',centres:[310,368,426,484,542],lines:[5,4,3,2,1],left:278,right:576,top:326,bottom:458},
    {id:'r4',name:'Robot 4',centres:[638],lines:[1],left:598,right:678,top:326,bottom:478},
    {id:'r2',name:'Robot 2',centres:[728,790,852],lines:[3,2,1],left:698,right:882,top:326,bottom:478},
    {id:'r3',name:'Robot 3',centres:[956,1018,1080],lines:[3,2,1],left:926,right:1110,top:326,bottom:478},
    {id:'r5',name:'Robot 5',centres:[1174,1236,1298],lines:[3,2,1],left:1144,right:1328,top:326,bottom:478},
    {id:'wrapper',name:'Τυλιχτικό',centres:[1465],lines:[1],directions:[['IN']],left:1407,right:1543,top:276,bottom:458}
];
const endpoints=[];
const outfeeds=[];
const entities=cells.map(cell=>({id:cell.id,name:cell.name,page:cell.id,kind:'cell',statusBinding:null}));
entities.push({id:'agv-assignments',name:'Αναθέσεις στα AGV',page:'buffer',kind:'assignments',statusBinding:null});
for(const {number,type} of palomats)entities.push({id:'palomat-'+number,name:'Palomat '+number,page:'palomats',selection:String(number),kind:'palomat',palletFamily:type,statusBinding:null});
entities.push({id:'eidos',name:'Barcode',page:'eidos',kind:'printer',statusBinding:null});
entities.push({id:'semolina',name:'SEMOLINA',page:'semolina',kind:'manual-station',statusBinding:null});
const parts=[];
function statusIcon(id,x,y){
    const entity=entities.find(e=>e.id===id);
    return `<g class="entity-status" data-entity-status="${id}" data-status="unknown" role="img" aria-label="${entity.name}: χωρίς δεδομένα" transform="translate(${x} ${y})"><title>${entity.name} · Χωρίς δεδομένα</title><circle r="6.5"/><path d="M-2.5 0h5"/></g>`;
}
const line=(x1,y1,x2,y2,cls='machine-line')=>`<path class="${cls}" d="M${x1} ${y1}H${x2}"/>`;
function conveyor(x,top,bottom,width=31){
    let s=`<rect class="conveyor" x="${x-width/2}" y="${top}" width="${width}" height="${bottom-top}" rx="3"/>`;
    for(let y=top+7;y<bottom-4;y+=9)s+=`<path class="roller" d="M${x-width/2+4} ${y}h${width-8}"/>`;
    return s;
}
function arm(x,y,small=false){
    return `<g class="robot-arm" data-keep-upright="image" data-upright-cx="0" data-upright-cy="-18" transform="translate(${x} ${y}) scale(${small?.72:1})"><rect x="-22" y="-11" width="44" height="29" rx="6"/><circle r="11"/><path d="M0 0l-21 -23 30 -25 20 16"/><circle cx="-21" cy="-23" r="6"/><circle cx="9" cy="-48" r="5"/><path d="M24 -36l9 11m-4 -15l9 11"/></g>`;
}
function endpoint(cell,lineNumber,direction,x,y){
    const label=cell.id==='wrapper'?'WRAP-IN':`R${cell.id.slice(1)}-${lineNumber}`;
    const id=cell.id==='wrapper'?'wrap-in':`${cell.id}-${lineNumber}-${direction.toLowerCase()}`;
    endpoints.push({id,label:cell.id==='wrapper'?label:`${label} · ${direction}`,point:label,direction,kind:'arrow',cell:cell.id,cellName:cell.name,x,y,binding:null});
    // IN always points toward the machine; OUT toward the aisle.
    const arrow=direction==='IN'?'M-6 -12H6V0H13L0 14 -13 0H-6Z':'M-6 12H6V0H13L0 -14 -13 0H-6Z';
    return `<g id="endpoint-${id}" class="endpoint" data-endpoint="${id}" tabindex="0" role="button" aria-label="${label} ${direction}" aria-pressed="false" transform="translate(${x} ${y})"><title>${label} ${direction}</title><rect class="endpoint-hit" x="-23" y="-18" width="46" height="47" rx="7"/><path class="arrow-lamp" d="${arrow}"/><text class="direction" x="0" y="26">${direction}</text><rect class="selection-mark" x="-23" y="-18" width="46" height="47" rx="7"/></g>`;
}
function occupancyDrawing(id,x,y){
    const drawing=fullPalletGraphic().replace('<svg ','<svg width="36" height="44" ');
    return `<g class="outfeed-occupancy" data-keep-upright="image" data-upright-cx="18" data-upright-cy="22" data-pallet-for="${id}" data-present="unknown" data-quality="unknown" tabindex="-1" role="button" aria-label="Παρουσία παλέτας: χωρίς δεδομένα" transform="translate(${x-18} ${y})"><title>Occupied · χωρίς δεδομένα</title><g class="full-load">${drawing}</g><g class="occupancy-marker"><circle cx="18" cy="19" r="6.5" fill="#303b44" stroke="#bcc9d2"/><text x="18" y="22.5" fill="#dce5eb" text-anchor="middle" font-size="10" font-weight="600">?</text></g></g>`;
}
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" id="melissa-plant-layout" viewBox="0 0 1600 560" role="group" aria-labelledby="plant-title plant-description"><title id="plant-title">Melissa - σχηματική διάταξη κυψελών και endpoints AGV</title><desc id="plant-description">Σχηματική κάτοψη. Από αριστερά Robot 6, Robot 1, Robot 4, Robot 2, Robot 3, Robot 5, και δεξιά το Τυλιχτικό. Κάθε βέλος είναι ξεχωριστό επιλέξιμο endpoint. Δεν έχουν συνδεθεί σήματα PLC.</desc><defs><filter id="arrow-light" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="2" result="glow"/><feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><style>
#melissa-plant-layout{background:#282d31;font-family:'Segoe UI',Arial,sans-serif;color:#e6e6e6}.plant-wall{fill:none;stroke:#7c8993;stroke-width:2}.machine-line{fill:none;stroke:#9eaab3;stroke-width:2}.conveyor{fill:#30363c;stroke:#b2bbc2;stroke-width:1.3}.roller{stroke:#87949e;stroke-width:1}.robot-arm{fill:#424b53;stroke:#c1c9cf;stroke-width:2}.robot-arm path{fill:none;stroke-width:9;stroke-linecap:round;stroke-linejoin:round}.robot-arm circle{fill:#30363c;stroke-width:2}.pallet{fill:none;stroke:#7a8791;stroke-width:1}.pallet-detail{fill:none;stroke:#65727c;stroke-width:1}.zone-label{fill:#9daab4;font-size:11px;letter-spacing:2px}.point-label{fill:#d0d2d4;font-size:12px;font-weight:600;text-anchor:middle}.cell-name{fill:#e1e3e4;font-size:16px;font-weight:600;text-anchor:middle}.cell-type{fill:#aab5be;font-size:10px;letter-spacing:1px;text-anchor:middle}.cell-tag{fill:none;stroke:#626d76;stroke-width:1}.cell-nav{cursor:pointer}.cell-nav:hover .cell-tag,.cell-nav:focus .cell-tag{stroke:#e7e7e7;stroke-width:1.5}.cell-nav:focus{outline:none}.endpoint{cursor:pointer;outline:none}.endpoint-hit{fill:#353c42;stroke:#626d76;stroke-width:1}.arrow-lamp{fill:#424b53;stroke:#bac4cc;stroke-width:1.3;stroke-linejoin:round}.direction{fill:#b1bdc6;font-size:9px;text-anchor:middle;letter-spacing:.5px}.selection-mark{fill:none;stroke:#f5f5f5;stroke-width:1.7;opacity:0;pointer-events:none}.endpoint:hover .endpoint-hit{stroke:#b5bbbf}.endpoint.is-selected .selection-mark,.endpoint:focus .selection-mark{opacity:1}.endpoint.is-lit .arrow-lamp{fill:#f8f8f8;stroke:#fff;filter:url(#arrow-light)}.endpoint.is-lit .direction{fill:#fff}.equipment-name{fill:#aab5be;font-size:10px;text-anchor:middle}.schematic-note{fill:#95a3ad;font-size:10px}
</style><style>.entity-button{cursor:pointer;outline:none}.entity-button .entity-surface{fill:#30363c;stroke:#66727b;stroke-width:1}.entity-button:hover .entity-surface,.entity-button:focus .entity-surface{fill:#3b444b;stroke:#e3e7e9;stroke-width:1.5}.entity-status circle{fill:#353d44;stroke:#afb9c0;stroke-width:1.2}.entity-status path{fill:none;stroke:#c6cdd2;stroke-width:1.3}.entity-nav-hint{fill:#acb7bf;font-size:13px}.palomat-name{fill:#d7dde1;font-size:10px;font-weight:600}.cell-tag{fill:#30363c}.cell-nav:hover .cell-tag,.cell-nav:focus .cell-tag{fill:#3b444b}</style><rect width="1600" height="560" fill="#282d31" rx="10"/><path class="plant-wall" d="M30 520V151 M30 105V32H1570"/><path class="plant-wall" d="M30 105h-13q0 46 13 46"/><g class="entity-button buffer-nav" data-keep-upright="control" data-upright-cx="624" data-upright-cy="106.5" data-open-page="buffer" tabindex="0" role="link" aria-label="Άνοιγμα αναθέσεων στα AGV"><title>Αναθέσεις στα AGV</title><rect class="entity-surface" x="384" y="43" width="480" height="127" rx="8"/><text x="405" y="65" fill="#e0e8ed" font-size="13" font-weight="600">Αναθέσεις στα AGV</text>${statusIcon('agv-assignments',833,61)}<text class="entity-nav-hint" x="848" y="65">↗</text>`);
for(let p=0;p<5;p++){
    const x=404+p*43;
    parts.push(`<g class="assignment-pallet-symbol">${fullPalletGraphic().replace('<svg ',`<svg x="${x}" y="86" width="37" height="46" `)}</g>`);
}
parts.push(`<path d="M634 117h61m-10 -7 10 7 -10 7" fill="none" stroke="#92a9ba" stroke-width="1.8"/><text x="645" y="143" fill="#a7bdcc" font-size="9.5">AGV</text><g class="assignment-agv-symbol">${agvGraphic().replace('<svg ','<svg x="720" y="49" width="110" height="115" ')}</g><text x="405" y="156" fill="#b4c2cc" font-size="10">Σε αναμονή παράδοσης στο Τυλιχτικό</text>`);
parts.push('</g>');
parts.push(`<style>.outfeed-occupancy{cursor:pointer;outline:none}.outfeed-occupancy .full-load{display:none}.outfeed-occupancy[data-present="true"] .full-load{display:inline}.outfeed-occupancy .occupancy-marker{display:none}.outfeed-occupancy:not([data-quality="good"]) .occupancy-marker{display:inline}.outfeed-occupancy[data-quality="stale"] .full-load,.outfeed-occupancy[data-quality="bad"] .full-load{opacity:.35}.outfeed-occupancy[data-quality="unknown"] .full-load{display:none}.outfeed-occupancy:focus .full-load{filter:brightness(1.15)}.semolina-heading{cursor:pointer}.semolina-heading:hover text{text-decoration:underline}.pickup-control{cursor:pointer;outline:none}.pickup-control rect{fill:#475660;stroke:#abbac5;stroke-width:.9}.pickup-control text{fill:#edf2f5;font-size:10px;font-weight:600;text-anchor:middle}.pickup-control[aria-disabled="true"]{opacity:.4;cursor:not-allowed}.pickup-control[aria-disabled="false"]:hover rect,.pickup-control[aria-disabled="false"]:focus rect{fill:#617482;stroke:#fff}.semolina-status{fill:#b0bec8;font-size:8px;text-anchor:middle}</style>`);
endpoints.push({id:'semolina-out',label:'SEMOLINA · OUT',point:'SEMOLINA',direction:'OUT',kind:'arrow',cell:'semolina',cellName:'SEMOLINA (Σιμιγδάλι)',x:184,y:101,flow:'to-agv',binding:null});
parts.push(`<g class="semolina-station" data-keep-upright="control" data-upright-cx="153" data-upright-cy="103.5" data-station="semolina"><rect x="48" y="43" width="210" height="121" rx="8" fill="#30363c" stroke="#74818b"/><g class="semolina-heading" data-open-page="semolina" tabindex="0" role="link" aria-label="Άνοιγμα SEMOLINA"><rect x="57" y="48" width="173" height="32" rx="5" fill="transparent"/><text x="63" y="62" fill="#e4e9ed" font-size="12" font-weight="650" letter-spacing="1">SEMOLINA</text><text x="63" y="76" fill="#b1bec8" font-size="9.5">Σιμιγδάλι</text><text x="219" y="64" class="entity-nav-hint">↗</text></g>${statusIcon('semolina',242,59)}<g data-open-page="semolina" tabindex="0" role="link" aria-label="Παλετοθέση SEMOLINA"><path d="M65 113l36 -23 53 11 -35 25Z" fill="#273139" stroke="#a2b1bc" stroke-width="1.2" stroke-dasharray="4 3"/><path d="M65 113v6l54 12 35 -24v-6" fill="none" stroke="#71828f" stroke-width="1"/></g>${occupancyDrawing('semolina-out',111,85)}<g class="endpoint" id="endpoint-semolina-out" data-endpoint="semolina-out" tabindex="0" role="button" aria-label="SEMOLINA OUT προς AGV" aria-pressed="false" transform="translate(184 101)"><title>SEMOLINA · OUT προς AGV</title><rect class="endpoint-hit" x="-19" y="-18" width="42" height="47" rx="7"/><path class="arrow-lamp" d="M-6 12H6V0H13L0 -14 -13 0H-6Z" transform="rotate(90)"/><text class="direction" y="26">OUT</text><rect class="selection-mark" x="-19" y="-18" width="42" height="47" rx="7"/></g><text x="214" y="105" fill="#d0dbe2" font-size="10" font-weight="600">AGV</text><g class="pickup-control" data-pickup-station="semolina" tabindex="0" role="button" aria-disabled="true" aria-label="Αίτημα παραλαβής SEMOLINA"><title>Αίτημα παραλαβής · χειρισμός μη διαθέσιμος</title><rect x="62" y="137" width="182" height="21" rx="5"/><text x="153" y="151" data-pickup-label="">Αίτημα παραλαβής</text></g></g>`);
for(const [column,{number:n,type}] of palomats.entries()){
    const x=990+column*110,p=palletTypes[type];
    const drawing=palomatGraphic(type).replace('<svg ','<svg class="palomat-art" x="17" y="23" width="70" height="91" ');
    parts.push(`<g class="entity-button palomat-nav" data-keep-upright="control" data-upright-cx="52" data-upright-cy="64" data-open-page="palomats" data-open-selection="${n}" data-pallet-family="${type}" tabindex="0" role="button" aria-haspopup="dialog" aria-label="Άνοιγμα Palomat ${n} · ${p.name}" transform="translate(${x} 42)"><title>Palomat ${n} · ${p.name} · Άνοιγμα οθόνης</title><rect class="entity-surface" width="104" height="128" rx="8"/><text class="palomat-name" x="10" y="19" style="font-size:11px">Palomat ${n}</text>${statusIcon('palomat-'+n,91,15.5)}${drawing}<text class="palomat-type" x="49" y="120" fill="#b9c5cd" text-anchor="middle" font-size="8.5" font-weight="600" letter-spacing=".5">${p.label}</text><text class="entity-nav-hint" x="88" y="121">↗</text></g>`);
}
parts.push(`<text class="zone-label" x="40" y="176.5">ΣΗΜΕΙΑ AGV</text><path d="M40 184H1545" stroke="#515c65" stroke-dasharray="3 7"/>`);
for(const cell of cells){
    parts.push(`<g class="cell-equipment" data-cell="${cell.id}">`);
    for(let i=0;i<cell.centres.length;i++){
        const x=cell.centres[i],number=cell.lines[i],dirs=cell.directions?.[i]||['OUT','IN'];
        const y=cell.id==='r6'?232:cell.id==='wrapper'?226:232;
        const label=cell.id==='wrapper'?'WRAP-IN':`R${cell.id.slice(1)}-${number}`;
        parts.push(`<text class="point-label" x="${x}" y="${cell.id==='r6'?201:cell.id==='wrapper'?199:205}">${label}</text>`);
        for(let d=0;d<dirs.length;d++)parts.push(endpoint(cell,number,dirs[d],x,y+d*51));
        parts.push(conveyor(x,cell.top,cell.bottom,cell.id==='r6'?33:31));
        if(dirs.includes('OUT')){
            const id=`${cell.id}-${number}-out`,expected=`R${cell.id.slice(1)}${number}OUT`;
            const stations=manifest.stations.filter(s=>s.direction==='OUT'&&s.name.replace(/-/g,'')===expected);
            if(stations.length!==1)throw new Error('Ambiguous occupied station for '+id);
            const station=stations[0],tag=manifest.tags.find(t=>t.path===station.name+'.Occupied');
            if(!tag||tag.db!==100||tag.byte!==station.byte||tag.bit!==1)throw new Error('Unverified Occupied mapping for '+id);
            outfeeds.push({id,station:station.name,cell:cell.id,x,y:cell.top-2,occupiedBinding:{path:tag.path,tagId:tag.id,db:tag.db,byte:tag.byte,bit:tag.bit,access:'read',verification:'offline-manifest-only'}});
            parts.push(occupancyDrawing(id,x,cell.top-2));
        }
    }
    if(cell.id==='r6'){
        parts.push(`<path class="machine-line" d="M68 463H238V486H68Z"/>`);parts.push(arm(153,490,true));
    }else if(cell.id==='r1'){
        parts.push(`<path class="machine-line" d="M295 433H558M368 458V484H484V458"/>`);parts.push(arm(426,477,true));
    }else if(cell.id==='r4'){
        parts.push(`<rect class="conveyor" x="603" y="415" width="29" height="28" rx="3"/>`);parts.push(arm(610,454,true));
    }else if(cell.id==='wrapper'){
        parts.push(`<rect class="conveyor" x="1437" y="330" width="56" height="64" rx="8"/><circle class="machine-line" cx="1465" cy="362" r="20"/><path d="M1465 458v2a35 35 0 0 0 70 0v-30" fill="none" stroke="#a1adb6" stroke-width="22"/><path d="M1465 458v2a35 35 0 0 0 70 0v-30" fill="none" stroke="#343b41" stroke-width="17"/>`);
        endpoints.push({id:'eidos-menu',label:'Barcode',point:'Barcode',direction:null,kind:'menu',target:'eidos',cell:'eidos',cellName:'Τυλιχτικό',x:1465,y:427,binding:null});
        parts.push(`<g id="endpoint-eidos-menu" class="endpoint menu-endpoint" data-endpoint="eidos-menu" tabindex="0" role="button" aria-label="Άνοιγμα μενού Barcode" aria-haspopup="dialog" aria-pressed="false"><title>Άνοιγμα μενού Barcode</title><rect class="menu-hit" x="1337" y="406" width="162" height="42" rx="9" fill="#353c42" stroke="#626d76"/><g class="barcode-label-icon" data-keep-upright="image" data-upright-cx="0" data-upright-cy="0" transform="translate(1351 427)">${barcodeGraphic().replace('<svg ','<svg x="-10.5" y="-12.5" width="21" height="25" ')}</g>${statusIcon('eidos',1490,413)}<text x="1370" y="432" class="point-label" style="text-anchor:start;font-size:14.5px">Barcode</text><path d="M1434 427h16" class="machine-line"/><circle class="menu-point" cx="1465" cy="427" r="12" fill="#424b53" stroke="#b0b8bd" stroke-width="1.7"/><circle cx="1465" cy="427" r="3.5" fill="#d0d2d4"/><rect class="selection-mark" x="1337" y="406" width="162" height="42" rx="9"/></g>`);
    }else{
        const mid=cell.centres[1];parts.push(`<path class="machine-line" d="M${cell.centres[0]-15} 389H${cell.centres[2]+15}"/>`);parts.push(arm(mid,466,true));
    }
    const mid=(cell.left+cell.right)/2,width=cell.id==='r4'?102:cell.id==='wrapper'?132:cell.right-cell.left;
    const tagY=cell.id==='wrapper'?532:518;
    parts.push(`<g class="cell-nav" data-keep-upright="control" data-upright-cx="0" data-upright-cy="6.5" data-open-page="${cell.id}" tabindex="0" role="link" aria-label="Άνοιγμα ${cell.name}" transform="translate(${mid} ${tagY})"><rect class="cell-tag" x="${-width/2}" y="-15" width="${width}" height="43" rx="7"/><text class="cell-name" x="-10" y="11">${cell.name}</text>${statusIcon(cell.id,width/2-15,6)}</g></g>`);
}
parts.push('<style>'+fs.readFileSync(path.join(__dirname,'layout-light.css'),'utf8')+fs.readFileSync(path.join(__dirname,'layout-type.css'),'utf8')+'</style></svg>');
const svg=parts.join('');
const model={version:'0.3.2',width:1600,height:560,targetScreen:{width:1920,height:1080},source:'Factory layout PDF supplied 2026-11-22',wrapperConfirmed:true,signalBindings:{occupied:'read-only-offline-mapped',requestArrows:false,semolina:false},plcValidation:false,futureCommand:'AGVRequest',cells:cells.map(({id,name})=>({id,name})),logistics:{definitionSource:'user-confirmed',assignments:{page:'buffer',label:'Αναθέσεις στα AGV',sourceDB:'AGVBuffer_DB',meaning:'handed-to-agv-awaiting-wrapper-delivery'},deliveries:{page:'deliveries',label:'Ιστορικό παραδόσεων AGV',completionTarget:'wrapper',meaning:'every-pallet-delivered-to-wrapper',eventBinding:null},illustration:{palletCount:5,agvCount:1,indicative:true}},outfeeds,manualStations:[{id:'semolina',name:'SEMOLINA',description:'Σιμιγδάλι',endpoint:'semolina-out',direction:'OUT',target:'AGV',requestSources:['physical-button','hmi-button'],sapDataBinding:null,occupiedBinding:null,requestBinding:null,commandBinding:null}],palomats:palomats.map(({number,type},column)=>({number,column,palletFamily:type,palletName:palletTypes[type].name,graphic:'graphics/palomats/palomat-'+palletTypes[type].id+'.svg',plcPalletType:null})),entities,endpoints};
for(const directory of [path.join(publicDir,'graphics/palomats'),path.join(output,'palomats')]){
    fs.mkdirSync(directory,{recursive:true});
    for(const [type,info] of Object.entries(palletTypes))fs.writeFileSync(path.join(directory,'palomat-'+info.id+'.svg'),palomatGraphic(type));
}
fs.writeFileSync(path.join(publicDir,'factory-layout.svg'),svg);
fs.writeFileSync(path.join(publicDir,'layout-data.json'),JSON.stringify(model,null,2));
fs.writeFileSync(path.join(output,'Melissa_Layout.svg'),svg);
fs.writeFileSync(path.join(output,'layout-data.json'),JSON.stringify(model,null,2));
fs.writeFileSync(path.join(publicDir,'graphics/full-pallet.svg'),fullPalletGraphic());
fs.writeFileSync(path.join(output,'Full_Pallet.svg'),fullPalletGraphic());
fs.writeFileSync(path.join(publicDir,'graphics/barcode-label.svg'),barcodeGraphic());
fs.writeFileSync(path.join(output,'Barcode_Label.svg'),barcodeGraphic());
fs.writeFileSync(path.join(publicDir,'graphics/agv.svg'),agvGraphic());
fs.writeFileSync(path.join(output,'AGV.svg'),agvGraphic());
console.log(`Generated drawing: ${endpoints.length} endpoints, ${outfeeds.length} read-only Occupied display mappings. SEMOLINA commands unbound; no PLC writes.`);
