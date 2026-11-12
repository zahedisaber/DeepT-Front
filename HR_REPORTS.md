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

## Deployment

Apply the new Core migration `migrations/20261112000000_hr_schedule_times.sql` **before deploying Core or this frontend**. Do not rerun previously applied SQL migrations. No live migration or deployment has been performed as part of this frontend work.

## Interface

- Each roster name has a titled, labelled SVG report action (`data-hr-report-staff`). Reporting opens in `hrReportModal`, never in an all-office card. Opening the HR page does not request a report.
- The selected employee panel has Shamsi year/month controls, six duration totals, and a daily table. The table scrolls horizontally inside the panel on mobile. Explanations and per-day reasons are collapsed.
- Daily details show scheduled start/end, actual first/last attendance, duration/target/shortfall/overtime, and separate late/early values. Positive late/early cells are highlighted regardless of whether duration was completed. Backend null punctuality values remain unavailable, not zero; provisional shortfall/overtime cells are also unavailable.
- A compact roster action opens the effective-dated schedule editor. Each Saturday-through-Friday row keeps the duration target and adds optional paired same-day start/end times. Legacy schedules retain durations without inferred timing. History is collapsed; mistaken versions can be deleted with confirmation and recreated.
- Office holidays and full-day personal leave live in a separate, initially collapsed main-page admin section. Select either the office or one employee. Its Shamsi month controls filter history independently of reports. A date and nonblank reason are required.

## API Boundary

`GET /hr/reports/monthly?year=...&month=...&staff_id=...` is always employee-scoped, with `URLSearchParams` and Bearer authentication. The response must match the selected employee and month. Only that employee is retained even if a server accidentally returns more people. Report loading does not depend on the days-off endpoint.

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

All HR date fields use the shared `toggleJalaliCalendar` / `selectJalaliDate` picker: a hidden ISO value, labelled readonly Shamsi display, and calendar inside a relative wrapper. This includes both raw timesheet filters, schedule effective date, and manual holiday/leave date. HR selection and clear dispatch `change`; work-order selection retains its previous event behavior. Defaults use Tehran's current date. Invalid dates cannot trigger an unbounded conversion loop.

Modals have labelled dialog semantics, initial focus, Tab containment, Escape/backdrop/explicit close controls, and focus return to the opening action. Calendars stay in the scroll flow instead of being clipped outside the modal. Both light and dark surfaces use established theme tokens.

## Verification

Durable isolated tests use Node's test runner and `jsdom`, without a package/build change:

```powershell
$env:NODE_PATH = 'C:\Users\Lenovo\AppData\Local\Temp\opencode\node_modules'
& 'C:\Users\Lenovo\AppData\Local\Temp\opencode\node-v22.16.0-win-x64\node.exe' --check app.js
& 'C:\Users\Lenovo\AppData\Local\Temp\opencode\node-v22.16.0-win-x64\node.exe' --test tests/hr-report.test.cjs
```

Coverage includes no main-page report fetch, accessible roster icons, selected-only/escaped reports, late/early with completed duration, null/provisional values, authenticated XLSX blob downloads and MIME rejection, stale loads/exports, picker selection/clear and work-order compatibility, legacy schedule timing arrays, schedule validation and POST arrays, independent days-off failures/personal scope, roster create/activation/deletion, scope-aware clock refreshes, report year boundaries, navigation/logout teardown, Back/Forward routing, and midflight response/blob invalidation.

Mocked Chrome checks run at 1440px, 390px, and 320px (including light theme) using the temporary runner `C:\Users\Lenovo\AppData\Local\Temp\opencode\hr-staff-details-browser.cjs`. This checks real clicks, both downloads, Shamsi pickers, contained horizontal scrolling, schedule POST arrays, personal leave, report year limits, Back/Forward, direct `/hr` startup, SPA view switching, normal/admin logout, stale Excel blob completion, and runtime errors. All network traffic is intercepted; no live writes are sent. These frontend checks do not validate a real workbook's ZIP contents or a deployed backend. Validate against the backend feature deployment before release.
