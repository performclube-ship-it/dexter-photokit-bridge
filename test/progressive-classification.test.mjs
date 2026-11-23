import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { classifyLocalPages } from '../src/progressiveClassification.js';

const ids = n => Array.from({length:n},(_,i)=>'local-'+i);
async function* pagesOf(x,size=250) {for(let i=0;i<x.length;i+=size)yield x.slice(i,i+size);}
function mock(transform=x=>x, initial='authorized') {
  const calls=[];
  return {calls, plugin: {
    authorizationStatus: async()=>({status:initial}),
    requestAuthorization: async()=>({status:'authorized'}),
    classifyPilotAssets: async ({assetIds})=>{
      calls.push([...assetIds]);
      return {results:transform(assetIds.map(id=>({id,status:'ready',labels:[{label:'landscape',confidence:0.9}]})))};
    }
  }};
}
const ack=async()=>({acknowledged:true});

test('source and shipped helper/declarations match exactly',()=>{
  assert.equal(fs.readFileSync(new URL('../src/progressiveClassification.js',import.meta.url),'utf8'),
    fs.readFileSync(new URL('../dist/progressiveClassification.js',import.meta.url),'utf8'));
  assert.equal(fs.readFileSync(new URL('../src/progressiveClassification.d.ts',import.meta.url),'utf8'),
    fs.readFileSync(new URL('../dist/progressiveClassification.d.ts',import.meta.url),'utf8'));
});
test('10,005 synthetic assets use 1001 bounded native batches; no Photos writes', async()=>{
  const x=ids(10005),{plugin,calls}=mock(); let acknowledged=0;
  const result=await classifyLocalPages({plugin,assetPages:pagesOf(x),expectedCount:x.length,
    onReviewBatch:async({results})=>{acknowledged+=results.length;return {acknowledged:true}}});
  assert.equal(result.state,'complete');assert.equal(result.processed,10005);
  assert.equal(acknowledged,10005);assert.equal(calls.length,1001);
  assert.equal(calls.at(-1).length,5);assert.ok(calls.every(x=>x.length>0&&x.length<=10));
  assert.equal(typeof plugin.addExistingAssets,'undefined');
});
test('iCloud and unavailable remain retryable without discarding IDs',async()=>{
  const {plugin}=mock(x=>x.map((r,i)=>i===0?{...r,status:'icloud',labels:[]}:i===1?{...r,status:'unavailable',labels:[]}:r));
  const queue=[];
  const r=await classifyLocalPages({plugin,assetPages:pagesOf(ids(11)),expectedCount:11,
    onReviewBatch:async({retryable})=>{queue.push(...retryable);return {acknowledged:true}}});
  assert.equal(r.state,'retry_pending');assert.equal(r.complete,false);
  assert.equal(r.retryableCount,3);
  assert.deepEqual(queue.map(x=>x.reason),['icloud','unavailable','icloud']);
});
test('mismatched, truncated, malformed responses never reach the review callback',async()=>{
  for(const transform of [x=>x.reverse(),x=>x.slice(0,-1),
      x=>x.map(y=>({...y,status:'icloud'})),
      x=>x.map(y=>({...y,labels:[{label:'x',confidence:NaN}]}))]){
    const {plugin}=mock(transform);let reviewed=0;
    await assert.rejects(classifyLocalPages({plugin,assetPages:pagesOf(ids(3)),expectedCount:3,
      onReviewBatch:async()=>{reviewed++;return {acknowledged:true}}}),
      e=>e.code==='INVALID_CLASSIFICATION_RESULT');
    assert.equal(reviewed,0);
  }
});
test('cannot silently truncate selection or classify repeated PHAsset IDs',async()=>{
  const {plugin}=mock();
  await assert.rejects(classifyLocalPages({plugin,assetPages:pagesOf([...ids(4),...ids(4)]),
    expectedCount:8,onReviewBatch:ack}),e=>e.code==='INVALID_ASSET_PAGE');
  await assert.rejects(classifyLocalPages({plugin,assetPages:pagesOf(ids(9)),
    expectedCount:10,onReviewBatch:ack}),e=>e.code==='INCOMPLETE_ASSET_SOURCE');
  await assert.rejects(classifyLocalPages({plugin,assetPages:pagesOf(ids(9)),
    expectedCount:8,onReviewBatch:ack}),e=>e.code==='EXCESS_ASSET_SELECTION');
});
test('explicit acknowledgement is mandatory and cancellation in flight drops unreviewed data',async()=>{
  const {plugin}=mock();
  await assert.rejects(classifyLocalPages({plugin,assetPages:pagesOf(ids(10)),expectedCount:10,
    onReviewBatch:async()=>({acknowledged:false})}),e=>e.code==='REVIEW_NOT_ACKNOWLEDGED');
  let cancelled=false, reviewed=0;
  const {plugin:other}=mock();other.classifyPilotAssets=async({assetIds})=>{
    cancelled=true;return {results:assetIds.map(id=>({id,status:'ready',labels:[]}))};};
  const r=await classifyLocalPages({plugin:other,assetPages:pagesOf(ids(10)),expectedCount:10,
    shouldStop:()=>cancelled,onReviewBatch:async()=>{reviewed++;return {acknowledged:true}}});
  assert.equal(r.state,'stopped');assert.equal(r.processed,0);assert.equal(reviewed,0);
});
test('late cancellation retains acknowledged counts but never claims completion',async()=>{
  const {plugin}=mock();let cancelled=false;
  const r=await classifyLocalPages({plugin,assetPages:pagesOf(ids(10)),expectedCount:10,
    shouldStop:()=>cancelled,
    onReviewBatch:async()=>{cancelled=true;return {acknowledged:true}}});
  assert.equal(r.state,'stopped');assert.equal(r.processed,10);assert.equal(r.complete,false);
});
test('full Photos authorization and 1–10 size gate are required',async()=>{
  const {plugin}=mock(x=>x,'limited');
  await assert.rejects(classifyLocalPages({plugin,assetPages:pagesOf(ids(1)),expectedCount:1,
    onReviewBatch:ack}),e=>e.code==='PHOTOS_FULL_ACCESS_REQUIRED');
  const {plugin:full}=mock();
  await assert.rejects(classifyLocalPages({plugin:full,assetPages:pagesOf(ids(1)),expectedCount:1,
    batchSize:11,onReviewBatch:ack}),e=>e.code==='INVALID_CLASSIFICATION_CONFIGURATION');
});

