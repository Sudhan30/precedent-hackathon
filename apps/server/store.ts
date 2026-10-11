import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
export function openStore(path:string) {
 if(path!==':memory:') mkdirSync(dirname(path),{recursive:true});
 const db=new DatabaseSync(path);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
 CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL, PRIMARY KEY(kind,id));`);
 return {
  db,
  all<T=any>(kind:string):T[]{return (db.prepare('SELECT body FROM records WHERE kind=? ORDER BY rowid').all(kind) as {body:string}[]).map(r=>JSON.parse(r.body));},
  get<T=any>(kind:string,id:string):T|undefined{const r=db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind,id) as {body:string}|undefined;return r?JSON.parse(r.body):undefined;},
  put(kind:string,value:{id:string;[key:string]:any}) {db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body').run(kind,value.id,JSON.stringify(value));},
  atomic<T>(fn:()=>T):T{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}},
  close(){db.close();}
 };
}
export type Store=Pick<ReturnType<typeof openStore>,'all'|'get'|'put'|'atomic'|'close'>;
