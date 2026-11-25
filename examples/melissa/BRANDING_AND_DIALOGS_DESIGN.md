# Branding, Barcode and Palomat dialogs · preview v13

- The upper-left FUXA / MELISSA text is replaced by the supplied Condor Robotics logo. `graphics/Condor_Robotics.svg` and the shared `public/graphics/condor-robotics.svg` contain vector outlines only, with transparent negative space and the source brand blue `#2354a0`. They contain no embedded PNG and require no installed logo font. The source PNG was read without modification.
- Palomat overview controls and the sidebar Palomats entry open a modal instead of navigating to a separate detail screen. The modal offers Palomat 5–4–3–2–1 selection, the correct supplied pallet-family artwork, and Κατάσταση / Παλέτες / Συμβάντα tabs. Unknown operational values remain unknown, with no command or PLC operation added.
- The operator-facing EIDOS name is now **Barcode**, with a vector barcode-label icon on the layout and dialog. Existing internal `eidos` route/endpoint identifiers and the technical printer name remain stable for later integration; this is a display-label change, not a device or signal replacement.
- Larger typography is prepared in `preview-type.css` and `layout-type.css`: body 14→16 px, sidebar 12→14 px, station labels 12→14 drawing units, arrow direction labels 9→11, robot name buttons 16→18, table body 12→14, and dialog value/label text 15 px. Spacing was adjusted to retain 1920×1080 without page scrolling.
- The logo links back to the installation overview. Artwork and text retain the upright rotation behavior from v11.

Static preview validation checked all five Palomat dialogs, unit changes, tabs and Escape/close behavior; Barcode title and icon; logo as vector paths; navigation from the logo; rotated Palomat interaction; and no overflow on overview, Robot 1, SEMOLINA, assignments and history. No JavaScript errors were observed.

This is still artwork/layout review. No FUXA build, runtime/CI or actual PLC/SAP/AGV/printer validation was run. Applying the approved typography, branding and popup behavior to the packaged FUXA UI remains part of the later explicitly authorized integration/build step.
