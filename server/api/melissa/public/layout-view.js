'use strict';
// View transform only. Conveyor geometry rotates; labels and artwork stay upright.
window.MelissaLayoutView={
    rotate(host,rotated){
        const svg=host.querySelector('[data-layout-drawing]>svg');if(!svg)return;
        if(this.root!==svg){
            this.elements=[];
            for(const element of svg.querySelectorAll('[data-keep-upright],text')){
                if(element.parentElement.closest('[data-keep-upright]'))continue;
                const explicit=element.hasAttribute('data-upright-cx'),bounds=explicit?null:element.getBBox();
                if(!explicit&&(!bounds.width||!bounds.height))continue;
                this.elements.push({element,base:element.getAttribute('transform'),
                    cx:explicit?Number(element.dataset.uprightCx):bounds.x+bounds.width/2,
                    cy:explicit?Number(element.dataset.uprightCy):bounds.y+bounds.height/2});
            }
            this.root=svg;
        }
        for(const {element,base,cx,cy} of this.elements){
            if(rotated)element.setAttribute('transform',(base?base+' ':'')+`rotate(180 ${cx} ${cy})`);
            else if(base===null)element.removeAttribute('transform');else element.setAttribute('transform',base);
        }
        host.classList.toggle('layout-rotated',rotated);
    }
};
