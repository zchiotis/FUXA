# Native HMI / OPC UA · έλεγχοι

## Έγιναν τοπικά, χωρίς FUXA runtime

- Παραγωγή του native `.fuxap`, 59 SVG views και ανεξάρτητων element/property mappings.
- Στατική επαλήθευση: 1.905 ξεχωριστά editor objects, μηδέν iframes, μοναδικά IDs, έγκυρες native destinations, σωστό σχήμα Values/Semaphores και καμία κατασκευασμένη OPC UA διεύθυνση tag.
- Έλεγχος σύνταξης των εργαλείων παραγωγής και migration.
- Έλεγχος φόρτωσης/αποθήκευσης της κάτοψης μόνο στον ενσωματωμένο μηχανισμό SVG-Edit, χωρίς εκκίνηση FUXA: ένα authoring layer, διατήρηση μετασχηματισμών και γεωμετρίας native στοιχείων.
- Απόδοση του στατικού native SVG για οπτικό έλεγχο. Αυτό δεν είναι έλεγχος του μεταγλωττισμένου editor ή των OPC UA bindings.

Αποτελέσματα: `native-validation.json`. Δεν εγκαταστάθηκε ή εκτελέστηκε FUXA στον τοπικό υπολογιστή. Δεν έγινε σύνδεση PLC, browse, write, TIA compile/download ή τροποποίηση πηγών PLC.

## Έλεγχοι στο Windows CI του πακέτου

- Angular compilation, OPC UA dependency loading και απομονωμένο FUXA startup.
- Native home και 16 κύριες οθόνες, native dialogs, μηδέν runtime iframes, περιστροφή με όρθια γράμματα και 1920×1080 fitting.
- Μετατροπή παλιού iframe/S7 project, backup παλιάς σύνδεσης και διατήρηση editor αλλαγών, OPC UA tags, credentials, ιστορικού και custom views.
- Υπάρχοντες έλεγχοι logging, read-only guard και Kawasaki. Οι παλιοί έλεγχοι S7 decoding αφορούν μόνο τον ιστορικό adapter, όχι το νέο transport του CPLC.
- Προσομοίωση αφής για άνοιγμα/κλείσιμο native dialog και περιστροφή. Η επαλήθευση στο φυσικό touch screen γίνεται χωριστά από τον χρήστη.
- Πραγματικός editor: ξεχωριστή επιλογή των δύο overviews, επιλογή βέλους και status, άνοιγμα Properties, αυτόματη αποθήκευση με αλλαγή view και επιστροφή στο HMI. Σύγκριση θέσης/μεγέθους των στοιχείων πριν και μετά, και έλεγχος ότι τα bindings λειτουργούν ακόμη.
- Προσωρινά internal tags μόνο στην απομονωμένη CI βάση, για native bindings και διατήρηση 18-ψήφιου SSCC με αρχικά μηδενικά σε Value και Table. Τα screenshots επισημαίνονται SYNTHETIC CI DATA. Η προσωρινή βάση αφαιρείται πριν δημιουργηθεί το πακέτο.

Το παλιό επιτυχές build 5 αφορούσε την προηγούμενη αρχιτεκτονική iframe/S7. Δεν αποτελεί επαλήθευση αυτής της αλλαγής. Για το νέο πακέτο, πρωτογενής απόδειξη είναι η κατάσταση του αντίστοιχου Windows run και το `result.json` στο QA artifact· το έγγραφο δεν προδικάζει επιτυχία ή commissioning.

## Έλεγχος από τον υπολογιστή δοκιμών με πραγματικό OPC UA CPLC · ανοικτός

1. Επιβεβαίωση πρόσβασης στο endpoint που έδωσε ο χρήστης: `opc.tcp://192.168.214.105:4840`. Ρυθμίσεις ασφάλειας και trust σύμφωνα με τον πραγματικό server.
2. Browse και προσθήκη επιλεγμένων πραγματικών nodes. Επιβεβαίωση datatype, δικαιωμάτων και σημασίας· τα offline offsets δεν είναι NodeIds.
3. Επιλογή tags στα native Properties/Actions/Table cells, αποθήκευση, επαναφόρτωση editor και restart. Επιβεβαίωση ότι οι προσωπικές αντιστοιχίσεις διατηρούνται.
4. Σύγκριση πραγματικών τιμών σε station Operational/Occupied/AGVRequest/ROBRequest/Release, UInt PalletType και SSCC με αρχικά μηδενικά. Ξεχωριστή επιβεβαίωση φυσικής κυψέλης και PLC producer.
5. Δοκιμή χρώματος βέλους, παρουσίας παλέτας, διακοπής/ανάκτησης επικοινωνίας και ποιότητας OPC UA. Σταθερή τιμή δεν σημαίνει από μόνη της παλιά δεδομένα· απαιτούνται server quality, session health και συμφωνημένο heartbeat.
6. Έλεγχος DAQ και χωριστής event DB με πραγματικές αλλαγές, timestamps, restart και ρυθμό αύξησης. Σύντομοι παλμοί απαιτούν PLC latch/counter/sequence για εγγυημένη καταγραφή.
7. Πραγματικές πηγές για buffer, SAP, Barcode, Palomats και SEMOLINA. Επιβεβαίωση άφιξης συγκεκριμένου SSCC στο Τυλιχτικό πριν ενεργοποιηθεί delivery writer.
8. Συμφωνία command nodes, ownership, pulse, confirmation και interlocks πριν ενεργοποιηθεί οποιαδήποτε εντολή.

Κανένα βήμα πραγματικού commissioning δεν έχει σημειωθεί ως επιτυχές.
