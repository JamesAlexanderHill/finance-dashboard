# Dashboard

The dashboard is the primary view of the app, showing a snapshot of your financial position alongside interactive visualizations of balance history and cash flow. It aggregates data across all accounts and instruments in the active workspace.

## Layout

The dashboard is structured as a single scrollable page with three main areas:

- **Net Worth card** — Total fiat balance in your home currency, calculated only from instruments that match your home currency code (e.g. AUD). Cross-currency holdings are excluded here to avoid unreliable conversions.
- **Balance Histogram** — A multi-view chart covering balance history, spending by category, and cash flow. Controlled by a shared date range picker and period selector (daily/weekly/monthly).
- **Account cards** — A responsive grid (1–3 columns depending on screen width) showing per-account holdings broken down by instrument, with color-coded balances.

## Balance Histogram

The balance histogram is a single component that hosts four interchangeable chart views, all sharing the same date range and period controls.

### Line / Area Chart

Shows the balance of one or more instruments over time, converted to home currency using exchange rates. Each instrument is a separate series, toggled by checkboxes in the legend.

- Smooth monotone curves (D3 `curveMonotoneX`)
- Projected balance segments (where no new activity has occurred) render as dashed lines
- A dotted zero line appears when the visible range crosses zero
- Hovering snaps to the nearest data point and shows all series values

### Stacked Area Chart

Shows the combined balance of all visible instruments, stacked by account and instrument. Useful for understanding the gross composition of your net worth over time.

**Stack modes:**

| Mode | Behavior |
|------|----------|
| `net` (default) | Debts stack below zero; assets stack upward. Shows true net position. |
| `separated` | Assets and liabilities stack independently from zero. Shows gross totals. |

Each account is assigned a base color hue (blue, emerald, amber, rose, violet, cyan, orange, fuchsia). Instruments within that account cycle through five shades of the hue, providing visual continuity.

### Category Bar Chart

Shows spending grouped by root category over time, stacked into period-bucketed bars (daily, weekly, or monthly). Income categories appear first in the legend, followed by expense categories.

- Each category is assigned a color from a 10-color rotating palette
- Bar heights represent absolute amounts (always stacked upward)
- Hovering any bar shows a tooltip with per-category amounts and direction (income or expense)

### Sankey Flow Chart

Visualizes money flowing from income sources through expense categories in a selected period. Useful for understanding where money comes from and where it goes.

- Income root categories appear on the left (green nodes)
- Expense categories expand up to four levels deep on the right
- A virtual `__income__` node consolidates multiple income roots into a single source
- A `__savings__` node appears at the bottom right when total income exceeds total expenses
- Link thickness is proportional to flow amount
- Hovering nodes or links shows aggregated values

**Period selector:** The Sankey always operates over the full selected date range; the period (daily/weekly/monthly) granularity control is disabled in this view.

## Timeline Annotations

Annotations overlay the line and stacked area charts as vertical markers or shaded bands. They are used to mark significant dates (paydays, tax events, loan payoffs, etc.).

**Types:**

| Type | Behavior |
|------|----------|
| One-time | A single vertical line at the anchor date |
| Range | A shaded band between the anchor date and an end date |
| Recurring | A vertical line repeating on a schedule from the anchor date |

**Recurrence frequencies:**

- `weekly` — every 7 days
- `fortnightly` — every 14 days
- `monthly` — same day-of-month each month (clamped to month end)
- `start_of_month` — first day of each month
- `end_of_month` — last day of each month
- `yearly` — same date annually

Annotations are workspace- and account-scoped. An annotation legend below the chart lets you toggle individual annotations on or off. Recurring annotations display their frequency in parentheses next to the label.

Rendering: lines are drawn as dashed amber vertical marks; bands are semi-transparent amber fills with dashed borders at start and end.
