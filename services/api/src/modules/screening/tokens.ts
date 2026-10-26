/**
 * A6 broker token (P3-05, DESIGN.md §6.1 A6). The screening tools
 * (get_preference_snapshot / write_screening_result) are allow-listed to this
 * agent name only, in addition to the per-token tool allow-list.
 */
export const A6_BROKER_AGENT = 'A6-screening-broker';

/** ADR-0004 string token for the screening service provider. */
export const SCREENING_SERVICE = 'SCREENING_SERVICE';
