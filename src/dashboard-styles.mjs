export const css = `
:root {
  font: 15px/1.55 Inter, ui-sans-serif, system-ui, sans-serif;
  color: #1d2940;
  background: #f2f5f9;
  font-synthesis: none;
  --accent: #2658bc;
  --line: #d6dfeb;
  --muted: #50617a;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; min-height: 100vh; }
button, input, select, textarea { font: inherit; }
button, summary { cursor: pointer; }
a { color: var(--accent); }
p { margin: 0; }
h1, h2, h3 { color: #17243c; line-height: 1.2; margin: 0 0 12px; }
h1 { font-size: clamp(30px, 4vw, 43px); font-weight: 750; letter-spacing: -.045em; }
h2 { font-size: 21px; font-weight: 720; letter-spacing: -.025em; }
h3 { font-size: 17px; font-weight: 700; }
h2, h3 { display: flex; align-items: center; gap: 9px; }
h1 > .icon { display: none; }
h2 > .icon, h3 > .icon { color: #3963a6; }
.layout { display: grid; grid-template-columns: 236px minmax(0, 1fr); min-height: 100vh; }
.sidebar {
  position: sticky; top: 0; align-self: start; height: 100dvh; min-width: 0;
  display: flex; flex-direction: column; gap: 32px; overflow: auto;
  background: #14243c; color: #dce7f7; padding: 25px 18px 18px;
}
.brand { display: flex; align-items: center; gap: 11px; padding: 0 5px; line-height: 1.2; }
.brand strong { color: white; font-size: 20px; letter-spacing: -.035em; }
.brand small { display: block; margin-top: 5px; color: #b0c5e0; font-size: 12px; }
.brand-mark {
  display: grid; place-items: center; width: 42px; height: 42px;
  border-radius: 12px; background: #3772d4; color: white;
}
.brand-mark .icon { width: 21px; height: 21px; }
.workspace-nav { display: grid; gap: 5px; }
.navitem {
  display: flex; align-items: center; gap: 11px; padding: 10px 12px; min-height: 44px;
  text-decoration: none; color: #c6d6eb; border: 1px solid transparent;
  border-radius: 9px; font-size: 14px; font-weight: 620;
}
.navitem:hover { background: #203552; color: #fff; }
.navitem[aria-current=page] { background: #294b77; color: #fff; border-color: #4773a8; }
.sidebar-footer {
  margin-top: auto; border-top: 1px solid #314461; padding: 15px 3px 0;
  display: grid; gap: 8px;
}
.account { display: flex; gap: 9px; align-items: center; min-width: 0; }
.avatar {
  display: grid; place-items: center; width: 34px; height: 34px;
  flex: 0 0 auto; border-radius: 50%; background: #263d5e; color: #d7e6fb;
  font-size: 12px; font-weight: 700;
}
.account-copy { min-width: 0; overflow-wrap: anywhere; font-size: 12px; color: #d5e2f4; }
.sidebar-footer .btn.secondary {
  justify-self: start; background: transparent; color: #dce7f7; border-color: transparent; padding-inline: 4px;
}
.sidebar-footer .btn.secondary:hover { color: white; background: #203552; }
.main { width: 100%; min-width: 0; max-width: 1450px; margin: 0 auto; padding: 34px clamp(20px, 4.2vw, 64px) 48px; }
.topbar { margin-bottom: 23px; }
.topbar h1 { margin-bottom: 7px; }
.topbar h1:focus { outline: none; }
.workspace-role {
  font-size: 13px; font-weight: 720; color: #285caa; margin-bottom: 8px;
}
.page-description, .muted { color: var(--muted); font-size: 14px; }
.workspace-section, .client-content { min-width: 0; }
.company-context { margin: -6px 0 16px; color: #405575; font-weight: 650; }
.company-switch { width: min(100%, 360px); margin-bottom: 16px; }
.client-summary { border-top: 3px solid #3975d4; }
.wallet-metrics { grid-template-columns: repeat(auto-fit,minmax(156px,1fr)); }
.wallet-metrics .metric strong { font-variant-numeric: tabular-nums; font-size: 23px; overflow-wrap:anywhere; }
.wallet-metrics .metric p { font-size: 12px; margin-top: 5px; }
.minute-wallet { margin-top: 18px; }
.minute-wallet h3 { margin-top: 12px; }
.client-summary .row { min-width: 0; }
.client-company-name { display: block; color: #284268; font-size: 16px; overflow-wrap: anywhere; }
.client-metrics { margin-top: 17px; margin-bottom: 11px; }
.client-metrics .metric { min-width: 0; }
.client-summary > .muted { font-size: 12px; }
.card {
  background: #fff; border: 1px solid var(--line); border-radius: 13px;
  padding: clamp(16px, 2.6vw, 27px); margin: 0 0 16px;
  min-width: 0; box-shadow: 0 2px 5px #182c4710;
}
.card > .card { margin-top: 15px; box-shadow: none; }
.cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 11px; margin: 0 0 16px; }
.metric { position: relative; margin: 0; padding: 14px 16px; background: #f7faff; box-shadow: none; }
.metric strong { display: block; margin-top: 3px; font-size: 25px; letter-spacing: -.04em; }
.metric-symbol { position: absolute; right: 14px; top: 14px; color: #3765ad; }
.icon {
  width: 18px; height: 18px; flex-shrink: 0; fill: none; stroke: currentColor;
  stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;
}
.label { display: block; color: #324664; font-size: 13px; font-weight: 680; margin: 0 0 6px; }
.field {
  width: 100%; min-width: 0; min-height: 44px; padding: 9px 11px;
  border: 1px solid #bccbdd; border-radius: 8px; background: #fcfdff; color: #17243c;
}
.field::placeholder { color: #596e87; }
.field:focus { border-color: #3d72c8; }
textarea.field { min-height: 84px; resize: vertical; }
input[type=file] { padding: 6px 8px; }
input[type=file]::file-selector-button { border: 0; border-radius: 5px; background: #e8f0fd; padding: 4px 9px; color: #254f93; margin-right: 8px; }
input[type=checkbox] { accent-color: var(--accent); width: 17px; height: 17px; flex-shrink: 0; vertical-align: middle; }
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 42px;
  padding: 9px 14px; border: 1px solid transparent; border-radius: 8px;
  background: var(--accent); color: white; font-size: 14px; font-weight: 670; line-height: 1.35;
}
.btn:hover { background: #19489f; }
.btn .icon { width: 16px; height: 16px; }
.btn.secondary { background: white; color: #2f4b71; border-color: #bfcde0; }
.btn.secondary:hover { background: #edf4ff; }
.btn:disabled { opacity: .52; cursor: not-allowed; }
:focus-visible { outline: 3px solid #78a8fa; outline-offset: 2px; }
.stack { display: grid; gap: 12px; min-width: 0; }
.stack > .btn { justify-self: start; }
.formrow, .row { display: flex; flex-wrap: wrap; gap: 11px; align-items: center; }
.formrow { align-items: flex-end; margin: 10px 0; }
.formrow > label { flex: 1 1 150px; min-width: 0; }
.between { justify-content: space-between; }
.tablewrap { overflow: auto; max-width: 100%; border: 1px solid var(--line); border-radius: 9px; margin: 11px 0; }
.table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }
.table th, .table td { padding: 10px 12px; border-bottom: 1px solid #e3ebf4; overflow-wrap: normal; }
.table th { color: #476080; background: #f1f5fb; font-weight: 680; }
.table td:first-child { color: #1e3554; font-weight: 650; }
.table tbody tr:last-child td { border-bottom: 0; }
.table tbody tr:hover { background: #f6faff; }
#client-reports .table { min-width: 610px; }
#customer-workflow .table { min-width: 720px; }
#customer-workflow .table td:nth-child(2), .table .btn { white-space: nowrap; }
.answer-sheet { background: #edf4ff; border: 1px solid #cfdced; border-radius: 9px; padding: 14px; margin: 12px 0 18px; }
.answer-sheet h3 { margin: 0; }
.answer-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 128px), 1fr)); gap: 10px; margin-bottom: 0; }
.answer-fields dt { color: var(--muted); font-size: 12px; font-weight: 670; }
.answer-fields dd { margin: 2px 0 0; font-weight: 650; overflow-wrap: anywhere; }
.empty-state { color: var(--muted); text-align: center; padding: 24px !important; }
.badge, .pill {
  display: inline-flex; border-radius: 6px; padding: 3px 8px; font-size: 12px; font-weight: 670;
  background: #edf1f6; color: #425674; white-space: nowrap;
}
.badge.positive, .pill { color: #1a684f; background: #e1f4eb; }
.badge.pending { color: #78501c; background: #fff2d8; }
.badge.negative { color: #a33438; background: #fbeaec; }
.note, .banner {
  padding: 10px 13px; border: 1px solid #cfdced; border-radius: 8px;
  font-size: 14px; overflow-wrap: anywhere; margin: 0 0 11px;
}
.note { color: #334e73; background: #edf4ff; }
.ready-note, .banner { background: #edf8f2; color: #1b634d; border-color: #c0e3d3; }
.err { color: #a33438; }
.banner.err { background: #fff1f1; color: #973035; border-color: #f0ccd0; }
.success { color: #1b634d; }
details > summary { font-weight: 690; color: #273d60; }
details[open] > summary { margin-bottom: 14px; }
.approval-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); align-items: start; gap: 18px; margin-top: 18px; }
.approval-grid > form { border: 1px solid var(--line); padding: 15px; border-radius: 10px; }
.approval-grid > div { grid-column: 1/-1; }
.approval-list { max-height: 200px; overflow: auto; padding: 9px 12px; border: 1px solid var(--line); border-radius: 8px; }
.approval-list:empty { display: none; }
.approval-list label { display: flex; flex-direction: row-reverse; justify-content: flex-end; gap: 7px; align-items: center; }
.approval-list .label { margin: 0; }
.campaign-info { border: 1px solid var(--line); border-radius: 9px; background: #f7faff; padding: 11px 13px; margin-bottom: 14px; }
.import-card { border-top: 3px solid #3975d4; }
.import-card > .btn { margin: 11px 0 3px; }
.auth {
  min-height: 100vh; display: grid; place-items: center; padding: 20px;
  background: radial-gradient(ellipse at top, #d9e9fd, transparent 65%), #f2f5f9;
}
.auth .card { width: min(420px, 100%); padding: 27px; box-shadow: 0 12px 40px #17335b17; }
.auth h1 { font-size: 28px; }
.auth .stack { margin-top: 15px; }
.auth .stack > .btn { justify-self: stretch; }
.foot { margin-top: 15px; color: var(--muted); font-size: 12px; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; }

@media(max-width: 900px) {
  .layout { grid-template-columns: 188px minmax(0, 1fr); }
  .sidebar { padding-inline: 12px; }
  .approval-grid { grid-template-columns: minmax(0, 1fr); }
}
@media(max-width: 650px) {
  .client-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; }
  .client-metrics .metric { padding: 12px 9px; }
  .client-metrics .metric .metric-symbol { display: none; }
  .client-metrics .metric strong { font-size: 23px; }
  .client-metrics .metric .muted { font-size: 11px; }
  .layout { display: block; }
  .sidebar { position: relative; height: auto; overflow: visible; gap: 12px; padding: 13px 14px; }
  .workspace-nav { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; }
  .navitem { padding: 8px; gap: 7px; font-size: 13px; }
  .sidebar-footer { display: flex; align-items: center; justify-content: space-between; padding-top: 6px; }
  .sidebar-footer .btn { min-height: 38px; white-space: nowrap; }
  .main { padding: 22px 13px 34px; }
  .topbar { margin-bottom: 16px; }
  .cards { gap: 7px; }
  .metric { padding: 9px; }
  .metric .muted { font-size: 12px; }
  .metric-symbol { display: none; }
  .formrow > label { flex-basis: 128px; }
  .import-card .formrow:first-of-type > label { flex-basis: 100%; }
}
`;
