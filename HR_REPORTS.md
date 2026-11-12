# HR Staff Reports

## Sample Preview

Open `/?hr-preview=1` on the Vercel preview deployment to try the interface
without logging in or changing live staff data. This mode is allowed only on
`*.vercel.app`, `localhost`, and `127.0.0.1`, and displays a permanent sample-data
banner. Browser storage is replaced with memory-only storage for that page,
and all API fetches are handled locally; unsupported operations are refused.
Sample schedules, leave, reports, HTML downloads and valid XLSX downloads are
available. Reloading without the flag leaves sample mode. Sample rows illustrate
the interface; production calculations remain the Core API's responsibility.
The preview needs no live database migration or Core deployment.

The timesheet preview also includes both employees, a Tehran-midnight boundary,
remote work, an overnight closed shift, multiple punches on one day, and an open
shift. Records are generated in the current Shamsi month (plus today's open
shift); navigating to other periods may correctly show an empty calendar.
`open_only=true` is independent of period/staff filters. All attendance requests
are still handled by the local fetch mock, without production storage or calls.

## Deployment

Apply the new Core migration `migrations/20261112000000_hr_schedule_times.sql` **before deploying Core or this frontend**. Do not rerun previously applied SQL migrations. No live migration or deployment has been performed as part of this frontend work.

The attendance calendar requires the attendance filter contract from backend
release 76 for complete overnight overlap and independent open-shift results.
An older server may ignore `overlap` and omit records starting before the queried
range. The frontend detects this and uses a warned, degraded legacy query, but
cannot guarantee recovery of long-running or paginated records. Verify release 76
against the feature deployment before production rollout; no backend files or
deployment are changed here.

## Interface

- Each roster name has a titled, labelled SVG report action (`data-hr-report-staff`). Reporting opens in `hrReportModal`, never in an all-office card. Opening HR does not open or populate the report dialog; independent monthly lookups supply calendar statuses.
- The selected employee panel has Shamsi year/month controls, six duration totals, and a daily table. The table scrolls horizontally inside the panel on mobile. Explanations and per-day reasons are collapsed.
- Daily details show scheduled start/end, actual first/last attendance, duration/target/shortfall/overtime, and separate late/early values. Positive late/early cells are highlighted regardless of whether duration was completed. Backend null punctuality values remain unavailable, not zero; provisional shortfall/overtime cells are also unavailable.
- A compact roster action opens the effective-dated schedule editor. Each Saturday-through-Friday row keeps the duration target and adds optional paired same-day start/end times. Legacy schedules retain durations without inferred timing. History is collapsed; mistaken versions can be deleted with confirmation and recreated.
- Office holidays and full-day personal leave live in a separate, initially collapsed main-page admin section. Select either the office or one employee. Its Shamsi month controls filter history independently of reports. A date and nonblank reason are required.
- The main timesheet is a Saturday-first Shamsi month/week calendar, not a raw date-range list. Previous/Today/Next, the segmented view toggle, and the all/individual staff filter do not change staff report controls. Neighbor-month cells are dimmed and included in the request. Weekly columns show full Shamsi dates, including weeks crossing a year boundary.
- Desktop month cells show at most two shift snippets; week cells show at most three. The remaining count and every day button open all actual shifts in a snippet below the calendar, not a modal. At widths up to 640px, month cells use an 84px minimum height and show only the day, a readable record-count badge and closed duration instead of tiny truncated names; full staff/shift details remain below. Hidden month chips stay in the DOM. Weekly chips show clipped Tehran start/end times separately from duration, with an end at the next day boundary shown as 24:00. Open/invalid states remain explicit. Desktop weeks fit all seven columns to the panel width; only screens up to 900px apply an 840px weekly minimum with contained horizontal scrolling. Full timestamps, remote badges, notes and clipped completed duration are available in day details. Staff names and notes are escaped.
- Closed overnight shifts are clipped to each displayed Tehran day with continuation notation. Daily closed totals merge overlapping intervals separately for each employee before summing. Individual shift details retain their own durations and can therefore sum to more than the union total. Open shifts appear only on their punch date, are unresolved, and contribute no estimated duration. Invalid/reversed records are warned about and excluded from totals; an invalid check-in cannot be assigned to a day. Empty dates never infer absence.
- Calendar refresh after clocking preserves the visible period. Calendar and present-now requests clear previous results immediately, distinguish failure from empty results, and discard late completions on navigation, filtering, view changes, leaving HR or logout via the existing `closeHrDialogs` teardown. Present-now always uses its own all-staff request, even when viewing history or filtering one employee.
- Staff filtering survives ordinary HR navigation, but resets to all staff on logout or a changed session owner (user ID/token). Old roster names/options are cleared synchronously before loading the new owner's data. Pending old roster responses are invalidated as well as attendance responses.

