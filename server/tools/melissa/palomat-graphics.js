'use strict';
// Vector tracing follows the proportions and visible panels in the supplied photograph.
// Coordinates refer to a cropped photograph, not mechanical dimensions.
// Names identify visual pallet families only; no PLC PalletType values are assigned.
const palletTypes={
    EUR_STD:{id:'eur-std',label:'EUR STD',name:'EUR pallet STD',deck:'#efc88d',front:'#dda65f',block:'#bf8646',edge:'#ffe1aa',side:'#88592c',shadow:'#33271b',width:95},
    EUR_BLUE:{id:'eur-blue',label:'EUR BLUE',name:'EUR pallet Blue',deck:'#258cff',front:'#0066e6',block:'#004cb0',edge:'#77bbff',side:'#003376',shadow:'#071a30',width:95},
    INDU:{id:'indu',label:'INDU',name:'INDU pallet',deck:'#e8b874',front:'#d39850',block:'#b67b39',edge:'#ffdaa0',side:'#7d4e24',shadow:'#302418',width:105}
};
const assignments=[
    {number:5,type:'INDU'},
    {number:4,type:'EUR_STD'},
    {number:3,type:'EUR_STD'},
    {number:2,type:'EUR_BLUE'},
    {number:1,type:'EUR_BLUE'}
];
function pallet(type,row){
    const p=palletTypes[type],x=type==='INDU'?65:71,w=p.width;
    const y=104+row*25.8,slope=-11+row*1.65;
    const at=(offset,height)=>`${(x+offset).toFixed(2)} ${(y+slope*offset/w+height).toFixed(2)}`;
    let svg='<g class="palomat-pallet">';
    // Two large fork openings between three timber blocks, not shelves or trays.
    svg+=`<path d="M${at(0,3)}L${at(w,3)}L${at(w,21)}L${at(0,21)}Z" fill="${p.shadow}"/>`;
    svg+=`<path d="M${at(0,0)}L${at(w,0)}l8 -7L${at(8,-7)}Z" fill="${p.deck}" stroke="${p.edge}" stroke-width=".65"/>`;
    for(let b=1;b<(type==='INDU'?5:4);b++){
        const offset=b*w/(type==='INDU'?5:4);
        svg+=`<path d="M${at(offset,0)}l8 -7" fill="none" stroke="${p.block}" stroke-width="1"/>`;
    }
    for(const [offset,width] of [[0,10],[w*.40,18],[w-11,11]]){
        svg+=`<path d="M${at(offset,4)}L${at(offset+width,4)}L${at(offset+width,20)}L${at(offset,20)}Z" fill="${p.block}" stroke="${p.front}" stroke-width=".7"/>`;
        svg+=`<path d="M${at(offset+width,4)}l7 -4v15L${at(offset+width,20)}Z" fill="${p.side}"/>`;
        svg+=`<path d="M${at(offset+2,7)}l1 8m3 -6 .5 7" stroke="${p.front}" stroke-width=".65" opacity=".65"/>`;
    }
    svg+=`<path d="M${at(0,0)}L${at(w,0)}L${at(w,4)}L${at(0,4)}Z" fill="${p.front}" stroke="${p.edge}" stroke-width=".7"/>`;
    svg+=`<path d="M${at(0,20)}L${at(w,20)}L${at(w,23.5)}L${at(0,23.5)}Z" fill="${p.front}" stroke="${p.edge}" stroke-width=".65"/>`;
    svg+=`<path d="M${at(3,2)}L${at(w-4,2)}M${at(6,22)}L${at(w-3,22)}" stroke="${p.deck}" opacity=".7" stroke-width=".6"/>`;
    return svg+'</g>';
}
function artwork(type){
    if(!palletTypes[type])throw new Error('Unknown Palomat graphic: '+type);
    let svg='<g stroke-linejoin="round" stroke-linecap="round">';
    // Rear inner wall and tall left cover follow the reference photograph.
    svg+='<path d="M56 43L174 65V552L56 531Z" fill="#7f1b17" stroke="#ba473c" stroke-width="1.1"/><path d="M31 44L56 43V531L31 529Z" fill="#c22d23" stroke="#e96050" stroke-width="1.2"/><path d="M56 43L174 65V73L56 49Z" fill="#9e241d"/><path d="M31 166H56M31 293H56" stroke="#881e19" stroke-width="1.4"/>';
    // Fixed illustrative stack; it is not a live quantity or mechanical dimension.
    for(let row=0;row<14;row++)svg+=pallet(type,row);
    // Left lifting column: wide lower housing, rounded sensor and vertical apertures.
    svg+='<path d="M13 307L25 293H56V531L20 533L13 530Z" fill="#d33528" stroke="#f16d5b" stroke-width="1.3"/><path d="M13 307L24 302V532L13 530Z" fill="#a1221b"/><path d="M24 301L56 299V530L24 532Z" fill="#d7392b"/><path d="M14 461L56 463M14 463L56 465" stroke="#7c1a16" stroke-width="1.3"/>';
    for(let y=357;y<=450;y+=3.8)svg+=`<ellipse cx="43" cy="${y}" rx="2" ry="1.25" fill="#1e2b34"/>`;
    for(let y=468;y<=510;y+=4.4)svg+=`<ellipse cx="43" cy="${y}" rx="1.7" ry="1.5" fill="#25343e"/>`;
    svg+='<path d="M38 451Q51 454 65 451V460Q52 464 38 460Z" fill="#c3cdd3" stroke="#edf1f3" stroke-width=".8"/><path d="M35 461V465H59" fill="none" stroke="#2c3d49" stroke-width="2"/><path d="M49 515v5m0 5v5" stroke="#263945" stroke-width="2.2"/>';
    // Broad right upper guard, two stacked panels and the narrow rear return.
    svg+='<path d="M170 14L341 52V294H170Z" fill="#c82b20" stroke="#ef6e5d" stroke-width="1.3"/><path d="M170 14L177 15V293H170Z" fill="#e44432"/><path d="M177 18L336 54V174L177 157Z" fill="#be281e"/><path d="M177 160L336 176V291H177Z" fill="#c52c21"/><path d="M341 52L346 55V295L337 294V54Z" fill="#981c17" stroke="#c4483c" stroke-width="1"/><path d="M170 156L341 174M170 159L341 176" stroke="#931e18" stroke-width="1.4"/><path d="M337 179V289" stroke="#7e1916" stroke-width="1.4" stroke-dasharray="6 4"/>';
    // Short upper guide hardware, exactly where it is visible in the photograph.
    svg+='<path d="M334 55L341 57V109L334 107Z" fill="#c0cbd2" stroke="#495e6c" stroke-width="1"/><path d="M337 63V101" stroke="#405866" stroke-width="1.6" stroke-dasharray="9 3"/><ellipse cx="339" cy="56" rx="6" ry="3" fill="#687d8b" stroke="#becbd3" stroke-width="1.1"/><path d="M335 56q5 -4 9 0" fill="none" stroke="#273e4d" stroke-width="1.2"/>';
    // The lower cabinet is almost twice the visible stack width in the source.
    svg+='<path d="M166 294L353 295V461L166 489Z" fill="#ba473c" stroke="#f37b69" stroke-width="1.3"/><path d="M166 294L180 295V486L166 489Z" fill="#e9523c"/><path d="M180 315L353 315V461L180 486Z" fill="#d73325"/><path d="M166 294L353 295L350 313L180 313Z" fill="#e44832"/><path d="M353 295L357 303V462L353 461Z" fill="#a5241b"/>';
    // Large open floor bay remains to the left of this cabinet and its foot panel.
    svg+='<path d="M166 489L353 461L368 465V535L185 575L166 569Z" fill="#c72d21" stroke="#ed6a58" stroke-width="1.3"/><path d="M185 487L353 463V535L185 572Z" fill="#d63526"/><path d="M353 463L368 465V535L353 539Z" fill="#971d17"/><path d="M184 488V573M166 489L353 461" stroke="#8c1e18" stroke-width="1.6"/>';
    // Recessed handles, sloped control panels and emergency stop button.
    svg+='<path d="M222 343q7 -4 15 -1v16q-7 4 -15 1Z" fill="#253642" stroke="#455e6e" stroke-width="1.3"/><path d="M310 339q7 -3 14 -1v16q-7 3 -14 1Z" fill="#243642" stroke="#455e6e" stroke-width="1.3"/><path d="M225 347l9 -1v8l-9 1Zm88 -4 8 -1v8l-8 1Z" fill="#1c2b35"/><path d="M184 298L204 299L212 312L191 310Z" fill="#b6c1c8" stroke="#e0e6ea" stroke-width="1.1"/><path d="M190 301l11 .5 4 7 -12 -1Z" fill="#5a7182"/><path d="M192 303h10m-8 3h10M196 302l3 6" stroke="#b5c4ce" stroke-width=".6"/><ellipse cx="181" cy="301" rx="5" ry="2.5" fill="#c5cdd2"/><ellipse cx="183" cy="297" rx="3.3" ry="2.5" fill="#e2e6e9"/><path d="M339 299h10l7 10 -11 -1Z" fill="#b6c1c8" stroke="#d1dbe1" stroke-width=".7"/>';
    // Maker plates and warning symbols are kept in neutral tones for this HMI.
    svg+='<path d="M227 90L261 98V113L227 105Z" fill="#c5ced3"/><text x="230" y="101" font-family="Arial,sans-serif" font-size="7.1" font-weight="700" fill="#344d5d" transform="rotate(12 230 101)">PALOMAT</text><path d="M254 365L289 363V380L254 382Z" fill="#c7d1d7"/><text x="257" y="376" font-family="Arial,sans-serif" font-size="7" font-weight="700" fill="#344c5c" transform="rotate(-3 257 376)">PALOMAT</text><path d="M40 340l9 14H32Z" fill="#b8c5cd" stroke="#3d5464" stroke-width="1"/><path d="M40 345v5m-3 -2h6" stroke="#3b5363" stroke-width="1.3"/><path d="M228 365l8 22h-16Z" fill="#c3cdd4" stroke="#3d5565" stroke-width=".9"/><path d="M228 370l-2 7h4l-3 6" fill="none" stroke="#3a5364" stroke-width="1.1"/>';
    for(const [x,y] of [[175,17],[259,35],[338,53],[176,155],[176,291],[338,291],[184,318],[276,318],[350,319],[175,479],[205,501],[205,548],[349,520],[336,296]])svg+=`<circle cx="${x}" cy="${y}" r="1.1" fill="#d2dbe1" stroke="#536b7c" stroke-width=".5"/>`;
    return svg+'</g>';
}
function graphic(type){return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 385 590" role="img" aria-label="Palomat · ${palletTypes[type].name}"><title>Palomat · ${palletTypes[type].name}</title>${artwork(type)}</svg>`;}
module.exports={palletTypes,assignments,graphic};
