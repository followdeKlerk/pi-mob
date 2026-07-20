import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BridgeStore, OneSessionPiAdapter, deterministicIdGenerator, type PiRpcClient, type PiRpcRequestOptions } from "../src";

class Rpc implements PiRpcClient {
  requests: PiRpcRequestOptions[] = [];
  responses: Array<{id:string;value?:string;confirmed?:boolean;cancelled?:true}> = [];
  handlers = new Set<(raw:unknown)=>void>();
  async request(input:PiRpcRequestOptions):Promise<unknown>{ this.requests.push(input); return {}; }
  async sendExtensionUiResponse(input:{id:string;value?:string;confirmed?:boolean;cancelled?:true}):Promise<void>{ this.responses.push(input); }
  on(_kind:"notification", handler:(raw:unknown)=>void):()=>void { this.handlers.add(handler); return ()=>this.handlers.delete(handler); }
  emit(raw:unknown):void { for(const handler of this.handlers) handler(raw); }
}
function fixture(now=1_700_000_000_000){
  const path=join(mkdtempSync(join(tmpdir(),"pi-mob-m14-")),"bridge.sqlite");
  const store=new BridgeStore(path,()=>now); const identity=store.identity(); store.ensureStream(`host:${identity.hostId}`,"host");
  const rpc=new Rpc(); const adapter=new OneSessionPiAdapter({store,rpc,workspace:{workspaceId:"11111111-1111-4111-8111-111111111111",rootPath:"/private/example",displayName:"example",fingerprint:"fixture",policyMode:"full"},newSessionId:deterministicIdGenerator("session"),now:()=>now});
  return {path,store,rpc,adapter};
}
async function create(f:ReturnType<typeof fixture>):Promise<string>{ await f.adapter.dispatch({commandId:crypto.randomUUID(),type:"session.create",scopeKey:"host",streamId:`host:${f.store.identity().hostId}`,semanticHash:"x",payload:{},state:"running",dispatchCount:1}); return String(f.store.sessionStates()[0]!.sessionId); }

describe("M14 durable follow-up queue",()=>{
  test("is bounded FIFO, removal is final, and restart recovers dispatching",()=>{
    const f=fixture(); f.store.ensureSession("11111111-1111-4111-8111-111111111111",{}); f.store.ensureStream("session:11111111-1111-4111-8111-111111111111","session","11111111-1111-4111-8111-111111111111");
    const first=f.store.enqueueFollowUp({sessionId:"11111111-1111-4111-8111-111111111111",message:"one"});
    const second=f.store.enqueueFollowUp({sessionId:first.sessionId,message:"two",attachmentIds:["a"]});
    f.store.removeFollowUp(first.sessionId,first.queueItemId);
    expect(f.store.claimNextFollowUp(first.sessionId)?.queueItemId).toBe(second.queueItemId);
    f.store.close(); const reopened=new BridgeStore(f.path); expect(reopened.recoverDispatchingFollowUps()).toBe(1); expect(reopened.listFollowUps(first.sessionId)[0]?.message).toBe("two");
    for(let i=1;i<10;i++) reopened.enqueueFollowUp({sessionId:first.sessionId,message:String(i)});
    expect(()=>reopened.enqueueFollowUp({sessionId:first.sessionId,message:"overflow"})).toThrow("queue_full");
  });
  test("follow-up never calls Pi until agent_settled",async()=>{
    const f=fixture(); const sessionId=await create(f); f.rpc.requests=[];
    f.adapter.validateCommand("prompt.submit",{sessionId,message:"later",deliveryMode:"follow_up"});
    f.adapter.commandAccepted("prompt.submit",{sessionId,message:"later",deliveryMode:"follow_up"},"22222222-2222-4222-8222-222222222222");
    await f.adapter.dispatch({commandId:"22222222-2222-4222-8222-222222222222",type:"prompt.submit",scopeKey:`session:${sessionId}`,streamId:`session:${sessionId}`,semanticHash:"x",payload:{sessionId,message:"later",deliveryMode:"follow_up"},state:"running",dispatchCount:1});
    expect(f.rpc.requests).toHaveLength(0); f.rpc.emit({type:"agent_settled",sessionId}); await Bun.sleep(5);
    expect(f.rpc.requests.map(value=>value.method)).toEqual(["prompt"]); expect(f.store.listFollowUps(sessionId)).toEqual([]);
  });
});

describe("M14 durable extension dialogs",()=>{
  test("replays pending dialog and sends exactly one correlated response",async()=>{
    const f=fixture(); const sessionId=await create(f);
    f.rpc.emit({type:"extension_ui_request",sessionId,id:"upstream-1",method:"input",title:"Name",placeholder:"value",timeout:60_000});
    const dialog=f.store.pendingDialog(sessionId)!; expect(dialog.method).toBe("input"); expect(dialog.dialogId).not.toBe("upstream-1");
    await f.adapter.dispatch({commandId:crypto.randomUUID(),type:"extension.respond",scopeKey:`session:${sessionId}`,streamId:`session:${sessionId}`,semanticHash:"x",payload:{sessionId,dialogId:dialog.dialogId,response:{value:"Ada"}},state:"running",dispatchCount:1});
    expect(f.rpc.responses).toEqual([{id:"upstream-1",value:"Ada"}]);
    expect(()=>f.adapter.validateCommand("extension.respond",{sessionId,dialogId:dialog.dialogId,response:{value:"twice"}})).toThrow("invalid_state");
  });
  test("expiry produces no invented response",async()=>{
    const f=fixture(); const sessionId=await create(f); f.rpc.emit({type:"extension_ui_request",sessionId,id:"upstream-2",method:"confirm",title:"Proceed?",message:"Confirm",timeout:0});
    expect(f.store.pendingDialog(sessionId)).toBeNull(); expect(f.rpc.responses).toEqual([]);
  });
});
