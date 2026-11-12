import test from 'node:test';
import assert from 'node:assert/strict';
import { limitsFor, validateMedia, validateDraft, moveMedia, parseTextDraft, MAX_IMAGE_BYTES, MAX_TITLE } from '../src/upload.ts';
import type { ComposerMedia, ComposerDraft } from '../src/upload.ts';

const pic: ComposerMedia = { id:'1',uri:'blob:local-photo',kind:'image',fileName:'photo.jpg',mimeType:'image/jpeg',fileSize:2_048 };
const clip: ComposerMedia = { id:'v',uri:'blob:local-video',kind:'video',fileName:'video.mp4',mimeType:'video/mp4',fileSize:5_000_000 };

test('Post supports up to six media items, Story one, Reel one video',()=>{
  assert.equal(limitsFor('Post').maxCount,6);
  assert.equal(validateMedia('Post',[pic]).ok,true);
  assert.equal(validateMedia('Post',Array.from({length:7},(_,i)=>({...pic,id:String(i)}))).ok,false);
  assert.equal(validateMedia('Story',[pic,clip]).ok,false);
  assert.equal(validateMedia('Reel',[pic]).ok,false);
  assert.equal(validateMedia('Reel',[clip]).ok,true);
});

test('rejects unsupported formats, duplicate media and oversized files',()=>{
  assert.equal(validateMedia('Post',[pic,pic]).ok,false);
  assert.equal(validateMedia('Post',[{...pic,mimeType:'application/javascript'}]).ok,false);
  assert.equal(validateMedia('Post',[{...pic,fileSize:MAX_IMAGE_BYTES+1}]).ok,false);
  assert.equal(validateMedia('Post',[{...clip,fileSize:201*1024*1024}]).ok,false);
  assert.equal(validateMedia('Post',[{...pic,fileSize:-1}]).ok,false);
  assert.equal(validateMedia('Post',[]).ok,false);
});

test('review validates audience, category and caption before a future upload',()=>{
  const draft: ComposerDraft={mode:'Post',caption:' My build ',audience:'private',category:'motorcycles',media:[pic]};
  assert.deepEqual(validateDraft(draft),{ok:true,value:{...draft,caption:'My build'}});
  assert.equal(validateDraft({...draft,caption:'x'.repeat(2201)}).ok,false);
  assert.equal(validateDraft({...draft,title:'x'.repeat(MAX_TITLE+1)}).ok,false);
  assert.equal(validateDraft({...draft,title:'Garage day'}).ok,true);
  assert.equal(validateDraft({...draft,audience:'everyone' as 'public'}).ok,false);
});

test('media reordering stays local and cannot change unknown media',()=>{
  assert.deepEqual(moveMedia([pic,clip],'v',-1).map(x=>x.id),['v','1']);
  assert.deepEqual(moveMedia([pic,clip],'unknown',-1).map(x=>x.id),['1','v']);
  assert.deepEqual(moveMedia([pic,clip],'1',-1).map(x=>x.id),['1','v']);
});

test('only valid text-only drafts may be restored; never persist file objects',()=>{
  const valid={mode:'Story',caption:'Test',audience:'private',category:'cars'};
  assert.deepEqual(parseTextDraft(valid),valid);
  assert.deepEqual(parseTextDraft({ ...valid, title:'Sunday ride' }),{...valid,title:'Sunday ride'});
  assert.equal(parseTextDraft({ ...valid, title:'x'.repeat(MAX_TITLE+1) }),null);
  assert.equal(parseTextDraft({ ...valid, audience:'all' }),null);
  assert.equal(parseTextDraft({ ...valid, caption:20 }),null);
});
