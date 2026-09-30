const SUPABASE_URL='https://ldtfzvvmjsarkxrchrqx.supabase.co'
const SUPABASE_KEY='sb_publishable_r3apEbRySSbhOSyx9URW7A_8aQDV5dN'

async function authenticated(request:Request){
  const authorization=request.headers.get('Authorization')||''
  if(!authorization.startsWith('Bearer '))return false
  try{
    const response=await fetch(`${SUPABASE_URL}/auth/v1/user`,{
      headers:{
        Authorization:authorization,
        apikey:SUPABASE_KEY,
      },
    })
    return response.ok
  }catch{
    return false
  }
}

function decodeBase64(value:string){
  const clean=value.replace(/^data:audio\/[^;]+;base64,/i,'')
  const binary=atob(clean)
  const bytes=new Uint8Array(binary.length)
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i)
  return bytes
}

export default {
  async fetch(request:Request,env:any):Promise<Response>{
    const url=new URL(request.url)

    if(url.pathname==='/api/noa-voice/status'){
      return Response.json({ok:true,engine:'cloudflare-workers-ai-melotts',lang:'es'})
    }

    if(url.pathname==='/api/noa-voice'){
      if(request.method!=='POST')return new Response('Method not allowed',{status:405})
      if(!await authenticated(request))return new Response('Unauthorized',{status:401})

      let body:any={}
      try{body=await request.json()}catch{return new Response('Invalid JSON',{status:400})}
      const text=String(body?.text||'').replace(/\s+/g,' ').trim().slice(0,900)
      if(!text)return new Response('Missing text',{status:400})

      try{
        const result=await env.AI.run('@cf/myshell-ai/melotts',{
          prompt:text,
          lang:'es',
        })
        const audio=String(result?.audio||'')
        if(!audio)return new Response('Voice generation returned no audio',{status:502})
        const bytes=decodeBase64(audio)
        return new Response(bytes,{
          headers:{
            'Content-Type':'audio/mpeg',
            'Cache-Control':'no-store',
            'X-Content-Type-Options':'nosniff',
          },
        })
      }catch(error){
        console.error('NOA voice generation failed',error)
        return new Response('Voice generation failed',{status:503})
      }
    }

    return env.ASSETS.fetch(request)
  },
}
