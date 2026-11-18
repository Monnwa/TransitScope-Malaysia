# Desktop-first Preview release

This Preview targets desktop web use at 1101 × 830. Hosted desktop acceptance is required; this note alone does not claim acceptance.

Mobile 375 × 844 has a known KL Sentral Rail Popup Renderer Stall. Mobile 390 × 844 is not a release acceptance requirement. Mobile working acceptance is not claimed. The user explicitly waived mobile acceptance for this desktop-first Preview in K.5F.3B.2E-R4.

The issue is associated with inherited Rail geometry/CSS MutationObserver feedback. A3 and R2 both reproduced the desktop stall 6/6 in matched trials. R3 actual-displacement bookkeeping removed the sampled desktop reproduction but was insufficient for mobile. The complete mobile numeric/animation correction remains unresolved. No further mobile investigation or source remediation is included in this release.

B08, B11 and B12 remain unchanged, visible known contract-conflict test failures. Native popup anchor authority is preserved; marker or record coordinate fallback is not implemented.

This authorization covers Preview only. It does not authorize Production deployment, promotion, master merge/push, Vercel settings/environment/domain changes, AWS changes or live transit feed activation.
