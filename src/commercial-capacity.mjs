// Shared CRM is the serialization point for BOTH commercial job types.
// Count uncertain and pre-submission funded claims conservatively. No new
// D1 round trip is required in the legacy atomic claim or capacity query.
// A terminal closure is append-only and can only reference a matching
// verified receipt. Funding claims and uncertain submissions are never
// dropped merely because their deadline passed.
export const industryOccupiedFor=alias=>{
 if(!['a','industry_funded_admissions'].includes(alias))throw Error('invalid capacity alias');
 return alias+".state IN('claiming','funded','unknown') AND NOT EXISTS(SELECT 1 FROM industry_terminal_closures terminal WHERE terminal.tenant_id="+alias+".tenant_id AND terminal.job_id="+alias+".job_id)";
};
export const industryOccupied=industryOccupiedFor('industry_funded_admissions');
export const commercialCapacityRows="SELECT tenant_id,lead_id,state FROM calling_jobs WHERE state IN('reserved','submitted','unknown') UNION ALL SELECT tenant_id,lead_id,CASE state WHEN 'claiming' THEN 'reserved' WHEN 'funded' THEN 'reserved' ELSE 'unknown' END AS state FROM industry_funded_admissions WHERE "+industryOccupied;
export const sharedCapacityCount="(SELECT COUNT(*) FROM ("+commercialCapacityRows+"))";
export const sharedTenantCapacityCount="(SELECT COUNT(*) FROM ("+commercialCapacityRows+") WHERE tenant_id=?)";
export const sharedTenantUnknown="NOT EXISTS(SELECT 1 FROM ("+commercialCapacityRows+") WHERE tenant_id=? AND state='unknown')";
