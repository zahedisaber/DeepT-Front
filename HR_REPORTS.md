# Attendance Reports

## Release Order

1. Apply DeepT-Core's `migrations/20261111000000_hr_schedules_days_off.sql`
   after existing migrations. The migration has not been applied automatically.
2. Deploy DeepT-Core with its updated Python dependencies and HR endpoints.
3. Deploy this frontend, including `app.js` and `index.html` together.

No changes to the translation Back-End or Cloudflare relay are required.

## Office Workflow

- In Attendance, choose a staff member's expected-hours button.
- Set the schedule's effective date and hours for Saturday through Friday.
  Decimal hours are supported: 7.5 means 7 hours 30 minutes. Zero means a day off.
- Existing staff are intentionally unconfigured until the office sets a schedule;
  no arbitrary default workday or historical absence is assumed.
- New staff are taken to schedule setup after creation. Existing schedules remain
  in history; the most recent effective schedule applies on each report date.
- To stop expected hours at the end of employment, add an all-zero schedule from
  that date. Disabling the staff PIN does not rewrite historical calculations.
- Select a Persian year/month for each staff member's totals and daily details.
- Add office-wide holidays or personal leave with a reason. These are full-day
  exceptions, not partial-day leave. Official public holidays are not automatic.
- Expand staff details to see exact overtime/shortfall dates, or filter to only
  exceptions. CSV export includes all days regardless of the display filter.

## Calculation Notes

Times use Tehran's timezone, even on a Canadian computer. Absence/shortfall and
overtime are summed per day, never offset against one another across the month.
Overnight shifts are split at local midnight and overlapping punches are merged.
Recorded closed shifts count as presence, including remote shifts. Breaks only
reduce presence when staff clock out for them; there is no automatic break deduction.

Today is provisional, and future days are not charged as absence. Missing or
invalid clock-outs make the affected report incomplete: other closed presence
still appears, but affected days do not enter finalized expected/shortfall/overtime
totals. An old open shift can affect subsequent days until corrected. The UI and
CSV explicitly label these reports as incomplete. Manual clock corrections remain
available through the existing Core attendance PATCH API; this feature does not
add an attendance-correction editor.

## Verification

Run `node --check app.js` and `node --test tests/hr-report.test.cjs` with Node 22
and jsdom available on `NODE_PATH`. The tests use mocked network responses and
the actual HTML; they never create live attendance records. Install jsdom in a
separate test environment if desired; no production dependencies were added.

Browser checks should cover desktop and narrow mobile layouts, the monthly
report's horizontal table scrolling, incomplete-day warnings, staff schedule
setup, and the downloadable CSV. Apply and verify the database migration in
staging before testing against real office records.
