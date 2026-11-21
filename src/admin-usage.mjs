// Read-only, Super Admin-only usage summary; never treats 'completed' as a transcript.
const asNumber=(v)=>Number.isFinite(Number(v))?Number(v):0;
const group=(rows)=>new Map((rows||[]).map(row=>[row.tenant_id,row]));
export async function enrichAdminTenantsWithUsage(env,tenants){
  if(!Array.isArray(tenants))throw Error('invalid tenants');
  // A missing CRM binding is unknown data, NOT zero use.
  if(!env.CRM_DB)return tenants.map(t=>({...t,usage:null,usageAvailable:false}));
  const db=env.CRM_DB;
  const [leads,imports,jobs]=await Promise.all([
    db.prepare('SELECT tenant_id,COUNT(*) AS customers FROM leads GROUP BY tenant_id').all(),
    db.prepare("SELECT tenant_id,COUNT(*) AS uploads,COALESCE(SUM(CAST(target_id AS INTEGER)),0) AS imported_rows FROM crm_audit_events WHERE action IN('leads.csv_import','leads.xlsx_import') GROUP BY tenant_id").all(),
    db.prepare(`SELECT tenant_id,
      SUM(CASE WHEN reserved_at IS NOT NULL THEN 1 ELSE 0 END) AS reserved_attempts,
      SUM(CASE WHEN provider_call_sid IS NOT NULL THEN 1 ELSE 0 END) AS provider_accepted,
      SUM(CASE WHEN provider_status='completed' AND duration_seconds>0 THEN 1 ELSE 0 END) AS provider_completed_with_duration,
      COALESCE(SUM(CASE WHEN provider_status='completed' AND duration_seconds>0 THEN duration_seconds ELSE 0 END),0) AS completed_seconds,
      SUM(CASE WHEN state='unknown' THEN 1 ELSE 0 END) AS uncertain
      FROM calling_jobs GROUP BY tenant_id`).all()
  ]);
  const l=group(leads.results),i=group(imports.results),j=group(jobs.results);
  return tenants.map(t=>{
    if(t.storage_mode!=='shared')return {...t,usage:null,usageAvailable:false};
    const lead=l.get(t.id),imp=i.get(t.id),job=j.get(t.id);
    return {...t,usageAvailable:true,usage:{
      customers:asNumber(lead?.customers),
      uploads:asNumber(imp?.uploads),
      importedRows:asNumber(imp?.imported_rows),
      reservedAttempts:asNumber(job?.reserved_attempts),
      providerAccepted:asNumber(job?.provider_accepted),
      providerCompletedWithDuration:asNumber(job?.provider_completed_with_duration),
      completedSeconds:asNumber(job?.completed_seconds),
      uncertain:asNumber(job?.uncertain)
    }};
  });
}
