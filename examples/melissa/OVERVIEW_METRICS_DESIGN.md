# Overview metrics · artwork review

The three counters are beside the main overview title, outside the plant SVG, so their orientation stays upright in either layout view.

| Exact display title | Intended meaning | Current standalone preview |
| --- | --- | --- |
| Σε αναμονή | Proposed scope: full pallets present on the robot conveyor OUT positions and the SEMOLINA floor position, awaiting pickup. Empty-pallet IN positions and Palomats are excluded. | Counts the synthetic Occupied states of the 17 OUT displays plus SEMOLINA. The sample is 7, all occupied is 18, and no occupied positions is 0. It is explicitly marked `preview`; stale states are labelled as old indications. |
| Σε διακίνηση AGV | Pallets handed to the AGVs that have not yet been delivered to the wrapper, following the user's clarified CPLC AGV buffer lifecycle. | `—` / no data. It is not inferred from the five illustrative pallet symbols. |
| Εντός Τυλιχτικού | Pallets within the wrapper workflow until their EIDOS printing is completed. | `—` / no data. No explanatory EIDOS subtitle is displayed, as requested. |

These are design definitions, not a claim that all source signals already exist or that physical counts have been validated. Before actual integration, confirm the waiting-count scope, the SEMOLINA occupancy source, buffer membership, wrapper delivery events and correlated EIDOS print completion. WRAP-IN Occupied alone cannot represent an arbitrary number of pallets within the wrapper workflow. Short PrintDone pulses require a reliable PLC latch/counter/event source rather than an assumed HMI polling edge.

This revision also introduces a complete light preview theme: light grey shell, white cards, pale drawing surfaces and dark labels, with sufficient contrast for selected/request arrows. Pallet colors, AGV photography and equipment artwork are retained. Robot/detail pages, Palomats, assignments, history, SEMOLINA and the EIDOS dialog use the same light theme.

Validation was limited to standalone HTML: 1920×1080 without scrolling, synthetic waiting-count changes, exact wrapper-counter wording with no EIDOS subtitle, unknown counters, navigation and visual review of normal/rotated layouts and detail screens. No FUXA build/runtime/CI or real PLC/SAP/AGV/EIDOS test was run.
