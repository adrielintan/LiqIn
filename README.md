"# LiqIn" 

A lightweight liquor inventory dashboard prototype.

## Run locally

Open [index.html](./index.html) in a browser. No build step or package installation is required.

## Included in this first slice

- Responsive dashboard with a bottle grid, search, group tabs, summary cards, and collection value.
- Add-item modal with group-specific fields for whiskey, wine, gin, rum, and tequila.
- Client-side image selection with a thumbnail preview before the item is added.
- Browser-local persistence for items and custom groups, so prototype data survives refreshes.
- A group builder supporting custom field types including text, year, date, currency, integer, decimal, single option, and multiple options."
- Group management with edit, rename, and safe deletion for empty groups.
- Group creation is opened separately from the group manager using the Add Group action below the group list.
- Structured option chips replace comma-separated option entry; multiple-option fields render as selectable checkbox groups.
- Photo selection resets between item forms and revokes temporary preview URLs to avoid showing a previous upload."
- The field builder's Add field action stays below the current field list, and previews use generated data URLs for reliable display."
- Dashboard filters support group, stock level, photo availability, and sorting.
- Inventory cards can switch between responsive grid and compact list views."
- Numeric field types omit whole number fields, support configurable decimal precision, and hide browser number steppers.
- Currency fields always use two decimal places and let each item select a currency such as USD, EUR, or IDR."
- Group fields are hidden from dashboard cards by default and can be enabled individually; enabled values appear in the configured field order.
- Field order can be changed by dragging fields in the group builder.
- Item details with custom field values, edit/delete actions, and browser-generated image thumbnails."
- JSON backup and restore controls in Settings for moving prototype data between browsers."
- Local registration and login gate the dashboard; passwords are stored only as Web Crypto hashes and sessions use session storage.
- Registration uses a username and email address; sign-in accepts either the username or email address.
- Signed-in users can change their password from Settings by confirming their current password and the new password.
- Authentication is isolated so a future OIDC provider can replace the local provider without changing inventory workflows.
