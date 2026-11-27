// Shared CRM is the serialization point for BOTH commercial job types.
// Count uncertain and pre-submission funded claims conservatively. No new
// D1 round trip is required in the legacy atomic claim or capacity query.
export const industryOccupied="state IN('claiming','funded','unknown')";
export const commercialCapacityRows="SELECT tenant_id,lead_id,state FROM calling_jobs WHERE state IN('reserved','submitted','unknown') UNION ALL SELECT tenant_id,lead_id,CASE state WHEN 'claiming' THEN 'reserved' WHEN 'funded' THEN 'reserved' ELSE 'unknown' END AS state FROM industry_funded_admissions WHERE "+industryOccupied;
export const sharedCapacityCount="(SELECT COUNT(*) FROM ("+commercialCapacityRows+"))";
export const sharedTenantCapacityCount="(SELECT COUNT(*) FROM ("+commercialCapacityRows+") WHERE tenant_id=?)";
export const sharedTenantUnknown="NOT EXISTS(SELECT 1 FROM ("+commercialCapacityRows+") WHERE tenant_id=? AND state='unknown')";
