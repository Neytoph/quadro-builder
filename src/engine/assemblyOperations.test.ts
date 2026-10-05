import {beforeAll,describe,it,expect} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {loadCatalog,buildableTubes,panels,geometry} from './catalog.js';
import {BuildModel} from './model.js';
import {parseQDF} from './qdfimport.js';
import {computeAssemblyPlan,assemblyDetailState} from './assemblyPlan.js';
beforeAll(async()=>{await loadCatalog();});
const files=['qdf/A0016.qdf','qdf/B0012.qdf','qdf/C0005.qdf','qdf/C0013.qdf','qdf/C0156.qdf','qdf/C0179.qdf','assembly-fixtures/s33.json','assembly-fixtures/s36.json'];
const load=(file:string)=>{const m=new BuildModel(),text=readFileSync(file.endsWith('.qdf')?`public/${file}`:`tests/fixtures/assembly/${file.split('/').at(-1)}`,'utf8');m.loadJSON(file.endsWith('.qdf')?parseQDF(text,{tubes:buildableTubes(),panels:panels(),connectorSize:geometry().connectorSize,mergeEps:2}):JSON.parse(text));return m;};
describe('action evidence',()=>{
  it('records and validates every real model before assessing export',()=>{
    const cases=(process.env.ASSEMBLY_CASE?files.filter(file=>process.env.ASSEMBLY_CASE!.split(',').some(name=>file.includes(name))):files).map(file=>{
      const m=load(file),start=Date.now(),p=computeAssemblyPlan(m);
      const record={file,ms:Date.now()-start,canExport:p.canExport,verification:p.verification,ledger:p.ledger,adjustments:p.adjustments,regions:p.regions,interfaces:p.interfaces,configuration:m.assemblyConfig,steps:p.steps,modules:p.frameModules,diagnostics:p.diagnostics.map((d:any)=>({...d,parts:d.partIds.map((id:string)=>({id,node:m.nodes.get(id),tube:m.tubes.get(id),fitting:m.fittings.get(id),panel:m.panels.get(id),slide:m.slides.get(id)}))}))};
      writeFileSync(`../qa/operations-${file.split('/').at(-1)!.replace(/\.(json|qdf)$/,'')}.json`,JSON.stringify(record,null,2));
      console.log(file,record.ms,p.canExport,p.diagnostics.map((d:any)=>d.code).join(','));
      return {file,m,p,record};
    });
    writeFileSync('../qa/operation-evidence.json',JSON.stringify(cases.map(c=>c.record),null,2));
    for(const {file,m,p}of cases){
      const seen=new Set<string>(),completedSteps=new Set<string>(),entities=new Set<string>(),material=new Set<string>();
      for(const step of p.steps){
        for(const dependency of step.dependsOn)expect(completedSteps.has(dependency),`${file}: ${step.id} prerequisite ${dependency}`).toBe(true);
        for(const op of step.operations){
          for(const dependency of op.dependsOn)expect(seen.has(dependency),`${file}: ${op.id}`).toBe(true);
          seen.add(op.id);
          for(const id of op.consumesPartIds){expect(entities.has(id),`${file}: duplicate consume ${id}`).toBe(false);entities.add(id);}
          for(const id of op.consumesMaterialInstanceIds){expect(material.has(id),`${file}: duplicate material ${id}`).toBe(false);material.add(id);}
          expect(op.verification.physical).toBe('unverified');
        }
        for(const group of step.detailGroups){expect(group.materialKeys.length).toBeLessThanOrEqual(6);const state=assemblyDetailState(p,p.steps.indexOf(step),group.id,{action:false});expect(state.focusPartIds.every((id:string)=>group.partIds.includes(id))).toBe(true);}
        completedSteps.add(step.id);
      }
      expect(entities.size,file).toBe([...m.nodes,...m.tubes,...m.panels,...m.textiles,...m.slides,...m.fittings,...m.clamps].length);
      expect(material.size,file).toBe(p.ledger.instances.filter((i:any)=>i.group!=='screws').length);
      expect(p.ledger.conserved,file).toBe(true);
      expect(p.canExport,file).toBe(p.verification.directionChecked&&p.verification.pathChecked&&p.verification.methodChecked&&!p.diagnostics.some((d:any)=>d.severity==='error'));
      if(file.includes('C0179')||file.includes('C0156')){expect(p.canExport,JSON.stringify(p.diagnostics)).toBe(true);expect(p.diagnostics).toEqual([]);}
      if(!p.canExport)expect(p.verification.methodChecked,file).toBe(false);
      if(file.includes('s36'))expect(p.diagnostics.some((d:any)=>d.code==='DUPLICATE_CONNECTOR_PORT')).toBe(true);
      if(file.includes('B0012'))expect(p.diagnostics.some((d:any)=>d.code==='UNRESOLVED_FRAME_CLOSURE'&&d.partIds.length>=12)).toBe(true);
      if(file.includes('A0016')){
        const corners=[...m.nodes.values()].filter((node:any)=>node.c45file);
        expect(corners).toHaveLength(4);
        for(const corner of corners){
          const owning=p.regions.filter((region:any)=>region.ownedNodeIds.includes(corner.id));
          expect(owning).toHaveLength(1);
          expect(owning[0].kind).toBe('ramp');
          const ports=p.interfaces.filter((port:any)=>port.nodeId===corner.id);
          expect(ports).toHaveLength(1);
          const port:any=ports[0],receiver=m.tubes.get(port.supportTubeId)!;
          expect(port.directionBasis).toBe('qdf-file-C45-mouth-and-matching-receiver-axis');
          expect(receiver.arm||receiver.link).toBeFalsy();
          expect([receiver.a,receiver.b]).toContain(port.mateNodeId);
          const receivingNode=m.nodes.get(port.mateNodeId)!;
          expect(Math.hypot(...port.position.map((v:number,i:number)=>v-[receivingNode.x,receivingNode.y,receivingNode.z][i]))).toBeLessThan(.15);
          expect(Math.abs(port.direction.reduce((sum:number,v:number,i:number)=>sum+v*receiver.geom!.dir[i],0))).toBeGreaterThan(.99);
        }
        expect(p.diagnostics.some((d:any)=>d.code==='IN_PLACE_INSERTION_BLOCKED'&&d.partIds.some((id:string)=>['t25','t31'].includes(id)))).toBe(false);
      }

    }
    expect(cases.length).toBeGreaterThan(0);
  },300000);
});
