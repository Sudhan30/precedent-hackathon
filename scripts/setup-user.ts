import {MongoClient} from 'mongodb';
let client:MongoClient|undefined;
try{
 const email=process.env.PRECEDENT_SETUP_EMAIL,password=process.env.PRECEDENT_SETUP_PASSWORD;
 const role=process.env.PRECEDENT_SETUP_ROLE??'employee';const site=new URL(process.env.PRECEDENT_SETUP_URL??process.env.MODELENCE_SITE_URL??'http://127.0.0.1:4311');
 if(!process.env.MONGODB_URI||!email||!password||!['employee','admin'].includes(role)||!['127.0.0.1','localhost'].includes(site.hostname)||site.protocol!=='http:')throw new Error('Invalid local setup configuration');
 const method=(name:string)=>fetch(new URL('/api/_internal/method/_system.user.'+name,site),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({args:{email,password}}),signal:AbortSignal.timeout(10000)});
 let login=await method('loginWithPassword');
 if(!login.ok){const signup=await method('signupWithPassword');if(!signup.ok)throw new Error('Account setup failed');login=await method('loginWithPassword');}
 if(!login.ok)throw new Error('Account authentication failed');
 client=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:5000});await client.connect();
 const result=await client.db().collection('_modelenceUsers').updateOne({'emails.address':email.toLowerCase()},{$addToSet:{roles:role}});
 if(result.matchedCount!==1)throw new Error('Account assignment failed');
 console.log('Local Modelence account authenticated and assigned role: '+role+'. Remove setup credentials from .env.local after use.');
}catch{console.error('User setup failed. Start the local Modelence API, then configure MONGODB_URI, MODELENCE_SITE_URL, PRECEDENT_SETUP_EMAIL, PRECEDENT_SETUP_PASSWORD and PRECEDENT_SETUP_ROLE in ignored .env.local. No credentials are logged.');process.exitCode=1;}
finally{await client?.close();}
