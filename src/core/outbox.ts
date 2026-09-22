export type OutboxJob={id:string;busy:boolean}

type PersistedJob<T>={scope:string;job:T}
const DB='familia-noa-outbox',STORE='jobs',VERSION=1

function db():Promise<IDBDatabase>{
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(DB,VERSION)
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:'key'})}
  request.onsuccess=()=>resolve(request.result)
  request.onerror=()=>reject(request.error)
 })
}
async function put<T extends OutboxJob>(scope:string,job:T){
 const database=await db();await new Promise<void>((resolve,reject)=>{const tx=database.transaction(STORE,'readwrite');tx.objectStore(STORE).put({key:`${scope}:${job.id}`,scope,job:{...job,busy:false}});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)});database.close()
}
async function remove(scope:string,id:string){
 const database=await db();await new Promise<void>((resolve,reject)=>{const tx=database.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(`${scope}:${id}`);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)});database.close()
}
async function load(scope:string):Promise<any[]>{
 const database=await db();const rows=await new Promise<any[]>((resolve,reject)=>{const tx=database.transaction(STORE,'readonly'),request=tx.objectStore(STORE).getAll();request.onsuccess=()=>resolve(request.result||[]);request.onerror=()=>reject(request.error)});database.close();return rows.filter(row=>row.scope===scope).map(row=>({...row.job,busy:false}))
}

export class Outbox<T extends OutboxJob>{
 private jobs=new Map<string,T>()
 private online:()=>void
 constructor(
  private send:(job:T)=>Promise<void>,
  private scope='default',
  private normalize?:(job:any)=>T|null
 ){
  this.online=()=>this.retryAll()
  window.addEventListener('online',this.online)
 }
 async restore(onRestore?:(job:T)=>void){
  if(!('indexedDB'in window))return
  try{
   for(const raw of await load(this.scope)){
    const job=this.normalize?this.normalize(raw):raw as T
    if(!job||this.jobs.has(job.id))continue
    this.jobs.set(job.id,job)
    if(this.normalize){try{await put(this.scope,job)}catch(error){console.error('Outbox migration persist failed',error)}}
    onRestore?.(job)
   }
   this.retryAll()
  }catch(error){console.error('Outbox restore failed',error)}
 }
 async add(job:T){this.jobs.set(job.id,job);if('indexedDB'in window){try{await put(this.scope,job)}catch(error){console.error('Outbox persist failed',error)}}void this.run(job).catch(()=>{})}
 get(id:string){return this.jobs.get(id)}
 done(id:string){this.jobs.delete(id);if('indexedDB'in window)void remove(this.scope,id).catch(error=>console.error('Outbox cleanup failed',error))}
 async run(job:T){if(job.busy)return;job.busy=true;try{await this.send(job)}catch{job.busy=false;throw new Error('OUTBOX_SEND_FAILED')}}
 retry(id:string){const job=this.jobs.get(id);if(job&&!job.busy)void this.run(job).catch(()=>{})}
 retryAll(){this.jobs.forEach(job=>{if(!job.busy)void this.run(job).catch(()=>{})})}
 clear(cleanup?:(job:T)=>void){this.jobs.forEach(job=>cleanup?.(job));this.jobs.clear();window.removeEventListener('online',this.online)}
}
