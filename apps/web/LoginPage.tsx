import React,{useState} from 'react';
import {Icon} from './Icon.js';

interface Props {
 email:string;password:string;busy:boolean;loading:boolean;unavailable:boolean;error:string;
 onEmail:(value:string)=>void;onPassword:(value:string)=>void;onSubmit:()=>void;
}
export function LoginPage({email,password,busy,loading,unavailable,error,onEmail,onPassword,onSubmit}:Props){
 const [showPassword,setShowPassword]=useState(false);
 return <main className="login-page">
  <a className="login-brand" href="/login"><span className="brand-mark" aria-hidden="true">P</span>Precedent</a>
  <div className="login-layout">
  <section className="login-story" aria-label="About Precedent">
   <span className="story-kicker"><span/> INTELLIGENCE, WITH ACCOUNTABILITY</span>
   <h2>Give your agents <br/>room to act. <br/><em>And a boundary <br/>to trust.</em></h2>
   <p>Company policy and shared memory, built into every decision. Put your agents to work with confidence.</p>
   <div className="policy-path" aria-label="Governed action workflow">
    <div><Icon name="chat"/><span>Your request<small>A clear intention</small></span></div><span className="path-line"/>
    <div className="path-gate"><Icon name="shield"/><span>Precedent<small>Context. Policy. Permission.</small></span><Icon name="check"/></div><span className="path-line"/>
    <div><Icon name="activity"/><span>Accountable action<small>A recorded decision and outcome</small></span></div>
   </div>
   <span className="story-caption">01 / CONTEXT &nbsp; 02 / CONTROL &nbsp; 03 / CONFIDENCE</span>
  </section>
  <div className="login-form-side"><section className="login-card" aria-labelledby="login-title">
   <span className="login-symbol"><Icon name="shield"/></span>
   <h1 id="login-title">{loading?'Opening your workspace':unavailable?'Unable to connect':'Welcome back'}</h1>
   <p>{loading?'Checking your sign-in session…':unavailable?'The sign-in service is unavailable. Please try again.':'Sign in to your Precedent workspace.'}</p>
   {loading?<p role="status" className="login-loading">Connecting securely…</p>:unavailable?<><p role="alert" className="login-error">{error}</p><button onClick={()=>window.location.reload()}>Try again</button></>:<form onSubmit={event=>{event.preventDefault();if(!busy)onSubmit();}}>
    <label htmlFor="login-email">Username or email</label>
    <input id="login-email" type="text" autoComplete="username" autoFocus required maxLength={254} placeholder="Your username or email" value={email} onChange={event=>onEmail(event.target.value)} disabled={busy}/>
    <label htmlFor="login-password">Password</label>
    <div className="login-password"><input id="login-password" type={showPassword?'text':'password'} autoComplete="current-password" required value={password} onChange={event=>onPassword(event.target.value)} disabled={busy}/><button className="secondary" type="button" aria-label={showPassword?'Hide password':'Show password'} aria-pressed={showPassword} onClick={()=>setShowPassword(value=>!value)}>{showPassword?'Hide':'Show'}</button></div>
    {error&&<p role="alert" className="login-error">{error}</p>}
    <button className="login-submit" type="submit" disabled={busy}>{busy?'Signing in…':'Sign in'}{!busy&&<Icon name="arrow"/>}</button>
    <p className="login-help">Need access or help signing in?<br/>Contact your workspace administrator.</p>
   </form>}
  </section>
  </div></div>
  <p className="login-footer"><Icon name="shield"/>Company policy. Clear decisions. Accountable agents.</p>
 </main>;
}
