# Melissa FUXA-AGV

Έκδοση πακέτου **0.1.0**, πάνω σε FUXA **1.3.4-2888**. Η εφαρμογή χρησιμοποιεί το FUXA runtime, τις συσκευές του και το SQLite DAQ. Οι οθόνες είναι ενσωματωμένα panels μέσα σε κανονικά FUXA views. Δεν είναι ανεξάρτητος προσομοιωτής.

## Λήψη και εκτέλεση στον υπολογιστή δοκιμών

1. Ανοίξτε το τελευταίο επιτυχές [Melissa Windows build](https://github.com/zchiotis/FUXA/actions/workflows/melissa-windows.yml?query=branch%3AFUXA-AGV).
2. Από τα **Artifacts**, κατεβάστε το `Melissa-FUXA-AGV-windows-x64-<run>`. Αποσυμπιέστε και το εσωτερικό `Melissa-FUXA-AGV-windows-x64.zip`.
3. Στον **άλλον υπολογιστή δοκιμών**, εκτελέστε `Start-Melissa.cmd`. Το πακέτο περιλαμβάνει Node.js και τα απαιτούμενα modules. Δεν απαιτεί npm install εκεί.
4. Ανοίξτε `http://127.0.0.1:1881`. Το υπάρχον project και οι βάσεις στον φάκελο `data` διατηρούνται σε επόμενη εκκίνηση. Μην αντιγράφετε νέο πακέτο πάνω σε ανοιχτό runtime. Κρατήστε το `data` για την επόμενη έκδοση.
5. Το αρχικό project έχει **όλες τις εξωτερικές συνδέσεις απενεργοποιημένες**. Στο FUXA Devices ενεργοποιήστε μόνο τη συσκευή που πρόκειται να ελεγχθεί. Δεν υπάρχουν HMI εντολές PLC.

Η UI ακούει αρχικά μόνο στο loopback του υπολογιστή εκτέλεσης. Ο ίδιος υπολογιστής χρειάζεται τις κατάλληλες διαδρομές προς CPLC/Kawasaki. Δεν έχει ελεγχθεί εδώ η πρόσβαση από εκείνον τον υπολογιστή.

Το `build.json` προσδιορίζει το commit και το build run. Το χωριστό `Melissa-HMI-QA-<run>` artifact περιέχει screenshots και αποτελέσματα ελέγχου. Επιτυχές build/QA δεν σημαίνει commissioning ή αποδοχή PLC.

## Οθόνες και widgets

- Overview: επικοινωνίες, έξι κυψέλες, κατάσταση φρεσκάδας.
- Robot 1–6: πραγματικοί IN/OUT σταθμοί του DB100, όλα τα handshake bits, UInt pallet type, SSCC με αρχικά μηδενικά.
- Kawasaki panels για Robot 1, 2, 3, **4 Combino** και 5: υπάρχων native telnet driver με STA/OPEINFO/ERRLOG. Το default ignore filter E1326 απενεργοποιήθηκε στο Melissa project ώστε να μη χαθεί κωδικός από την εποπτεία.
- Robot 6 = **Condor**, χωρίς αυθαίρετη ανάθεση Kawasaki IP.
- AGV buffer και χωριστό ιστορικό επιβεβαιωμένων παραδόσεων JH.
- SAP, EIDOS, wrapper, πέντε Palomats, diagnostics και events.

Το `Melissa_CPLC.fuxap` είναι το project εισαγωγής και ο φάκελος `widgets` περιέχει SVG panels για τις 15 οθόνες. Τα widgets εξαρτώνται από τα Melissa endpoints αυτού του branch. Για υπάρχον FUXA project απαιτείται η ίδια server επέκταση· η εισαγωγή ενός SVG μόνη της δεν προσθέτει τον driver ή την καταγραφή.

Το εργοστασιακό layout θα προστεθεί όταν παραδοθεί από τον χρήστη. Δεν έχει επινοηθεί φυσική κάτοψη.

## Πραγματικό mapping και εκκρεμότητες

Αναλυτικά στο [OFFLINE_AUDIT.md](OFFLINE_AUDIT.md), [manifest.json](manifest.json) και [VALIDATION.md](VALIDATION.md).

- **316** standard DB tags από DB100/DB13 και **510** Kawasaki tags: σύνολο **826**.
- CPLC: `192.168.214.105:102`, rack 0, slot 1. Το Melissa S7 adapter διαβάζει ομαδοποιημένα blocks και αποκωδικοποιεί τα Siemens STRING headers. Δεν περιέχει κλήσεις PLC write.
- Το πραγματικό v0.4 έχει Palomats στα bytes **816, 818, 820, 822, 824**, `WRAP-IN` στο **826**, `Interface` στο **850**. Το PDF v0.3 με wrapper στο 816 δεν χρησιμοποιείται για τη σύνδεση.
- Τα DB2/SAP και DB8/buffer είναι optimized. Τα compiled `StdO` δεν θεωρούνται διευθύνσεις πρόσβασης. Τα panels τους παραμένουν χωρίς live binding μέχρι πραγματικό symbolic browse ή συμφωνημένη read-only διεπαφή από το PLC. Δεν δημιουργήθηκαν OPC UA NodeIds ή DB666.
- Οι δημοσιευμένες τιμές station δεν αποδεικνύουν ότι υπάρχει ενεργός παραγωγός σε κάθε κυψέλη. Το `Robot Stations [FC15]` δεν βρέθηκε στις κλήσεις OB1.
- Για τις παραδόσεις χρειάζεται ορισμός επιτυχίας/abort και αναγνωριστικό συμβάντος ολοκλήρωσης. Ο πίνακας `deliveries` είναι έτοιμος, αλλά **δεν υπάρχει ενεργός writer** μέχρι να τεκμηριωθεί αυτό το κριτήριο. Η πτώση AGVRequest δεν καταχωρεί παράδοση.
- JHLI παραμένει εκτός scope. Οι μονάδες των timing diagrams δεν υιοθετούνται ως επιβεβαιωμένες.

## Καταγραφή και ποιότητα

Όλα τα configured tags έχουν native FUXA DAQ με καταγραφή αλλαγής και περιοδικό δείγμα 10 s, χωρίς restore παλιών τιμών ως νέες. Χρησιμοποιούνται τα κανονικά `daq-data_*`/`daq-map_*` SQLite αρχεία του FUXA.

Η χωριστή `data/_db/melissa-events.db` καταγράφει τις παρατηρούμενες αλλαγές τιμών, αλλαγές εγκυρότητας/επικοινωνίας, diagnostic raise/clear, heartbeat diagnostics και snapshots των FUXA alarm transitions. Περιλαμβάνει χωριστό πίνακα `deliveries` για την μελλοντική επιβεβαιωμένη πηγή ολοκλήρωσης.

Αυτό σημαίνει **όλα τα παρατηρούμενα δεδομένα και events του δεσμευμένου scope**, όχι κάθε PLC scan. Ένας παλμός διάρκειας ενός scan μπορεί να χαθεί ανάμεσα σε δύο polls. Εγγυημένη καταγραφή απαιτεί PLC latch/counter/sequence queue και συμφωνημένο event contract. Δεν καταγράφονται optimized πεδία που δεν έχουν ακόμη συνδεθεί. Η retention δεν διαγράφει αυτόματα ιστορικό· απαιτείται απόφαση χωρητικότητας/backup μετά τη μέτρηση του πραγματικού ρυθμού.

Οι ενδείξεις είναι `unknown`, `good`, `stale`, `bad`. Σε σφάλμα κρατείται η τελευταία γνωστή τιμή με σαφή σήμανση. Χωριστά ελέγχεται η μεταβολή heartbeat, επειδή μια επιτυχής S7 ανάγνωση δεν αποδεικνύει λειτουργία κύκλου PLC ή φυσική φρεσκάδα της κάθε κυψέλης.

Με ενεργοποιημένη την ασφάλεια FUXA, τα συνολικά Melissa diagnostics απαιτούν administrator role. Τα endpoints χρησιμοποιούν το υπάρχον FUXA authentication και δεν παρακάμπτουν ενεργοποιημένη ασφάλεια. Το αρχικό πακέτο αφορά τοπική λειτουργία στον υπολογιστή δοκιμών.

Για μελλοντικά symbolic bindings, το `data/_appdata/settings.js` δέχεται `melissa.bindings` με πραγματικά FUXA `{device, tag}` IDs, π.χ. κλειδί `sap.Result.HttpResponseCode` ή `buffer.1.SSCC`. Η συσκευή πρέπει να έχει ID με πρόθεμα `melissa-`, DAQ ενεργό και επαληθευμένη αντιστοίχιση. Δεν έχουν δοθεί κατασκευασμένες τιμές γι' αυτά τα IDs.
