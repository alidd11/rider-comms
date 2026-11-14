import test from 'node:test';
import assert from 'node:assert/strict';
import { cropRect } from '../src/imageEdit.ts';
test('square crop centres a landscape source without exceeding dimensions',()=>{
  assert.deepEqual(cropRect(1600,900,'square'),{originX:350,originY:0,width:900,height:900});
});
test('portrait and vertical crops use target aspect ratios',()=>{
  assert.deepEqual(cropRect(1200,1600,'portrait'),{originX:0,originY:50,width:1200,height:1500});
  assert.deepEqual(cropRect(1920,1080,'vertical'),{originX:656,originY:0,width:607,height:1080});
});
test('original preserves dimensions and invalid dimensions are rejected',()=>{
  assert.deepEqual(cropRect(1200,900,'original'),{originX:0,originY:0,width:1200,height:900});
  assert.equal(cropRect(0,100,'portrait'),null);
  assert.equal(cropRect(Number.NaN,100,'portrait'),null);
});
