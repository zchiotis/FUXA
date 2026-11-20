'use strict';
const defaults=require('../../server/settings.default');
module.exports={...defaults,uiHost:'127.0.0.1',uiPort:1881,daqEnabled:true,daqTokenizer:24,
    nodeRedEnabled:false,broadcastAll:false,melissa:{enabled:true,staleMs:15000,bindings:{}}};
