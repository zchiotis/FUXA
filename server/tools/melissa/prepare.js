'use strict';
require('./prepare-artwork').prepare().catch(error=>{console.error(error);process.exitCode=1;});
