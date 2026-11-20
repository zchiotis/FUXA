# Έλεγχος HMI και πραγματικού PLC

## Offline εργασία στον υπολογιστή προετοιμασίας

Ολοκληρώθηκαν αποσυμπίεση/ανάκτηση interfaces, σύγκριση archive με αντίγραφο directory project, παραγωγή manifest/project/widgets και συγγραφή runtime/UI/CI.

Δεν εκτελέστηκε FUXA ή τοπικό HMI test. Η αρχική εγκατάσταση server dependencies είχε ολοκληρωθεί πριν διευκρινιστεί ότι η εκτέλεση/δοκιμές θα γίνουν αλλού· δεν χρησιμοποιήθηκε για εκκίνηση runtime. Δεν συνεχίζεται τοπική εγκατάσταση ή compilation. Δεν έγινε σύνδεση με CPLC/Kawasaki/JH, PLC write, compile/download ή αλλαγή ρυθμίσεων PLC. Το TIA Portal δεν άνοιξε project από την εργασία αυτή.

## GitHub CI · υπολογιστής build

Το workflow `Melissa FUXA-AGV Windows` εκτελεί σε Windows runner:

- unit tests για exact mapping, UInt/STRING decoding, read-only guard, πλήρες sample ή invalidation, DAQ interval, freshness και SQLite persistence,
- τον υπάρχοντα Kawasaki driver suite με synthetic telnet server,
- API authorization checks,
- πραγματικό Angular compile,
- isolated FUXA smoke test με όλες τις production συσκευές disabled,
- browser checks και screenshots για 15 οθόνες, synthetic sample και απώλεια επικοινωνίας, καθώς και native FUXA home embedding.

Η κατάσταση κάθε run και τα screenshots είναι τα πρωτογενή τεκμήρια. Το έγγραφο δεν δηλώνει εκ των προτέρων επιτυχία. Τα δοκιμαστικά δεδομένα CI αφαιρούνται από το portable package. Το runtime δεν περιλαμβάνει simulator ή demo telemetry.

## Επαλήθευση στον υπολογιστή δοκιμών με πραγματικό PLC · ανοικτή

1. Καταγράψτε build commit, PLC version/checksum και τη διαδρομή από τον test host προς `192.168.214.105:102`.
2. Ενεργοποιήστε μόνο CPLC read-only device. Συγκρίνετε DB100 επιλεγμένα πεδία με πραγματικό PLC watch/εγκεκριμένα γνωστά δεδομένα: R1-1OUT, WRAP-IN byte 826, Palomat fields και Interface byte 850. Ελέγξτε SSCC 18 χαρακτήρων και αρχικά μηδενικά.
3. Συγκρίνετε CPLC/AGV heartbeat μεταβολές, αποσυνδέστε ελεγχόμενα το HMI από τη διαδρομή και ελέγξτε bad/stale/recovery, χωρίς χειρισμό μηχανών.
4. Ελέγξτε κάθε Kawasaki χωριστά, mode/program/error log, controller timestamps και συμπεριφορά disconnect/reconnect. Επιβεβαιώστε controller identity πριν ενεργοποιήσετε μαζικό polling.
5. Ανοίξτε native DAQ και `melissa-events.db`: ελέγξτε αλλαγές, timestamps, restart persistence, πραγματικό ρυθμό αύξησης και συμφωνήστε retention/backup.
6. Επιβεβαιώστε τη φυσική πηγή κάθε station. Η φρεσκάδα DB100 ανάγνωσης δεν αποδεικνύει φρεσκάδα robot PLC αν η GET ή η λογική παραγωγής του station δεν λειτουργεί.
7. Ολοκληρώστε optimized source bindings για SAP/EIDOS/DB8 και ορισμό επιτυχίας/abort παράδοσης πριν ενεργοποιηθεί writer στο delivery ledger.
8. Συμφωνήστε command bit, writer ownership, διάρκεια pulse, confirmation, permissives, interlocks και audit πριν προστεθεί οποιοσδήποτε χειρισμός.

Η επιτυχία HMI/CI και η επιτυχία αυτής της λίστας commissioning τεκμηριώνονται χωριστά. Κανένα βήμα commissioning δεν έχει ακόμη καταγραφεί ως επιτυχές.
