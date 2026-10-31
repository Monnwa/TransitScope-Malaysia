# Accessibility and HCI inspection

Inspection performed during implementation, before participant testing.

| Check | Finding | Evidence / next action |
| --- | --- | --- |
| Text contrast | Pass by visual inspection for primary text on white and blue status colours. | Perform automated contrast audit before release. |
| Keyboard navigation | Implemented. | Native controls, skip link and visible focus outline. Test manually in deployed browser. |
| Accessible labels | Implemented for search, settings, map and alert close controls. | Screen-reader testing remains pending. |
| Feedback | Implemented. | `aria-live` status describes searches, selection and resets. |
| Consistency | Implemented. | Shared filter pattern and data-mode badge. |
| Error recovery | Implemented. | Empty state offers Restore defaults. |
| Responsive behaviour | CSS breakpoints implemented. | Desktop/tablet/mobile browser checks remain pending. |

This inspection does not establish WCAG 2.2 conformance.
