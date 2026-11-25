# SEMOLINA (Σιμιγδάλι) and OUT pallet displays

## Confirmed design requirements

- SEMOLINA is a floor pallet position beside the upper-left entrance in the overview.
- It has its own screen, like a robot cell, containing SAP pallet information and the Jungheinrich interface.
- It has exactly **one OUT endpoint toward JH**, with no IN endpoint.
- A physical pickup button is the primary intended source; an HMI pickup button is also present.
- The HMI request indication must eventually follow PLC state regardless of whether the physical or HMI button caused it. The HMI cannot infer that a physical button was pressed merely from its own local button history.
- Every conveyor OUT shows a full pallet when its corresponding `Occupied` sample is valid and true. Empty positions hide the pallet. Stale/bad last-known presence is dimmed and marked uncertain; missing data is shown with `?` and is not treated as an empty position.

## Implemented HMI / offline behavior

`layout-data.json` contains 17 conveyor OUT display mappings, each checked against the actual offline DB100 manifest. They point to the exact existing station name and its `.Occupied` tag (relative bit `.1`). The inconsistent hyphenation of names such as `R1-1OUT` and `R1-3-OUT` is preserved. No IN station is used to infer full-pallet OUT presence.

The SEMOLINA overview label opens `?page=semolina`. Its screen has SSCC, material code, material description and pallet type fields for the future SAP association, plus an OUT/JH panel and pickup button. These fields are currently unknown; the screen does not reuse a global SAP reply or another cell's data as SEMOLINA data. The displayed handshake fields are a design proposal for a station-like interface, not evidence that this station already exists in DB100.

The standalone v7 preview demonstrates occupancy, uncertainty and one active pickup request. Its controls and request state exist only in the standalone preview. A preview pickup lights the SEMOLINA OUT arrow; it does **not** mean JH accepted a job or completed a pickup. Resetting the preview is not a production cancel command.

In the actual HMI, SEMOLINA data bindings and command bindings remain unset. Both HMI pickup buttons remain unavailable and send no command API request. The existing read-only driver protection remains in force. No PLC project was modified.

## Open integration decisions

1. Allocate/identify SEMOLINA's real PLC station and Jungheinrich agreement. No named SEMOLINA station was found in the available DB100 interface; no address is borrowed or invented.
2. Define the source of floor occupancy. A sensor was not specified, so the HMI must not assume that such an input exists.
3. Define how SAP identifies/correlates the pallet at this particular floor position. Current SAP/AGV buffer data are optimized DB sources; copying their offline layout offsets into an absolute S7 address is not a valid binding.
4. Define the physical button input and a separate HMI request interface, then let the PLC arbitrate both sources into one OUT request. Pulse/latch behavior, duplicate handling, permissives, reset and acknowledgement remain to be agreed; none is implemented as a PLC control sequence here.
5. Define the complete JH pickup handshake and completion/abort criterion. A request, `Occupied` transition or local preview state alone must not create a confirmed delivery event.

## Validation boundary

Static preview checks covered 1920×1080 without scrolling, all 17 OUT pallet displays, empty/stale/unknown rendering, the SEMOLINA page, one OUT endpoint and duplicate preview-request suppression. Synthetic snapshots exercised the read-only display adapter. These checks ran only the standalone HTML, without installing or running FUXA or communicating with PLC/JH.

The Windows CI browser checks were extended for the actual HMI, but have not been executed for this revision yet. Real PLC occupancy, physical-button operation, SAP correlation and JH pickup remain unverified and must be recorded separately during commissioning.
