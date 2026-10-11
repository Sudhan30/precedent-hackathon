// Prevent publishing the local role-switching demonstration as account login.
export function validateHosting(env:NodeJS.ProcessEnv){
 if(env.NODE_ENV!=='production')return;
 if(env.AUTH_MODE!=='modelence')throw new Error('Production hosting requires AUTH_MODE=modelence.');
 if(!env.MONGODB_URI)throw new Error('Production hosting requires MongoDB for account sessions and persisted records.');
 let site:URL;try{site=new URL(env.MODELENCE_SITE_URL??'');}catch{throw new Error('Production hosting requires MODELENCE_SITE_URL with your HTTPS domain.');}
 if(site.protocol!=='https:'||site.username||site.password||site.pathname!=='/'||site.search||site.hash||['localhost','127.0.0.1','[::1]'].includes(site.hostname))throw new Error('MODELENCE_SITE_URL must be your public HTTPS origin.');
 if(env.ALLOW_FIXTURE_PLANNER==='true')throw new Error('Production hosting requires live planning; disable ALLOW_FIXTURE_PLANNER.');
}
