import {expect,test} from 'bun:test';
import {detectSelfHashToolLoop,detectRepeatedReadOnlyToolLoop} from '../bridge/tool-loop-guard.mjs';
const hash=n=>String(n).repeat(64),target='../HANDOFF.md',workdir='/test/source';
function pair(n,{added=hash(n+1),removed=hash(n),output=hash(n+2),id=`c${n}`,extra=''}={}){
  return [{type:'function_call',name:'exec_command',call_id:id,arguments:JSON.stringify({workdir,cmd:`apply_patch <<'PATCH'\n*** Begin Patch\n*** Update File: ${target}\n@@\n-- packet SHA256 ${removed}\n+- packet SHA256 ${added}\n*** End Patch\nPATCH\nshasum -a 256 ${target}${extra}`})},
    {type:'function_call_output',call_id:id,output:`Process exited with code 0\nOutput:\nSuccess. Updated files.\n${output}  ${target}\n`}];
}
const loop=()=>[...pair(1),...pair(2),...pair(3)];
test('causal three-step self-hash loop stops; fewer steps do not',()=>{
  expect(detectSelfHashToolLoop(loop())).toBe(true);
  expect(detectSelfHashToolLoop([...pair(1),...pair(2)])).toBe(false);
});
test('legitimate digest updates followed by checksums are not self-hash loops',()=>{
  expect(detectSelfHashToolLoop([...pair(1),...pair(2,{added:hash(8)}),...pair(3)])).toBe(false);
});
test('user correction and later independent tool activity clear stale history',()=>{
  expect(detectSelfHashToolLoop([...loop(),{type:'message',role:'user',content:'Fix the hash location.'}])).toBe(false);
  const read=[{type:'function_call',name:'exec_command',call_id:'read',arguments:JSON.stringify({workdir,cmd:'pwd'})},{type:'function_call_output',call_id:'read',output:'Process exited with code 0\n/test/source'}];
  expect(detectSelfHashToolLoop([...loop(),...read])).toBe(false);
  expect(detectSelfHashToolLoop([...loop(),...read.slice(0,1)])).toBe(false);
});
test('failed, mismatched, duplicate and parallel calls do not count as successful cycles',()=>{
  const failed=loop();failed.at(-1).output='Process exited with code 1';expect(detectSelfHashToolLoop(failed)).toBe(false);
  const mismatch=loop();mismatch.at(-1).call_id='unknown';expect(detectSelfHashToolLoop(mismatch)).toBe(false);
  expect(detectSelfHashToolLoop([...pair(1),...pair(2,{id:'c1'}),...pair(3)])).toBe(false);
  const pending=loop();pending.splice(3,0,{type:'function_call',name:'unknown',call_id:'parallel',arguments:'{}'});expect(detectSelfHashToolLoop(pending)).toBe(false);
});
test('no false positives for other files, extra shell actions or real source changes',()=>{
  const other=loop();other[4].arguments=other[4].arguments.replace('../HANDOFF.md','../OTHER.md');expect(detectSelfHashToolLoop(other)).toBe(false);
  expect(detectSelfHashToolLoop([...pair(1),...pair(2),...pair(3,{extra:'\necho extra'})])).toBe(false);
  const changed=loop();changed[4].arguments=changed[4].arguments.replace('+- packet','+- new-content packet');expect(detectSelfHashToolLoop(changed)).toBe(false);
});
test('inert reasoning does not hide a cycle; malformed and bounded input fails open',()=>{
  const inert=loop();inert.splice(3,0,{type:'reasoning',summary:[]});expect(detectSelfHashToolLoop(inert)).toBe(true);
  expect(detectSelfHashToolLoop(null)).toBe(false);
  const malformed=loop();malformed[4].arguments='not-json';expect(detectSelfHashToolLoop(malformed)).toBe(false);
});