## API Boundary

`GET /hr/attendance?from=YYYY-MM-DD&to=YYYY-MM-DD&overlap=true`
requests the entire displayed grid (28/35/42 days for a month or Saturday-Friday
for a week). Bounds are inclusive Tehran dates, not browser-local dates. Optional
`staff_id` narrows the calendar and is also enforced locally. The response is the
existing attendance array with staff names and UTC `clock_in`/`clock_out` values.
Closed intervals ending exactly at midnight do not add a record to the next day.
Tehran day boundaries use the browser's IANA timezone data, including historical
Iran DST offsets and skipped midnight transitions, rather than the host timezone.
Union duration is floored to whole minutes per employee/day before adding employee
totals, matching backend rounding rather than pooling fractional staff minutes.

Both overlap and open-only responses must advertise `X-HR-Calendar: overlap-v1`,
and the backend CORS configuration must expose `X-HR-Calendar` to browser code.
Without that exact readable header, the calendar makes one additional legacy
request without `overlap`: `from` is the absolute UTC timestamp for Tehran
midnight one day before the visible start; `to` is the absolute UTC timestamp
for the exclusive end (midnight after the last displayed day). Both use
`new Date(hrAttendanceDayStart(iso)).toISOString()`, so old string comparisons
include the full final day and the first day's pre-UTC-midnight Tehran hours.
Client clipping removes the extra day. The persistent visible Persian warning
states that older long shifts and pagination can leave the data incomplete,
even if the returned array happens to cover every displayed day. The fallback
does not paginate or claim full coverage. Both fetch stages preserve error and
stale-response guards, and a subsequent capability-confirmed response clears the
warning. Displayed ranges remain at most 42 days, below the API's 63-day limit.

`GET /hr/attendance?open_only=true` must return only open shifts for the office,
without calendar-period or staff filters. It has its own request generation and
error state; failure means unknown current presence, not an empty office. The
frontend additionally rejects closed records from this panel.
Missing capability headers also keep an explicit old-record/pagination coverage
warning in present-now. An empty legacy response means no open shifts in the
received data, not a definitive empty office. Preview attendance responses
advertise the capability header for both query modes.

The report dialog's `GET /hr/reports/monthly?year=...&month=...&staff_id=...` is always employee-scoped, with `URLSearchParams` and Bearer authentication. The response must match the selected employee and month. Only that employee is retained even if a server accidentally returns more people. Report loading does not depend on the days-off endpoint.

Calendar classification independently requests each distinct Shamsi month covered
by the visible grid (usually two or three), using that endpoint with `staff_id`
only when the calendar is filtered. Responses are checked against their requested
year/month and locally filtered to the selected employee, visible dates and each
response's month. The date/staff map clears before navigation/refresh and shares
the attendance generation/token guards. Lookups do not delay attendance rendering
or present-now rendering. Failed/malformed lookups leave affected dates neutral
and show a small status-not-computed warning. No cache or per-shift duration
threshold is used. The sample endpoint supports unfiltered calendar lookups while
employee report dialogs/downloads still retain only their selected employee.

## Status Colors

