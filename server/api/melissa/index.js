'use strict';
const express = require('express');
const path = require('path');
const auth = require('../jwt-helper');

function create(runtime, authenticate, verifyGroups) {
    const router = express.Router();
    // UI assets contain no live data. API access uses the existing FUXA authentication.
    router.use('/melissa',express.static(path.join(__dirname,'public')));
    router.use('/api/melissa',authenticate,(req,res,next) => {
        if (!runtime.melissa) return res.status(503).json({error:'Melissa is not enabled in settings'});
        if (runtime.settings.secureEnabled && !auth.haveAdminPermission(verifyGroups(req))) {
            return res.status(403).json({error:'Melissa diagnostics require the FUXA administrator role'});
        }
        next();
    });
    router.get('/api/melissa/snapshot',(req,res) => { res.set('Cache-Control','no-store');res.json(runtime.melissa.snapshot()); });
    router.get('/api/melissa/events',async (req,res,next) => {
        try { res.json(await runtime.melissa.history(req.query.before,req.query.limit)); }
        catch(error) { next(error); }
    });
    router.get('/api/melissa/deliveries',async (req,res,next) => {
        try { res.json({sourceConfigured:false,entries:await runtime.melissa.deliveryHistory()}); }
        catch(error) { next(error); }
    });
    return router;
}
module.exports={ create };
