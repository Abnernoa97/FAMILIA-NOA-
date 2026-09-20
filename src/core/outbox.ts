export type OutboxJob={id:string;busy:boolean}
export class Outbox<T extends OutboxJob>{
 private jobs=new Map<string,T>()
 private online:()=>void
 constructor(private send:(job:T)=>Promise<void>){
  this.online=()=>this.retryAll()
  window.addEventListener('online',this.online)
 }
 add(job:T){this.jobs.set(job.id,job);void this.run(job)}
 get(id:string){return this.jobs.get(id)}
 done(id:string){this.jobs.delete(id)}
 async run(job:T){if(job.busy)return;job.busy=true;try{await this.send(job)}catch{job.busy=false;throw new Error('OUTBOX_SEND_FAILED')}}
 retry(id:string){const job=this.jobs.get(id);if(job&&!job.busy)void this.run(job).catch(()=>{})}
 retryAll(){this.jobs.forEach(job=>{if(!job.busy)void this.run(job).catch(()=>{})})}
 clear(cleanup?:(job:T)=>void){this.jobs.forEach(job=>cleanup?.(job));this.jobs.clear();window.removeEventListener('online',this.online)}
}
