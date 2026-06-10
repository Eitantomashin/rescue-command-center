# RCC Dashboard Views Proposal

Dashboard data must be calculated from source tables only.

## Views generated

### `person_status_counts`

Counts persons by:

- Incident
- Site
- Current status

Rules:

- Merged persons are excluded.
- Duplicate/cancelled records are excluded.
- Status metadata is included for display and grouping.

### `incident_dashboard_summary`

Incident-level operational summary:

- Incident details
- Total sites
- Total initial potential
- Total updated potential
- Resolved persons
- Operational gap
- Total teams
- Active teams
- Available teams
- Active site assignments

Operational gap:

```text
Updated Potential - Resolved Persons
```

Resolved persons are persons whose status is:

- dashboard counted
- not open
- not duplicate/cancelled
- not merged

### `site_dashboard_summary`

Site-level operational summary:

- Site details
- Site status
- Initial potential
- Updated potential
- Active units
- Fully cleared units
- Open units
- Total persons
- Open persons
- Resolved persons
- Operational gap

### `recent_event_logs`

Convenience view for latest activity displays.

Includes related:

- Site number
- Operational number
- Team number

## Future dashboard additions

- Materialized views may be considered only if performance requires it.
- Real-time dashboard updates should subscribe to source table changes, not store dashboard state.
- Per-status Hebrew dashboard labels should continue to come from `status_types`.
