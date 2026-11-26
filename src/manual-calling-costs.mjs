// Versioned planning rates, not account-specific invoices. A manually copied
// available balance is the authority at each sync; between syncs this app uses
// these estimates and retains outstanding/unknown call reservations.
// Sources checked 2026-11-26:
// https://www.plivo.com/voice/pricing/in/ (IN domestic .38/min, 30-second pulse)
// https://docs.sarvam.ai/api/getting-started/pricing (.49/min STT, 10/25 per 1M tokens)
// Include an 18% tax allowance in estimates; never post it as an actual invoice.
export const MANUAL_CALLING_COSTS=Object.freeze({
 version:'in-domestic-2026-11-26',currency:'INR',pulseSeconds:30,
 plivoPulseMicros:224200,sarvamPulseMicros:306800,
 sttMinuteMicros:490000,llmInputTokenMicros:10,llmOutputTokenMicros:25,
 taxNumerator:118,taxDenominator:100,
 basis:'published_rates_with_tax_and_llm_allowance',actualProviderTariffVerified:false
});
