# XKeen UI v0.4.3

DNS setting labels and their help icons now stay on one line. Resolver text areas grow to show all configured lines, so a typical Nameserver list is visible without an inner scrollbar. The DNS handoff explanation sits beside its switch, and active status values plus `mihomo` use a restrained violet outline.

The journal toolbar no longer includes copy or download actions. Clear and fullscreen buttons share consistent dimensions and alignment, clearing is easier to identify, and the journal can expand to the full screen or close with Escape. Journal text contrast and readability have also been improved.

Validation: 216 frontend tests, typecheck, production build, backend tests, installer checks, and Linux AArch64 build passed. The interface was not tested against a live router.
