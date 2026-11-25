/** Shared look of the citizen screens (home, notices, buoy explainer, my reports). */
export const citizenStyles = `
  :host { display: block; }
  .cz { max-width: 640px; margin: 0 auto; display: flex; flex-direction: column; gap: .9rem; }
  .cz h2 { font-size: 1.05rem; font-weight: 750; margin: 0; }
  .cz p { margin: 0; }

  .motto { display: flex; gap: .65rem; align-items: flex-start; padding: .8rem 1rem; border-radius: 16px; background: linear-gradient(135deg, #e6f8fc, #e4f3ec); color: #0b4f5f; font-size: .95rem; font-weight: 650; line-height: 1.4; }
  .motto i { color: #00b4d8; font-size: 1rem; margin-top: .2rem; }

  .banner, .learn { display: flex; align-items: center; gap: .8rem; text-decoration: none; color: var(--atl-ink); }
  .banner { padding: .85rem 1rem; border-radius: 16px; background: #fcefc7; color: #7a4a05; }
  .banner.crit { background: #fbdcdc; color: #8f1616; }
  .banner > i:first-child { font-size: 1.35rem; }
  .banner span, .learn span { flex: 1; display: flex; flex-direction: column; gap: .1rem; min-width: 0; }
  .banner small, .learn small { font-size: .8rem; opacity: .85; }

  .cta { display: flex; flex-direction: column; gap: .9rem; border-radius: 20px; background: var(--atl-ink); border-color: var(--atl-ink); color: #fff; padding: 1.2rem; }
  .cta p { color: #c8d3e3; font-size: .9rem; margin-top: .3rem; }

  .zones { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .zones li { display: flex; align-items: center; gap: .75rem; padding: .7rem 0; border-bottom: 1px dashed var(--rm-border); }
  .zones li:last-child { border-bottom: 0; }
  .zones li > div { flex: 1; min-width: 0; }
  .zones strong { display: block; font-size: .92rem; }
  .zones p { font-size: .82rem; color: var(--rm-muted); }
  .light { flex: none; width: .85rem; height: .85rem; border-radius: 50%; box-shadow: 0 0 0 3px rgb(0 0 0 / .05); }
  .tag { flex: none; padding: .15rem .6rem; border-radius: 999px; font-size: .74rem; font-weight: 700; }
  .foot { font-size: .74rem; color: var(--rm-muted); margin-top: .5rem !important; }

  .more { display: inline-flex; align-items: center; gap: .35rem; margin-top: .7rem; color: #0077b6; font-weight: 650; font-size: .88rem; text-decoration: none; }
  .chips { display: flex; flex-wrap: wrap; gap: .4rem; }
  .chip { padding: .3rem .75rem; border-radius: 999px; background: #e6f8fc; color: #005f7a; font-weight: 700; font-size: .82rem; text-decoration: none; font-variant-numeric: tabular-nums; }

  .learn { border-radius: 16px; }
  .learn > i:first-child { display: grid; place-items: center; width: 2.6rem; height: 2.6rem; border-radius: 12px; background: #e6f8fc; color: #0077b6; font-size: 1.2rem; }

  .empty { display: flex; flex-direction: column; align-items: center; gap: .6rem; }
  .staff { text-align: center; font-size: .82rem; color: var(--rm-muted); padding: .4rem 0 .2rem; }
  .staff a { color: var(--atl-ink); font-weight: 700; }
  .link { border: 0; background: none; padding: 0; color: #0077b6; font: inherit; font-weight: 650; cursor: pointer; text-decoration: underline; }

  .notice { display: flex; flex-direction: column; gap: .45rem; border-left: 5px solid #d97706; border-radius: 14px; }
  .notice.crit { border-left-color: #dc2626; }
  .notice .top { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; font-size: .8rem; color: var(--rm-muted); }
  .notice .lvl { padding: .1rem .55rem; border-radius: 999px; background: #fcefc7; color: #7a4a05; font-weight: 700; font-size: .72rem; }
  .notice.crit .lvl { background: #fbdcdc; color: #8f1616; }
  .notice h2 { display: flex; align-items: center; gap: .45rem; }
  .notice .advice { display: flex; gap: .5rem; padding: .55rem .7rem; border-radius: 10px; background: #f1f5f9; font-size: .86rem; font-weight: 600; }

  .steps { list-style: none; margin: 0; padding: 0; display: grid; gap: .8rem; counter-reset: s; }
  .steps li { display: grid; grid-template-columns: 2.2rem 1fr; gap: .7rem; align-items: start; }
  .steps li::before { counter-increment: s; content: counter(s); display: grid; place-items: center; width: 2.2rem; height: 2.2rem; border-radius: 50%; background: var(--atl-blue); color: #0d1b2a; font-weight: 800; }
  .steps strong { display: block; font-size: .95rem; }
  .steps p { font-size: .86rem; color: var(--rm-muted); }
`;
