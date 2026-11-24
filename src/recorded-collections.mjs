// Read-only recorded payment receipts, not bank reconciliation or revenue.
// Dates refer to the entry timestamp; use IST calendar dates inclusively.
const DAY=86400000,IST=330*60000;
export function parseCollectionWindow(from,to){
 const date=x=>{
  if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x))return null;
  const t=Date.parse(x+'T00:00:00.000Z');
  return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===x?t:null;
 };
 const a=date(from),b=date(to);
 if(a===null||b===null||b<a||b-a>365*DAY)return null;
 return {from,to,lower:new Date(a-IST).toISOString(),upper:new Date(b+DAY-IST).toISOString()};
}
export async function recordedCollections(db,{from,to,lower,upper,tenantId=null,offset=0}){
 // One consistent SQL statement supplies total and page even if the requested
 // offset is empty. All currencies here are INR paise from purchase receipts.
 const rows=(await db.prepare("WITH selected AS (SELECT p.id,p.tenant_id AS tenantId,t.display_name AS company,p.created_at AS recordedAt,p.paid_paise AS paidPaise,p.purchased_seconds AS purchasedSeconds,p.receipt_ref AS receiptRef,p.actor AS recordedBy FROM tenant_credit_purchases p JOIN tenants t ON t.id=p.tenant_id WHERE p.created_at>=? AND p.created_at<? AND (? IS NULL OR p.tenant_id=?)), totals AS (SELECT COUNT(*) AS receipts,COALESCE(SUM(paidPaise),0) AS totalPaise,COALESCE(SUM(purchasedSeconds),0) AS totalSeconds FROM selected), page AS (SELECT * FROM selected ORDER BY recordedAt DESC,id DESC LIMIT 51 OFFSET ?) SELECT totals.*,page.* FROM totals LEFT JOIN page ON 1=1 ORDER BY page.recordedAt DESC,page.id DESC").bind(lower,upper,tenantId,tenantId,offset).all()).results;
 const {receipts,totalPaise,totalSeconds}=rows[0];
 if(![receipts,totalPaise,totalSeconds].every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('collections totals require review');
 const page=rows.filter(r=>r.id!==null).map(({receipts,totalPaise,totalSeconds,...r})=>r);
 return {from,to,timezone:'Asia/Kolkata',basis:'recorded_entry_time_not_bank_payment_date',receipts,totalPaise,totalSeconds,rows:page.slice(0,50),offset,hasMore:page.length>50,asOf:new Date().toISOString(),providerRequests:0};
}
