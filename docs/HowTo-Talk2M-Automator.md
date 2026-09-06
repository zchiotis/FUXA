# Talk2M Automator connection

The `T2MAutomator` connection coordinates FUXA device polling with the Windows
Talk2M Automator and eCatcher. The API is available only on the local computer.

## Configure

1. Start eCatcher and Talk2M Windows Automator on the same Windows computer as FUXA.
2. In the Automator, enable the sites that FUXA may use and keep `FUXA controls the site loop` selected.
3. Copy the API token shown by the Automator.
4. In FUXA, add a `T2MAutomator` connection and enter the token.
5. Select refresh to import the enabled eCatcher sites.
6. For each site, select its FUXA device connections and then select the required
   tags. The tag list contains only tags from those selected connections.
7. Enable the `T2MAutomator` connection and save the project.

Site online tags are managed from the Talk2M Automator connection properties.
Refresh the eCatcher site list, select the required entries under **Site status
tags**, and save the connection. FUXA creates or removes the corresponding
`site.<name>.online` tags while preserving the fixed coordinator status tags.

Mapped FUXA connections are runtime-controlled. They do not need to be enabled
in the project. At startup FUXA suppresses every mapped connection until the
matching VPN site has been connected and verified.

## Collection acknowledgement

A site cycle succeeds only after every required tag has received a non-null
value with a timestamp newer than the verified VPN connection. FUXA then emits
the `t2m-cycle:ready` runtime event and updates the automatically created cycle
tags. These tags can be selected by an MQTT or ThingsBoard reporting connection.
After each cycle finishes, `next_acquisition_ts` is updated once with the Unix
timestamp in milliseconds of the next scheduled acquisition. Countdown widgets
should calculate the remaining time client-side instead of publishing every second.

Freshness requires a device sample timestamp at or after the verified VPN
connection. Cached values from earlier visits and values without timestamps
cannot acknowledge the cycle. The device timestamp is preserved as `sourceTimestamp`.
If the collection timeout expires, FUXA performs the same safe cleanup and moves
to the next available site after the configured failure delay.

During collection the coordinator also reads every required tag directly from
the active FUXA runtime value store. This fallback covers drivers whose values
are visible to FUXA but do not emit a usable `device-value:changed` event.

After a successful collection, FUXA preserves the last non-null values from the
temporarily enabled connection before stopping it. The snapshot remains
available to dashboards and reporting connections after the VPN disconnect,
but a newly enabled runtime connection starts empty and must produce fresh
values before the next cycle can succeed.

Before changing or disconnecting the VPN, FUXA stops all mapped device
connections. If any connection cannot be stopped, the VPN is left unchanged and
`cycle.last_error` reports the failure.

## Kawasaki acquisitions over VPN

T2M-managed Kawasaki connections acquire one complete sample per site visit:
one STA, one OPEINFO when enabled, and one ERRLOG when enabled. Each robot closes
its Telnet session after publishing that sample. Polling ticks and connection
checks cannot restart a completed acquisition while other robots are collecting.
The normal 3000 ms polling setting remains unchanged for direct, continuously
running Kawasaki connections. A managed command failure fails the acquisition;
it does not publish a partial sample as successful. The next site visit can retry.

The coordinator waits for both required fresh tags and completion of every
managed Kawasaki sample, including ERRLOG. Required tags that a controller does
not supply still cause the collection timeout; select only applicable addresses.
While a managed acquisition is still active, the coordinator allows at least
180 seconds so the initial large ERRLOG scan is not interrupted by an older
90-second setting. Once device acquisition is complete, the configured timeout
still applies to missing required tags. Cleanup cancels an active Telnet command
immediately and does not report a second command timeout after the VPN cycle ends.

ERRLOG history and the latest fingerprint survive device recreation between VPN
visits in the same FUXA process. They are isolated by device ID and endpoint/login/
ignored-code configuration. Restarting FUXA clears this in-memory history and the
next visit performs the initial history read again. A successful read with fewer
than ten accepted errors exposes unused slots as timestamp_ms=0, code="", message="".
Existing slots survive successful checks with no new errors.

Each completed managed sample logs command counts and Telnet received/sent bytes,
for example `acquisition complete: STA=1 OPEINFO=1 ERRLOG=1 rx=... tx=... bytes`.
These counts exclude VPN, TCP and other application overhead. Filtering E1326
discards received records; it cannot recover traffic already sent by the robot.
The initial scan may still be large if the log contains mostly ignored errors.

For Windows headless, replace the executable only after stopping the old FUXA
process; retain the existing project/data directories. Use the integrated branch
`codex/t2m-fuxa-integration` and artifact `FUXA-Integrated-Windows-x64`.
