// Synthetic BigQuery-style warehouse. Server-controlled catalog: agents may name a
// table, but classification and contents come only from here. Clearly synthetic data.
export const departments=['finance','engineering','sales','support'] as const;
export type Department=typeof departments[number];
export type Classification='internal'|'finance-restricted';
interface Table{name:string;classification:Classification;description:string;columns:string[];rows:Record<string,string|number>[]}
const weeks=['2026-W27','2026-W31','2026-W35','2026-W39'];
const regions:[string,number][]=[['NA',4210],['EMEA',3120],['APAC',2480]];
export const catalog:Table[]=[
 // Legacy snapshot: looks right by name, but holds nothing for the last quarter.
 {name:'acme_dw.customers',classification:'internal',description:'Legacy customer snapshot (frozen 2025-12-31).',columns:['customer_id','region','signup_date','last_order_date'],rows:[]},
 // The obvious name is a deprecated, frozen table: the classic undocumented-warehouse trap.
 {name:'acme_dw.weekly_active_customers',classification:'internal',description:'DEPRECATED 2025-06: frozen copy, no longer loaded.',columns:['iso_week','region','active_customers'],rows:[]},
 // The table that actually answers the question; opaque name, no description shown to agents.
 {name:'acme_dw.t_04417',classification:'internal',description:'Weekly active customers by region (active = at least one order in the trailing 7 days).',columns:['iso_week','region','active_customers'],
  rows:weeks.flatMap((week,w)=>regions.map(([region,base])=>({iso_week:week,region,active_customers:base+w*137+(region==='APAC'?w*61:0)})))},
 {name:'acme_dw.evt_raw_2026',classification:'internal',description:'Raw clickstream events (no customer identifiers).',columns:['event_id','event_type','ts'],rows:[]},
 {name:'finance.restricted_revenue_by_customer',classification:'finance-restricted',description:'Recognized revenue by customer and region.',columns:['customer_id','region','quarter','revenue_usd'],
  rows:regions.map(([region,base],i)=>({customer_id:'C-'+(1001+i),region,quarter:'2026-Q3',revenue_usd:base*312}))}
];
export const tableNames=catalog.map(table=>table.name);
export const tableNamePattern=/^[a-z0-9_]+\.[a-z0-9_]+$/;
export const findTable=(name?:string|null)=>name?catalog.find(table=>table.name===name):undefined;
export const classificationOf=(name?:string|null)=>findTable(name)?.classification;
// The rows as stored in MongoDB Atlas (collection warehouse_rows): one document per row,
// tagged with its table and an ordinal that preserves row order.
export const warehouseCollection='warehouse_rows';
export const warehouseDocuments=()=>catalog.flatMap(table=>table.rows.map((row,ordinal)=>({table:table.name,ordinal,...row})));
// A small display preview: the most recent rows first (largest value first within a week).
// The receipt keeps the full summary; this is only what the chat draws as a table.
export interface WarehousePreview{table:string;columns:string[];rows:Record<string,string|number>[];rowCount:number}
export function warehousePreview(name?:string|null,stored?:Record<string,string|number>[],limit=5):WarehousePreview|null{
 const table=findTable(name);if(!table)return null;const rows=stored??table.rows;if(!rows.length)return null;
 const value=(row:Record<string,string|number>)=>Number(row.active_customers??row.revenue_usd??0);
 const ordered=rows.toSorted((a,b)=>String(b.iso_week??'').localeCompare(String(a.iso_week??''))||value(b)-value(a));
 return {table:table.name,columns:table.columns.filter(column=>column in rows[0]),rows:ordered.slice(0,limit),rowCount:rows.length};
}
export type WarehouseRows=(table:string)=>Promise<Record<string,string|number>[]>;
// A fixed, read-only aggregation per table; never arbitrary SQL from the agent. Rows default to
// the catalog's own copy; the live gateway passes the rows it read from Atlas (origin noted).
export function queryWarehouse(name?:string|null,stored?:Record<string,string|number>[],origin=''){
 const table=findTable(name);if(!table)return {table:name??null,rowCount:0,rows:[] as Record<string,string|number>[],summary:`Table ${name??'(none)'} does not exist in the catalog.`};
 const rows=stored??table.rows;const from=origin?` (${origin})`:'';
 if(!rows.length)return {table:table.name,rowCount:0,rows,summary:`0 rows: ${table.name} returned no results for the requested period${from}.`};
 if(table.name==='acme_dw.t_04417'){const latest=rows.filter(r=>r.iso_week===weeks.at(-1));return {table:table.name,rowCount:rows.length,rows,summary:`${rows.length} rows from ${table.name}${from}. Latest week ${weeks.at(-1)}: ${latest.map(r=>`${r.region} ${r.active_customers}`).join(', ')} weekly active customers.`};}
 return {table:table.name,rowCount:rows.length,rows,summary:`${rows.length} rows from ${table.name}${from}: ${rows.map(r=>`${r.region} ${r.revenue_usd} USD`).join(', ')}.`};
}
