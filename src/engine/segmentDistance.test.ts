import {describe,expect,it} from 'vitest';
import {segmentDistance} from './segmentDistance.js';

describe('finite segment distance',()=>{
  it.each([
    {name:'parallel',a:[0,0,0],b:[4,0,0],c:[0,3,0],d:[4,3,0],distance:3},
    {name:'skew',a:[0,0,0],b:[4,0,0],c:[2,-2,5],d:[2,2,5],distance:5},
    {name:'crossing',a:[0,0,0],b:[4,0,0],c:[2,-2,0],d:[2,2,0],distance:0},
    {name:'nearest endpoints',a:[0,0,0],b:[1,0,0],c:[3,2,0],d:[3,3,0],distance:Math.sqrt(8)},
    {name:'point on segment',a:[1,2,3],b:[1,2,3],c:[1,2,0],d:[1,2,6],distance:0},
    {name:'two points',a:[0,0,0],b:[0,0,0],c:[1,2,3],d:[1,2,3],distance:Math.sqrt(14)},
  ])('$name preserves distance under endpoint reversal',({a,b,c,d,distance})=>{
    for(const [p,q] of [[a,b],[b,a]])for(const [r,s] of [[c,d],[d,c]]){
      expect(segmentDistance(p,q,r,s)).toBeCloseTo(distance,12);
      expect(segmentDistance(r,s,p,q)).toBeCloseTo(distance,12);
    }
  });
});
