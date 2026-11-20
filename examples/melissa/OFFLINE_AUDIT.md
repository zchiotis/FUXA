# Offline επιθεώρηση · 20 Νοεμβρίου 2026

## Πηγές και μέθοδος

Επιθεωρήθηκαν το `Melissa/CPLC/Melissa_CPLC_v0.4.zap20`, αντίγραφο του directory project `Melissa_CPLC_v0.4`, τα εσωτερικά XML interfaces στο `System/PEData.plf`, το Lucene offline search index, το `CPLC_IF.md`, το export DB100 v3 και ο υπάρχων legacy DB666 χάρτης. Τα synced `sources` δεν άλλαξαν.

Το `.zap20` αποσυμπιέστηκε ως archive. Ανακτήθηκαν plain XML και XML που αποθηκεύονταν σε τμήματα deflate με μέγεθος 4096 bytes και αφαιρέθηκε μόνο το trailing zero padding. Η ανασύνθεση έγινε σε αντίγραφα χωρίς TIA Portal. Τα XML αυτά είναι εσωτερικές αποθηκευμένες αναπαραστάσεις· δεν παρουσιάζονται ως επίσημο Openness export ή έλεγχος συνέπειας/compile. Οι hashes βρίσκονται στο manifest.

Στον φάκελο CPLC δεν βρέθηκε όνομα έκδοσης μεταγενέστερο του v0.4. Το archive έχει ημερομηνία 17/11/2026. Το directory project έχει μεταγενέστερα αρχεία, με `.info` της 20/11/2026. Τα hashes PLF διαφέρουν. Οι interface XML δομές **DB100, DB8, DB10 και DB13 είναι byte-identical** μεταξύ archive και αντιγράφου directory project. Οι indexed κλήσεις Main/FC16 επίσης συμφωνούν.

Το directory περιέχει επιπλέον `FB_AGVDownstream` και `FB_AGVUpstream`. Δεν βρέθηκαν κλήσεις τους στο OB1 ή indexed εκτελέσιμα networks. Το Upstream έχει μεταξύ άλλων `Enable`, `PalletReady`, `AGVRequest`, `AGVRelease`, `Busy`, `SAP_Request`, `SAP_Response`, `AGVStation`. Η παρουσία της διεπαφής δεν τεκμηριώνει ενεργή λειτουργία.

## Κυκλική δομή

Στο Main OB1, τα τέσσερα indexed networks αναφέρουν:

1. `SAP Integration`.
2. `EIDOS Integration`.
3. `Robots_Communication [FC16]` και `Palomat Parse Values [FC17]`.
4. `AGV Communication [FC18]`.

Το `Robot Stations [FC15]` υπάρχει και αναφέρει μόνο την κλήση `FB_Robot_Infeed` / `Inst_ROB1-1IN` για `DB_AGVServer.R1-1IN`. Δεν βρέθηκε κλήση FC15 στο OB1. Το `FB_Robot_Outfeed [FB5]` επίσης υπάρχει, αλλά η ύπαρξή του δεν ισοδυναμεί με ενεργό outfeed handshake.

Το FC16 περιλαμβάνει cyclic request clock, GET/PUT για τα πρώτα τρία configured partners και Robot 5. Αναφέρονται GET από I/Q και PUT προς `P#DB666.DBX0.0`. Αυτό **δεν αποδεικνύει ύπαρξη DB666 στους remote PLCs** ή επιτυχή PUT. Απαιτείται έλεγχος EN/REQ, status και online δεδομένων. Δεν προστέθηκε DB666 σε κανένα project.

Το FC17 έχει πέντε GET/PUT για Palomats προς remote DB31, με connection IDs 16#105 έως 16#109. Το network `Parse values to AGV_Server_DB` δεν έχει indexed κώδικα. Επομένως το DB100.PALOMAT status δεν χαρακτηρίζεται επιβεβαιωμένο live status των μηχανών. Στο Palomat 4 network εμφανίζονται και `Palomat2_REQ` και `Palomat4_REQ`: χρειάζεται έλεγχος της συγκεκριμένης καλωδίωσης REQ.

Το FC18 αναφέρει CPLC heartbeat με timers `T#1s`. Δεν βρέθηκε τεκμηριωμένος μετρητής επιτυχών παραδόσεων ή ledger παλετών σε αυτήν τη ρουτίνα. Οι indexed αναφορές είναι στατικό εύρημα και δεν αποδεικνύουν runtime εκτέλεση ή σωστή σύνδεση κάθε pin.

## DB100

Το standard interface έχει `stdSize=6864 bits`, δηλαδή **858 bytes**. Τα station fields έχουν relative offsets:

