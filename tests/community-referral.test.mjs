import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const id = '01234567-1234-4567-8901-0123456789ab';
function referralContext({url='https://aiparty.kr/',blocked=false,existing=null,accepted=true}={}) {
  const values=new Map(existing ? [['aip_referral_v1',JSON.stringify(existing)]]:[]);
  const calls=[];
  const storage={getItem:k=>{if(blocked)throw Error('blocked');return values.get(k)||null;},setItem:(k,v)=>{if(blocked)throw Error('blocked');values.set(k,v);}};
  const source=readFileSync(new URL('../public/community/referral.js',import.meta.url),'utf8').replaceAll('export ','').replace("await import('./client.js')",'await Promise.resolve({supabase: mockedSupabase})')+'\n globalThis.api={readReferralUrl,getReferral,signupReferralData,captureReferral,buildReferralUrl};';
  const context={URL,Date,crypto:{randomUUID:()=>id},localStorage:storage,location:{href:url},mockedSupabase:{rpc:async(name,args)=>{calls.push({name,args});return {data:accepted,error:null};}}};
  runInNewContext(source,context);
  return {api:context.api,values,calls};
}
test('share links safely encode UTM values and contain the referrer ID',()=>{
  const {api}=referralContext();
  const url=new URL(api.buildReferralUrl({username:'alice'},{slug:'abc12345',source:'카카오 & friends',medium:'share',campaign:'가을=초대'}));
  assert.equal(url.origin,'https://aiparty.kr');assert.equal(url.searchParams.get('ref'),'alice');assert.equal(url.searchParams.get('utm_source'),'카카오 & friends');assert.equal(url.searchParams.get('utm_campaign'),'가을=초대');
  assert.equal(api.readReferralUrl(new URL('https://aiparty.kr/?ref=%3Cscript%3E')),null);
});
test('successful automatic attribution sends browser UUID but no manual recommender metadata',async()=>{
  const {api,calls}=referralContext({url:'https://aiparty.kr/?ref=alice&link=abcdefgh'});await api.captureReferral();
  assert.equal(calls[0].args.p_referrer,'alice');assert.equal(calls[0].args.p_visitor_id,id);assert.equal(api.getReferral().referrer,'alice');
  assert.deepEqual(Object.keys(api.signupReferralData()),['visitor_id']);
});
test('later links count reach without replacing unexpired first touch',async()=>{
  const existing={referrer:'alice',slug:'abcdefgh',visitorId:id,expiresAt:Date.now()+10000};
  const {api,calls}=referralContext({url:'https://aiparty.kr/?ref=bob&link=ijklmnop',existing});await api.captureReferral();
  assert.equal(calls[0].args.p_referrer,'bob');assert.equal(api.getReferral().referrer,'alice');
});
test('expired, invalid and failed tracking cannot create valid local attribution; blocked storage works',async()=>{
  const failed=referralContext({url:'https://aiparty.kr/?ref=alice',accepted:false});await failed.api.captureReferral();assert.equal(failed.api.getReferral(),null);
  const expired=referralContext({existing:{referrer:'alice',visitorId:id,expiresAt:1}});assert.equal(expired.api.getReferral(),null);
  const blocked=referralContext({url:'https://aiparty.kr/?ref=alice',blocked:true});await blocked.api.captureReferral();assert.equal(blocked.api.getReferral().visitorId,id);
});
test('safeNext rejects external and backslash redirects while preserving local routes',()=>{
  const source=readFileSync(new URL('../public/community/client.js',import.meta.url),'utf8');
  const start=source.indexOf('export function safeNext');const end=source.indexOf('\nexport function authError');
  const context={URL,location:{origin:'https://aiparty.kr'}};runInNewContext(source.slice(start,end).replace('export ','')+'\nglobalThis.safe=safeNext;',context);
  for(const path of ['//evil.test','/\\evil.test','https://evil.test','/\n/evil.test','/x/..//evil.test','/x/%2e%2e//evil.test',null])assert.equal(context.safe(path),'/account');
  assert.equal(context.safe('/board/write?id=abc'),'/board/write?id=abc');
});