test('zero selected IDs cannot silently hide a nonempty page source',async()=>{
  const {plugin,calls}=mock();
  const empty=await classifyLocalPages({plugin,assetPages:pagesOf([]),expectedCount:0,
    onReviewBatch:ack});
  assert.equal(empty.state,'complete');
  assert.equal(empty.processed,0);
  await assert.rejects(classifyLocalPages({plugin,assetPages:pagesOf(ids(1)),
    expectedCount:0,onReviewBatch:ack}),e=>e.code==='EXCESS_ASSET_SELECTION');
  assert.deepEqual(calls,[]);
});

test('100 percent is deferred until every source page is validated',async()=>{
  const {plugin}=mock();let exhausted=false;
  async function* source(){yield ids(10);exhausted=true;}
  const notified=[];
  const outcome=await classifyLocalPages({plugin,assetPages:source(),expectedCount:10,
    onReviewBatch:ack,
    onProgress:async p=>notified.push({processed:p.processed,exhausted})});
  assert.equal(outcome.state,'complete');
  assert.deepEqual(notified,[{processed:10,exhausted:true}]);
});

test('unexpected trailing IDs cannot cause false full-progress signals',async()=>{
  const {plugin}=mock();let acknowledged=0;const notified=[];
  await assert.rejects(classifyLocalPages({plugin,assetPages:pagesOf(ids(11),10),
    expectedCount:10,
    onReviewBatch:async()=>{acknowledged++;return {acknowledged:true}},
    onProgress:async p=>notified.push(p.processed)}),
  e=>e.code==='EXCESS_ASSET_SELECTION');
  assert.equal(acknowledged,1); // Earlier acknowledged review remains durable.
  assert.deepEqual(notified,[]); // No false 100% before the source ends.
});

test('late cancellation never publishes the final count',async()=>{
  const {plugin}=mock();let cancelled=false;const notices=[];
  const r=await classifyLocalPages({plugin,assetPages:pagesOf(ids(10)),
    expectedCount:10,shouldStop:()=>cancelled,
    onReviewBatch:async()=>{cancelled=true;return {acknowledged:true}},
    onProgress:p=>notices.push(p.processed)});
  assert.equal(r.state,'stopped');assert.equal(r.processed,10);
  assert.deepEqual(notices,[]);
});