| Field | Offset | Τύπος |
|---|---:|---|
| Operational | +0.0 | Bool |
| Occupied | +0.1 | Bool |
| AGVRequest | +0.2 | Bool |
| ROBRequest | +0.3 | Bool |
| Release | +0.4 | Bool |
| PalletType | +2 | UInt |
| SSCC | +4 | String[18], 20 bytes με header |

Οι 34 robot stations καλύπτουν bytes 0..815 με σταθερό βήμα 24. Μετά:

| Ομάδα | Byte βάσης |
|---|---:|
| PALOMAT-1..5 | 816, 818, 820, 822, 824 |
| WRAP-IN | **826** |
| Interface | **850** |
| Interface.AGV_Status | 850, UInt |
| Interface.AGV_NoAlarm | 852.0 |
| Interface.CPLC_Status | 854, UInt |
| Interface.CPLC_NoAlarm | 856.0 |
| Interface.AGV_HB | 856.1 |
| Interface.CPLC_HB | 856.2 |

Η σχετική Palomat δομή έχει bits 0..7 `PAL_XOUT_Ready`, `PAL_XOUT_Release`, `PAL_XOUT_Full`, `PAL_XOUT_Empty`, `PAL_XOUT_Error`, `PAL_AGVInside`, `PAL_XIN_ModeStack`, `PAL_XIN_ModeDestack`. Το standard top-level βήμα είναι δύο bytes, όπως αποθηκεύεται στο πραγματικό DB100.

Όλα τα ακριβή station names/offsets διατηρούνται στο manifest. Δεν εξομαλύνθηκαν αυθαίρετα τα `R1-1OUT`, `R1-3-OUT`, `R6-1-IN`, `R6-2-OUT` κ.λπ.

## Ταυτότητες και μετατοπισμένα ονόματα

| Φυσική κυψέλη | Kawasaki | Configured S7 partner | Προορισμός GET στο FC16 |
|---|---|---|---|
| Robot 1 | .24.25 | S7_conn_rob3 / Robot_3 → .24.24 | **DB13.Robot_1**, ID 16#102, I/Q68 |
| Robot 2 | .24.19 | S7_conn_rob1 / Robot_1 → .24.18 | **DB13.Robot_3**, ID 16#100, I/Q4/8 |
| Robot 3 | .24.16 | S7_conn_rob2 / Robot_2 → .24.15 | **DB13.Robot_2**, ID 16#101, I/Q4/8 |
| Robot 4 · Combino FD20 | .24.22 | Legacy endpoint .24.21 από backup, route pending | DB13.Robot_4 υπάρχει· δεν αποδεικνύεται ενεργός producer FC16 |
| Robot 5 | .24.28 | SIMOTION endpoint .24.27 από backup | DB13.Robot_5, ID 16#103, Q42 |
| Robot 6 · Condor | προς επιβεβαίωση | προς επιβεβαίωση | δεν υπάρχει DB13.Robot_6 |

Οι IP έχουν πρόθεμα `192.168`. Για Robot 1 παραμένει ανοιχτή η αντιστοίχιση του partner .24 με το backup Robot00. Το παράδειγμα δείχνει γιατί το configured connection name και το raw destination field **δεν πρέπει να θεωρούνται ίδιο index**.

## Optimized / μη διαθέσιμα δεδομένα

- `DB_SAP_SoapData [DB2]`: optimized, περιέχει πραγματικά Result/Response/ParseStatus και command bits Execute/BuildRequest. Δεν εκτίθενται μυστικά Config ή SOAP payloads στο HMI/package.
- `AGVBuffer_DB [DB8]`: optimized, `Static_1 : Array[1..60] of typeMelissa_ZR3RobotResponse` και retained `PalletsInTraffic : UInt`. Το τυπικό StdO του counter είναι 578160 bytes· **δεν είναι προσβάσιμη wire διεύθυνση optimized DB**. Η γεμάτη θέση response δεν αποτελεί απόδειξη JH παράδοσης.
- `Robots_DB [DB10]`: διαφορετικό standard/optimized layout, δεν χρησιμοποιούνται absolute StdO offsets.
- `DB_EIDOS_Data`: instance DB, απαιτείται επιβεβαίωση πραγματικών instance offsets ή συμβολικών nodes.
- `Wrapper_DB [DB7]` και `Palomat_Data [DB34]`: περιέχουν δομές, χωρίς τεκμηριωμένη επιτρεπτή standard πρόσβαση για το παρόν binding.

Προτεινόμενη συνέχεια: ελεγχόμενο symbolic browse αν OPC UA είναι ήδη διαθέσιμο και αδειοδοτημένο, ή συμφωνημένη standard read-only HMI διεπαφή. Δεν τεκμαίρεται ότι OPC UA είναι ενεργό. Κανένα PLC project δεν τροποποιήθηκε.