function readPair(n,{file=n%2?'src/first.ts':'src/second.ts',body='12: const syntheticField = 1;\n',exit=0,id=`read${n}`,cmd,output,dir='/test/synthetic/source',name='exec_command'}={}) {
  return [{type:'function_call',name,call_id:id,arguments:JSON.stringify({workdir:dir,cmd:cmd??`rg -n "syntheticField" ${file} | cat`})},
    {type:'function_call_output',call_id:id,output:output??`Chunk ID: chunk${n}\nWall time: 0.000${n} seconds\nProcess exited with code ${exit}\nOriginal token count: 9\nOutput:\n${body}`}];
}
const readLoop=(n=8,options={})=>Array.from({length:n},(_,i)=>readPair(i+1,options)).flat();
test('eight successful identical source reads or an alternating pair stops; below threshold does not',()=>{
  expect(detectSelfHashToolLoop(readLoop())).toBe(false); // A source-read loop is distinct from a self-hash loop.
  expect(detectRepeatedReadOnlyToolLoop(readLoop())).toBe(true);
  expect(detectRepeatedReadOnlyToolLoop(readLoop(8,{file:'src/one.ts'}))).toBe(true);
  expect(detectRepeatedReadOnlyToolLoop(readLoop(7))).toBe(false);
  expect(detectRepeatedReadOnlyToolLoop(readLoop(8,{name:'functions.exec_command'}))).toBe(true);
});
test('stable actual body ignores only metadata and supports the known JSON tool envelope',()=>{
  expect(detectRepeatedReadOnlyToolLoop(readLoop(8,{output:JSON.stringify({exit_code:0,output:'4: syntheticField();\n',wall_time_seconds:0.01,chunk_id:'synthetic'})}))).toBe(true);
  expect(detectRepeatedReadOnlyToolLoop(readLoop(8,{output:'Process exited with code 0\nFinal output:\n4: syntheticField();\n'}))).toBe(true);
  const sequence=readLoop(); sequence.splice(4,0,{type:'message',role:'assistant',content:'Checking the source.'},{type:'reasoning',summary:[]});
  expect(detectRepeatedReadOnlyToolLoop(sequence)).toBe(true);
});
test('changed output, new inspection or changed worktree is progress, not the same read cycle',()=>{
  expect(detectRepeatedReadOnlyToolLoop([...readLoop(7),...readPair(8,{body:'13: syntheticFieldChanged();\n'})])).toBe(false);
  expect(detectRepeatedReadOnlyToolLoop([...readLoop(7),...readPair(8,{file:'src/new.ts'})])).toBe(false);
  expect(detectRepeatedReadOnlyToolLoop([...readLoop(7),...readPair(8,{dir:'/test/another/source'})])).toBe(false);
  // A single command alternating changed contents is not two stable queries.
  const changed=Array.from({length:8},(_,i)=>readPair(i+1,{file:'src/one.ts',body:`${i%2+1}: value\n`})).flat();
  expect(detectRepeatedReadOnlyToolLoop(changed)).toBe(false);
});
test('owner correction, resume, edits and other tools reset stale inspection history',()=>{
  for(const event of [{type:'message',role:'user',content:'Continue a revised task.'},{type:'message',role:'developer',content:'New assignment.'},{type:'message',role:'system',content:'Resume.'},{type:'agent_message'}]) {
    expect(detectRepeatedReadOnlyToolLoop([...readLoop(),event])).toBe(false);
    expect(detectRepeatedReadOnlyToolLoop([...readLoop(6),event,...readPair(7),...readPair(8)])).toBe(false);
  }
  for(const cmd of ['apply_patch < patch.diff','sed -i x src/first.ts','bun test unit.test.ts','pwd']) {
    expect(detectRepeatedReadOnlyToolLoop([...readLoop(6),...readPair(99,{cmd}),...readPair(7),...readPair(8)])).toBe(false);
  }
});
test('genuine errors, pipe-masked rg failures, empty and truncated outputs are never successful reads',()=>{
  for(const options of [{exit:1},{body:'rg: missing.ts: No such file\n'},{body:''},{body:'Warning: truncated output\n12: x\n'},
    {output:JSON.stringify({exit_code:0,output:'12: x\n',session_id:42})},{output:'Script running with cell ID synthetic'},
    {output:'{"error":{"code":429}}'}]) {
    expect(detectRepeatedReadOnlyToolLoop([...readLoop(7),...readPair(8,options)])).toBe(false);
  }
});
test('distinct call identities and complete sequential results are mandatory',()=>{
  expect(detectRepeatedReadOnlyToolLoop(readLoop(8,{id:'same-id'}))).toBe(false);
  const wrong=readLoop();wrong.at(-1).call_id='unknown';expect(detectRepeatedReadOnlyToolLoop(wrong)).toBe(false);
  expect(detectRepeatedReadOnlyToolLoop([...readLoop(),readPair(9)[0]])).toBe(false);
  const parallel=readLoop();parallel.splice(3,0,readPair(99)[0]);expect(detectRepeatedReadOnlyToolLoop(parallel)).toBe(false);
});
test('legitimate waits/polls and unknown shell structures fail open for this narrow detector',()=>{
  for(const cmd of ['rg -n "syntheticField" task.log | cat','tail -n 20 task.log','sleep 1; rg -n "syntheticField" src/first.ts | cat',
    'rg -n "syntheticField" src/first.ts | cat; echo next','rg -n "synthetic.*" src/first.ts | cat','rg -n "syntheticField" src/first.ts src/second.ts | cat'])
    expect(detectRepeatedReadOnlyToolLoop(readLoop(8,{cmd}))).toBe(false);
  for(const name of ['wait','write_stdin','functions.wait','functions.write_stdin'])
    expect(detectRepeatedReadOnlyToolLoop(readLoop(8,{name}))).toBe(false);
  expect(detectRepeatedReadOnlyToolLoop(null)).toBe(false);
  const malformed=readLoop();malformed[14].arguments='bad-json';expect(detectRepeatedReadOnlyToolLoop(malformed)).toBe(false);
  for(const value of ['null','[]','7']) { const bad=readLoop();bad[14].arguments=value;expect(detectRepeatedReadOnlyToolLoop(bad)).toBe(false); }
  expect(detectRepeatedReadOnlyToolLoop([...readLoop(),{type:'error',code:429}])).toBe(false);
});