- Finalized `absent`/`shortfall` or positive absence minutes: red. Positive finalized overtime (including worked days off): blue. Finalized `present` with positive expected minutes and exactly zero absence/overtime: green, labelled "within expected hours", never a punctuality claim.
- Unknown, future, pending, incomplete, unconfigured, explicitly non-finalized and unworked nonworking days stay neutral. Zero daily amounts are not colored as deficits/overtime. Open/invalid attendance overrides the entire employee/day's calendar color to neutral. Empty calendar dates do not invent absences.
- Chips and selected-day badges use report employee/day totals, not individual interval lengths. Overnight continuations use the clipped day's map key. Union-duration calculations, shift details and navigation are unchanged. Late/early warnings remain separately amber even when duration meets the target.
- Report daily shortfall/overtime amounts and status badges share `hr-status-shortfall`, `hr-status-overtime`, `hr-status-within`. Category totals retain red/blue even at zero. Total presence is neutral unless the report is complete and every applicable working day is within expected hours.
- Light text colors are `#b91c1c`, `#1d4ed8`, `#15803d`; dark colors are `#fca5a5`, `#93c5fd`, `#86efac`, on low-alpha backgrounds. Text labels, chip accessible descriptions and concise legends accompany colors. Downloaded HTML explicitly uses the light palette inline, independent of app theme, with escaped staff/reason content and no remote resources.

`GET /hr/reports/monthly.xlsx` uses the same query and authentication, checks the XLSX MIME type, and downloads the response blob. It is not HTML/CSV renamed as Excel. The local filename is `attendance-Y-M-safeStaffId.xlsx`. The backend owns workbook content, Persian headings, Shamsi dates, authorization, and calculations.

The separate HTML download is an escaped, standalone Persian RTL document with inline print styling and no scripts or remote resources. Reason details are expanded in this document for printing; the interactive report keeps them collapsed. Open the downloaded report in a browser to print or save as PDF. No popup is opened. Both formats contain only the selected employee.

Report request generations invalidate late responses on employee/month changes or closing. Editing the year immediately invalidates old report data. Exports are disabled while loading, failed, closed, or already exporting. A pending Excel response is rechecked against the current report generation, employee/month query, and panel visibility before creating a download. Export errors require a report refresh before retrying.

Shared view hiding, landing/admin entry, navigation away from `/hr`, and both session logout handlers close and invalidate the HR dialogs without restoring focus to the departing page. Browser Back therefore discards pending report/schedule results and Excel blob completions; returning to `/hr` opens the page without resurrecting a report. Report years are restricted to the API-supported 1300..1600 range. The independent days-off history retains its broader 1200..1600 calendar range.

Schedules use `GET/POST /hr/staff/{id}/schedules` and `DELETE /hr/staff/{id}/schedules/{scheduleId}`. POST sends:

```js
{
  effective_from: '2026-10-24', // internal ISO, never the visible picker value
  weekly_minutes: [450, 480, 480, 480, 480, 0, 0],
  weekly_start_minutes: [480, null, null, null, null, null, null],
  weekly_end_minutes: [960, null, null, null, null, null, null]
}
```

The frontend rejects unpaired times, equal/overnight windows, targets longer than the window, and times outside 00:00 through 23:59. Zero-duration days clear timings when edited and reject any subsequently supplied times. Duration targets are rounded to integer minutes. Effective dates are not rewritten by the frontend.

Days-off endpoints remain `GET /hr/days-off?from=ISO&to=ISO`, `POST /hr/days-off` with `{date, staff_id: null|id, reason}`, and `DELETE /hr/days-off/{id}`. The office-scoped list is filtered locally to the selected office/personal scope. Schedule and days-off mutations refresh a report only if the panel is visible and the affected scope matches. Clock mutations use the returned record's employee ID. Roster activation does not alter report expectations.

## Dates And Accessibility

HR date fields use the shared `toggleJalaliCalendar` / `selectJalaliDate` picker: a hidden ISO value, labelled readonly Shamsi display, and calendar inside a relative wrapper. This includes schedule effective date and manual holiday/leave date. The obsolete raw timesheet from/to fields are removed, replaced by calendar navigation. HR selection and clear dispatch `change`; work-order selection retains its previous event behavior. Defaults use Tehran's current date. Invalid dates cannot trigger an unbounded conversion loop.

Modals have labelled dialog semantics, initial focus, Tab containment, Escape/backdrop/explicit close controls, and focus return to the opening action. Calendars stay in the scroll flow instead of being clipped outside the modal. Both light and dark surfaces use established theme tokens.

## Verification

