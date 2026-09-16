# Planner list controls

The Planner list view supports instant client-side search and filtering across the publications already loaded for the active account/workspace.

Controls:
- full-text search across publication text, account name/handle, network, status and formatted date;
- status filter: all, published, scheduled, draft, failed;
- network filter: Facebook, Instagram, LinkedIn, YouTube, TikTok;
- period filter: all dates, 7/30/90 days, current year;
- sorting: newest, oldest, title A-Z/Z-A, network, status;
- result count and one-click reset.

No extra API request is issued while typing or changing filters, so filtering remains immediate and does not add load to provider APIs.
