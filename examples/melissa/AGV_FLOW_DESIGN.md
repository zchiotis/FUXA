# AGV assignment and delivery screens · artwork review

The user clarified these meanings on 2026-11-22. They supersede the earlier preview wording about a history of deliveries *to* the AGV provider.

## Operator-facing language

- Use **AGV**, not the provider abbreviation, throughout the preview: navigation, robot handshakes, SEMOLINA, headings, buttons, diagrams, tooltips and accessibility labels.
- **Αναθέσεις στα AGV** is the list of pallets already handed to the AGVs and not yet returned to the wrapper (Τυλιχτικό).
- **Ιστορικό παραδόσεων AGV** contains every pallet delivered to the wrapper. The completion point is delivery **at the wrapper**, not pickup at a robot, assignment creation or acceptance by the AGV system.
- `AGVBuffer_DB` remains the technical CPLC source name. It is not the operator-facing screen title. Existing route IDs `buffer` and `deliveries` remain stable.

The assignment screen explains that pallets remain outstanding until delivery to the wrapper. The history screen explains its wrapper-delivery boundary. Neither screen fabricates sample records or timestamps.

## Overview illustration

The assignment area is one button containing exactly **five pallet illustrations and one AGV**, following the user-supplied AGV photograph. The AGV is shown with the tall navigation assembly, tiller, yellow traction unit, rear mast and right-facing forks. These are illustrative symbols, not a live pallet count, physical storage plan or a particular identified truck.

The five Palomat entities remain separate. SEMOLINA retains its single OUT toward AGV, own screen and preview request control.

## Deferred until artwork/layout approval and explicit build instruction

This revision changes preview artwork and labels only. No FUXA build, runtime installation/test, workflow run, backend database migration or PLC operation is part of this revision.

At implementation time:

1. Apply the approved labels to the FUXA navigation and runtime screen catalog.
2. Bind outstanding assignments to the real CPLC AGV buffer and verify its membership/lifecycle against actual PLC data. Assignment timestamps are not established merely by a buffer slot number.
3. Define the real, correlated confirmation that a particular pallet arrived at the wrapper. Use it to append one delivery event per actual delivery and remove the pallet from the outstanding assignment view.
4. Do not infer completion from a disappearing buffer record, an `AGVRequest` edge, an `Occupied` transition or an HMI click alone.
5. Review the existing delivery-history scaffold before wiring this definition. Existing rows with other semantics must not be silently relabelled as completed wrapper deliveries.
6. Preserve a boundary between preview checks, FUXA/CI checks and validation with real PLC/SAP/AGV events.

Only lightweight static generation, JavaScript parsing and SVG rendering are used for this artwork review. No new FUXA functional or PLC validation is claimed.
