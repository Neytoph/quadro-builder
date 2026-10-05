// Run from Builder root: node src/engine/assemblyNativeEnvelopes.generate.mjs [--check]
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const nativeEnvelopes={},sourceHashes={},surfaceTriangles={},connectorTriangles={},connectorMasks={}, accessoryTriangles={};
for(const file of ['slides','fittings','surfaces','connectors','tubes']){
  const path=`public/data/models/${file}.json`,text=fs.readFileSync(path,'utf8');
  sourceHashes[path]=createHash('sha256').update(text).digest('hex');
  const finePath=`public/data/models/${file}-fine.json`,fineText=fs.readFileSync(finePath,'utf8');
  sourceHashes[finePath]=createHash('sha256').update(fineText).digest('hex');
  // Match meshes.loadLevel(..., true): fine records replace coarse records;
  // models with no fine counterpart (e.g. roof and panels) retain their source.
  for(const [kind,mesh] of Object.entries({...JSON.parse(text),...JSON.parse(fineText)})){
    if(file==='connectors'){connectorMasks[kind]=mesh.mask;connectorTriangles[kind]=Array.from({length:mesh.idx.length/3},(_,i)=>mesh.idx.slice(i*3,i*3+3).map(index=>mesh.pos.slice(index*3,index*3+3).map(value=>value/100)));}
    if((file==='slides' && ['roof2','slide2','slide-end2'].includes(kind)) || (file==='fittings' && ['connector45_2','floating-wheel2','multi-wheel2','bearing2','adapter2','hub-cap2','bearing-connector4','steering-lock2','clamp2','clip2','pool2','pool-small2'].includes(kind)) || (file==='tubes' && kind==='round-tube2'))accessoryTriangles[kind]=Array.from({length:mesh.idx.length/3},(_,i)=>mesh.idx.slice(i*3,i*3+3).map(index=>mesh.pos.slice(index*3,index*3+3).map(value=>value/100)));
    if(file==='surfaces')surfaceTriangles[kind]=Array.from({length:mesh.idx.length/3},(_,i)=>mesh.idx.slice(i*3,i*3+3).map(index=>mesh.pos.slice(index*3,index*3+3).map(value=>value/100)));
    const bins=new Map();
    for(let i=0;i<mesh.idx.length;i+=3){
      const triangle=mesh.idx.slice(i,i+3).map(index=>mesh.pos.slice(index*3,index*3+3).map(value=>value/100));
      const centroid=[0,1,2].map(axis=>triangle.reduce((sum,point)=>sum+point[axis],0)/3);
      const key=centroid.map(value=>Math.floor(value/8)).join(',');
      const bounds=bins.get(key)||[0,1,2].map(()=>[Infinity,-Infinity]);
      for(const point of triangle)for(let axis=0;axis<3;axis++){
        bounds[axis][0]=Math.min(bounds[axis][0],point[axis]);bounds[axis][1]=Math.max(bounds[axis][1],point[axis]);
      }
      bins.set(key,bounds);
    }
    nativeEnvelopes[kind]=[...bins.values()].map(box=>box.map(([lo,hi])=>[Math.round((lo-.02)*100)/100,Math.round((hi+.02)*100)/100]));
  }
}
const output='// Generated native geometry matching the default high-quality coarse/fine overlay; cm. Triangle bins are conservative broad-phase bounds. Regenerate using assemblyNativeEnvelopes.generate.mjs.\nexport const sourceHashes = '+JSON.stringify(sourceHashes)+';\nexport const nativeEnvelopes = '+JSON.stringify(nativeEnvelopes)+';\nexport const surfaceTriangles = '+JSON.stringify(surfaceTriangles)+';\nexport const connectorTriangles = '+JSON.stringify(connectorTriangles)+';\nexport const connectorMasks = '+JSON.stringify(connectorMasks)+';\nexport const accessoryTriangles = '+JSON.stringify(accessoryTriangles)+';\n';
const target='src/engine/assemblyNativeEnvelopes.js';
if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8')!==output)throw new Error('Native assembly envelopes differ from measured source meshes. Regenerate and review.');}
else fs.writeFileSync(target,output);
