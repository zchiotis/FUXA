# Talk2M Automator connection

The `T2MAutomator` connection coordinates FUXA device polling with the Windows
Talk2M Automator and eCatcher. The API is available only on the local computer.

## Configure

1. Start eCatcher and Talk2M Windows Automator on the same Windows computer as FUXA.
2. In the Automator, enable the sites that FUXA may use and keep `FUXA controls the site loop` selected.
3. Copy the API token shown by the Automator.
4. In FUXA, add a `T2MAutomator` connection and enter the token.
5. Select refresh to import the enabled eCatcher sites.
6. For each site, select its FUXA device connections and the tags that must receive a fresh value.
7. Enable the `T2MAutomator` connection and save the project.

Mapped FUXA connections are runtime-controlled. They do not need to be enabled
in the project. At startup FUXA suppresses every mapped connection until the
matching VPN site has been connected and verified.

## Collection acknowledgement

A site cycle succeeds only after every required tag has received a non-null
value with a timestamp newer than the verified VPN connection. FUXA then emits
the `t2m-cycle:ready` runtime event and updates the automatically created cycle
tags. These tags can be selected by an MQTT or ThingsBoard reporting connection.

Freshness is based on the time the coordinator receives a value event after the
VPN connection. The original device timestamp is preserved as `sourceTimestamp`.
If the collection timeout expires, FUXA performs the same safe cleanup and moves
to the next available site after the configured failure delay.

During collection the coordinator also reads every required tag directly from
the active FUXA runtime value store. This fallback covers drivers whose values
are visible to FUXA but do not emit a usable `device-value:changed` event.

Before changing or disconnecting the VPN, FUXA stops all mapped device
connections. If any connection cannot be stopped, the VPN is left unchanged and
`cycle.last_error` reports the failure.
