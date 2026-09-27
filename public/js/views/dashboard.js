import { get, esc, money, moneyShort, date, when, icon } from '../ui.js';
import { main, can, state, withLoc, locationName } from '../app.js';

export async function dashboard() {
  const d = await get(withLoc('/dashboard'));
  const f = d.financial;
  const occPct = d.occupancy.total ? Math.round((d.occupancy.rented / d.occupancy.total) * 100) : 0;
  const hello = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const first = (state.session.user.name || '').split(' ')[0];

  const kpis = [
    { label: 'Occupancy', value: `${occPct}%`, note: `${d.occupancy.rented} of ${d.occupancy.total} spots rented` },
  ];
  if (f) {
    kpis.push({ label: 'Collected this month', value: moneyShort(f.revenueMonth), note: `Quarter ${moneyShort(f.revenueQuarter)} · Year ${moneyShort(f.revenueYear)}` });
    kpis.push({ label: 'Outstanding', value: moneyShort(f.outstanding.c), note: `${f.outstanding.n} open invoice${f.outstanding.n === 1 ? '' : 's'}` });
    kpis.push({ label: 'Overdue', value: moneyShort(f.overdue.c), note: `${f.overdue.n} invoice${f.overdue.n === 1 ? '' : 's'} past due`, alert: f.overdue.n > 0, href: '#/invoices?overdue' });
  } else {
    kpis.push({ label: 'Active customers', value: d.customers, note: 'Current renters' });
    kpis.push({ label: 'Vacant spots', value: d.occupancy.total - d.occupancy.rented, note: 'Available now' });
    kpis.push({ label: 'Open incidents', value: d.openIncidentCount, note: 'Needing attention', alert: d.openIncidentCount > 0 });
  }

  const maxRev = f ? Math.max(1, ...f.revenueByMonth.map((m) => m.cents)) : 1;
  const monthName = (ym) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('en-US', { month: 'short' });

  main().innerHTML = `
    <div class="page-head"><div style="flex:1"><h1>${hello}${first ? ', ' + esc(first) : ''}</h1>
      <div class="muted small">${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}${locationName() ? ' · ' + esc(locationName()) : ''}</div></div>
      <div class="actions dash-actions">
        <a class="btn" href="#/customers?new">${icon.plus} Customer</a>
        <a class="btn" href="#/log?new">${icon.alert} Log incident</a>
        ${can('invoices') ? `<a class="btn primary" href="#/invoices?run">${icon.play} Run billing</a>` : ''}
      </div>
    </div>

    <div class="quick">
      <a class="btn" href="#/customers?new">${icon.plus}New customer</a>
      <a class="btn" href="#/log?new">${icon.camera}Log incident</a>
      ${can('invoices') ? `<a class="btn" href="#/invoices?run">${icon.play}Run billing</a>` : `<a class="btn" href="#/spots">${icon.grid}Spots</a>`}
    </div>

    <div class="kpis">${kpis.map((k) => `<${k.href ? `a href="${k.href}"` : 'div'} class="card kpi ${k.alert ? 'alert' : ''}" style="color:inherit">
      <div class="label">${esc(k.label)}</div><div class="value">${esc(k.value)}</div><div class="kpi-note">${esc(k.note)}</div></${k.href ? 'a' : 'div'}>`).join('')}</div>

    <div class="dash-grid">
      <div class="stack">
        ${f ? `<div class="card"><div class="card-head"><h3>Collected by month</h3><span class="muted small">Recurring ≈ ${money(f.recurringMonthly)}/mo</span></div>
          <div class="card-body">
            <div class="bars" role="img" aria-label="Payments collected per month for the last 12 months">
              ${f.revenueByMonth.map((m, i) => `<div class="bar ${i === 11 ? 'now' : ''}" title="${monthName(m.month)}: ${money(m.cents)}"><i style="height:${Math.round((m.cents / maxRev) * 100)}%"></i></div>`).join('')}
            </div>
            <div class="bar-labels">${f.revenueByMonth.map((m) => `<span>${monthName(m.month).slice(0, 3)}</span>`).join('')}</div>
          </div></div>` : ''}

        ${f ? `<div class="card"><div class="card-head"><h3>Overdue invoices</h3><a class="small" href="#/invoices?overdue">See all</a></div>
          <ul class="list">${f.overdueList.length ? f.overdueList.map((i) => `<li><a class="item" href="#/invoices?open=${i.id}">
            <div class="main"><div class="title">${esc(i.customer_name)}</div><div class="sub">${esc(i.number)} · due ${date(i.due_date)}</div></div>
            <div class="end num"><b>${money(i.total_cents)}</b></div></a></li>`).join('') : '<li class="empty">Nothing overdue. Nice.</li>'}</ul></div>` : ''}

        <div class="card"><div class="card-head"><h3>Occupancy by building</h3><a class="small" href="#/spots">Spots board</a></div>
          <div class="card-body stack" style="gap:14px">
            ${d.occupancy.byBuilding.length ? d.occupancy.byBuilding.map((b) => `<div>
              <div class="spread small" style="margin-bottom:6px"><b>${esc(b.name)}</b><span class="muted num">${b.rented || 0} / ${b.total} rented</span></div>
              <div class="meter"><i style="width:${b.total ? Math.round(((b.rented || 0) / b.total) * 100) : 0}%"></i></div></div>`).join('')
              : `<div class="muted">No buildings yet. ${can('setup') ? '<a href="#/setup/spots">Add buildings and spots</a>.' : ''}</div>`}
          </div></div>
      </div>

      <div class="stack">
        ${f ? `<div class="card pad"><div class="spread"><div><h3>Billing</h3><div class="muted small">${f.upcomingBilling} rental${f.upcomingBilling === 1 ? '' : 's'} due to bill in the next 30 days · ${f.drafts} draft${f.drafts === 1 ? '' : 's'} waiting</div></div>
          <a class="btn sm" href="#/invoices">${icon.invoice} Open</a></div></div>` : ''}

        <div class="card"><ul class="list">
          <li><a class="item" href="#/waitlist"><span style="color:var(--brand);width:22px">${icon.clock}</span><div class="main"><div class="title">Waitlist</div><div class="sub">${d.waitlist ? `${d.waitlist} ${d.waitlist === 1 ? 'person' : 'people'} waiting for a spot` : 'Nobody waiting'}</div></div>${icon.chevron.replace('<svg', '<svg class="chev"')}</a></li>
          ${d.agreementsPending.length ? d.agreementsPending.map((a) => `<li><a class="item" href="#/customers/${a.customer_id}"><span style="color:var(--warn);width:22px">${icon.pen}</span>
            <div class="main"><div class="title">${esc(a.customer_name)}</div><div class="sub">Agreement sent ${when(a.sent_at)}, not signed yet</div></div></a></li>`).join('') : ''}
          ${can('invoices') ? `<li><a class="item" href="#/invoices?reminders"><span style="color:var(--brand);width:22px">${icon.bell}</span><div class="main"><div class="title">Reminders</div>
            <div class="sub">${state.session.features.reminders ? `${d.remindersWeek} sent in the last 7 days` : 'Automatic reminders are off'}</div></div>${icon.chevron.replace('<svg', '<svg class="chev"')}</a></li>` : ''}
        </ul></div>

        <div class="card"><div class="card-head"><h3>Open incidents</h3><a class="small" href="#/log">Log</a></div>
          <ul class="list">${d.openIncidents.length ? d.openIncidents.map((i) => `<li><a class="item" href="#/log/${i.id}">
            <div class="main"><div class="title">${esc(i.title)}</div><div class="sub">${date(i.occurred_on)}${i.spot_label ? ' · Spot ' + esc(i.spot_label) : ''}</div></div>
            <span class="badge ${i.category === 'incident' ? 'warn' : ''}">${esc(i.category)}</span></a></li>`).join('') : '<li class="empty">No open incidents.</li>'}</ul></div>

        ${d.insuranceExpiring.length ? `<div class="card"><div class="card-head"><h3>Insurance expiring (30 days)</h3></div>
          <ul class="list">${d.insuranceExpiring.map((b) => `<li><a class="item" href="#/customers/${b.customer_id}">
            <div class="main"><div class="title">${esc(b.customer_name)}</div><div class="sub">${esc([b.name, b.make].filter(Boolean).join(' · '))}</div></div>
            <span class="badge ${b.insurance_expires < d.today ? 'bad' : 'warn'}">${date(b.insurance_expires)}</span></a></li>`).join('')}</ul></div>` : ''}

        ${d.endingSoon.length ? `<div class="card"><div class="card-head"><h3>Rentals ending soon</h3></div>
          <ul class="list">${d.endingSoon.map((k) => `<li><a class="item" href="#/customers/${k.customer_id}">
            <div class="main"><div class="title">${esc(k.customer_name)}</div><div class="sub">${k.spot_label ? 'Spot ' + esc(k.spot_label) : ''}</div></div>
            <span class="badge warn">${date(k.end_date)}</span></a></li>`).join('')}</ul></div>` : ''}

        <div class="card"><div class="card-head"><h3>Recent activity</h3></div>
          <ul class="list">${d.activity.length ? d.activity.map((a) => `<li><${a.customer_id ? `a href="#/customers/${a.customer_id}"` : 'div'} class="item">
            <div class="main"><div class="title" style="font-weight:500">${esc(a.message)}</div>
            <div class="sub">${a.customer_name ? esc(a.customer_name) + ' · ' : ''}${when(a.created_at)}</div></div></${a.customer_id ? 'a' : 'div'}></li>`).join('') : '<li class="empty">Nothing yet.</li>'}</ul></div>
      </div>
    </div>`;
}