Durable isolated tests use Node's test runner and `jsdom`, without a package/build change:

```powershell
$env:NODE_PATH = 'C:\Users\Lenovo\AppData\Local\Temp\opencode\node_modules'
& 'C:\Users\Lenovo\AppData\Local\Temp\opencode\hr-status-runtime\node-v22.16.0-win-x64\node.exe' --check app.js
$env:TZ = 'America/Toronto'
& 'C:\Users\Lenovo\AppData\Local\Temp\opencode\hr-status-runtime\node-v22.16.0-win-x64\node.exe' --test tests/hr-report.test.cjs tests/hr-preview.test.cjs tests/hr-calendar.test.cjs
```

Coverage includes no automatic report dialog, accessible roster icons, selected-only/escaped reports, late/early with completed duration, null/provisional values, authenticated XLSX blob downloads and MIME rejection, stale loads/exports, picker selection/clear and work-order compatibility, legacy schedule timing arrays, schedule validation and POST arrays, independent days-off failures/personal scope, roster create/activation/deletion, scope-aware clock refreshes, report year boundaries, navigation/logout teardown, Back/Forward routing, and midflight response/blob invalidation.

The complete suite passes 47 tests, including 17 calendar tests and 11 preview
tests. Status regressions cover provisional/zero/unknown neutrality, semantic
report and standalone HTML colors, split/overnight employee/day mapping, optional
lookup failures, staff scoping, month validation and stale generations.
Calendar coverage includes Canadian host timezone, Saturday alignment,
real Jalali leap/year bounds, year-straddling weeks, full-grid queries, period
retention, delayed roster/filter selection, overnight clipping, overlap unions,
open/invalid records, bounded multi-year open shifts, more/day details, escaping,
request races/errors, present-now independence and route/logout invalidation.
Review regressions additionally verify exact legacy UTC bounds and final-day
records, missing header objects, persistent warnings with empty/nonempty legacy
results, success/error races at both fetch stages, fallback failure and teardown,
account A logout/account B filtering and stale roster rejection, direct owner
changes, and fractional-minute rounding per staff/day.
Visual-polish regressions verify month summary counts/durations, accessible count
labels, weekly clipped Tehran times including 24:00 and next-day 00:00, and
unchanged explicit open/invalid states.

The temporary `hr-status-browser.cjs` runner in the same opencode temp directory
checks exact computed status colors, selected-day badges, report categories,
independent amber timing and page overflow in Chrome at 1440 and 390 pixels in
light/dark themes. Screenshots use `hr-status-{calendar|report}-{width}-{theme}.png`.

The temporary `C:\Users\Lenovo\AppData\Local\Temp\opencode\hr-calendar-browser.cjs`
runner checks actual Chrome in both light and dark at 1440, 390 and 320 pixels,
with `America/Toronto` timezone. All six combinations pass month/day-detail clicks,
weekly columns and contained scrolling, no page overflow, preserved staff report
opening and no runtime errors. Screenshots are alongside the runner as
`hr-calendar-{month|week}-{width}-{theme}.png`. This uses local sample preview,
with every browser network request intercepted, not the deployed backend.
The same six Chrome configurations also simulate missing capability headers,
verify the timestamp fallback and warnings without overflow, preserve filtering
on same-session navigation, and reset filtering after switching office sessions.
They also assert that all seven desktop week columns fit inside the calendar
without horizontal overflow, mobile month chips/more/totals are hidden while
readable count/duration summaries remain visible in 76-90px rows, and weekly
time ranges are visible with scrolling confined to the calendar on mobile.

Mocked Chrome checks run at 1440px, 390px, and 320px (including light theme) using the temporary runner `C:\Users\Lenovo\AppData\Local\Temp\opencode\hr-staff-details-browser.cjs`. This checks real clicks, both downloads, Shamsi pickers, contained horizontal scrolling, schedule POST arrays, personal leave, report year limits, Back/Forward, direct `/hr` startup, SPA view switching, normal/admin logout, stale Excel blob completion, and runtime errors. All network traffic is intercepted; no live writes are sent. These frontend checks do not validate a real workbook's ZIP contents or a deployed backend. Validate against the backend feature deployment before release.
